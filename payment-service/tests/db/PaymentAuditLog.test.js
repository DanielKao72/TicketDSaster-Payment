// Audit trail and append-only guards of the Payment Store (6.3), against Postgres.
const { describe, test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { skip, connect, wipe } = require('../support/PostgresTestDatabase');
const {
  PostgresPaymentRepository,
} = require('../../src/adapters/repositories/PostgresPaymentRepository');
const { Payment } = require('../../src/core/domain/Payment');

const USER_ID = '00000000-0000-4000-8000-000000000001';

describe('Payment Store audit and retention guards', { skip }, () => {
  let knex;
  let repository;

  before(async () => {
    knex = await connect();
    repository = new PostgresPaymentRepository(knex);
  });

  beforeEach(async () => {
    await wipe(knex);
  });

  after(async () => {
    await knex?.destroy();
  });

  async function capturedPayment(sessionId = randomUUID()) {
    const payment = Payment.create({
      sessionId,
      userId: USER_ID,
      amount: 150000,
      currency: 'MXN',
    });
    payment.authorize('ch_1');
    const authorized = await repository.save(payment);
    authorized.capture('cap_1');
    return repository.save(authorized);
  }

  test('every payment change and transaction is in the audit log, in order', async () => {
    const payment = await capturedPayment();

    const log = await knex('payment_audit_log')
      .where({ payment_id: payment.id })
      .orderBy('id')
      .select('table_name', 'operation', 'old_data', 'new_data', 'db_user', 'changed_at');

    assert.deepStrictEqual(
      log.map((entry) => [entry.table_name, entry.operation]),
      [
        ['payments', 'INSERT'],
        ['transactions', 'INSERT'],
        ['payments', 'UPDATE'],
        ['transactions', 'INSERT'],
      ],
    );
    assert.strictEqual(log[2].old_data.status, 'AUTHORIZED');
    assert.strictEqual(log[2].new_data.status, 'CAPTURED');
    assert.strictEqual(log[3].new_data.type, 'CAPTURE');
    assert.ok(log.every((entry) => entry.db_user && entry.changed_at instanceof Date));
  });

  test('saving without a status change adds no audit entry', async () => {
    const payment = await capturedPayment();
    const before = await knex('payment_audit_log').count('* as n').first();

    await knex('payments').where({ id: payment.id }).update({ updated_at: knex.fn.now() });

    const after = await knex('payment_audit_log').count('* as n').first();
    assert.strictEqual(after.n, before.n);
  });

  test('transactions cannot be updated or deleted', async () => {
    const payment = await capturedPayment();
    const transactions = knex('transactions').where({ payment_id: payment.id });

    await assert.rejects(transactions.clone().update({ status: 'FAILED' }), /append-only/);
    await assert.rejects(transactions.clone().del(), /append-only/);
  });

  test("a payment's id, session, user, amount and currency cannot change", async () => {
    const payment = await capturedPayment();
    const row = () => knex('payments').where({ id: payment.id });

    for (const change of [
      { amount: 1 },
      { currency: 'USD' },
      { user_id: '00000000-0000-4000-8000-000000000002' },
      { session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009' },
    ]) {
      await assert.rejects(row().update(change), /cannot change/, JSON.stringify(change));
    }
    await assert.doesNotReject(row().update({ status: 'REFUNDED' }));
  });

  test('payments and the audit log cannot be deleted or truncated', async () => {
    const payment = await capturedPayment();

    await assert.rejects(knex('payments').where({ id: payment.id }).del(), /cannot be deleted/);
    await assert.rejects(knex('payment_audit_log').del(), /append-only/);
    await assert.rejects(knex('payment_audit_log').update({ db_user: 'x' }), /append-only/);
    for (const table of ['payments', 'transactions', 'payment_audit_log']) {
      await assert.rejects(knex.raw(`TRUNCATE ${table} CASCADE`), /cannot be truncated/);
    }
  });

  test('a PENDING payment without transactions can be discarded, and it is logged', async () => {
    const reserved = await repository.save(
      Payment.create({
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
        userId: USER_ID,
        amount: 1000,
        currency: 'MXN',
      }),
    );

    assert.strictEqual(await repository.discardPending(reserved), true);

    assert.strictEqual(await repository.findById(reserved.id), null);
    const log = await knex('payment_audit_log')
      .where({ payment_id: reserved.id })
      .orderBy('id')
      .pluck('operation');
    assert.deepStrictEqual(log, ['INSERT', 'DELETE']);
  });

  test('a payment with transactions is never discarded', async () => {
    const payment = await capturedPayment();

    assert.strictEqual(await repository.discardPending(payment), false);
    await assert.rejects(
      knex('payments')
        .where({ id: payment.id })
        .update({ status: 'PENDING' })
        .then(() => knex('payments').where({ id: payment.id }).del()),
      /cannot be deleted/,
    );
  });

  test('a second active payment for a Session is rejected by the database', async () => {
    const first = await capturedPayment();
    const second = Payment.create({
      sessionId: first.sessionId,
      userId: USER_ID,
      amount: 1000,
      currency: 'MXN',
    });

    await assert.rejects(repository.save(second), { name: 'PaymentAlreadyExistsError' });
  });

  test('a transaction that sets payment_store.allow_delete can delete, and it is logged', async () => {
    const payment = await capturedPayment();

    await knex.transaction(async (trx) => {
      await trx.raw("SELECT set_config('payment_store.allow_delete', 'on', true)");
      await trx('payments').where({ id: payment.id }).del();
    });

    assert.strictEqual(await repository.findById(payment.id), null);
    const deletes = await knex('payment_audit_log')
      .where({ payment_id: payment.id, operation: 'DELETE' })
      .pluck('table_name');
    assert.deepStrictEqual(deletes.sort(), ['payments', 'transactions', 'transactions']);
    // The flag is local to that transaction.
    const other = await capturedPayment();
    await assert.rejects(knex('payments').where({ id: other.id }).del(), /cannot be deleted/);
  });
});
