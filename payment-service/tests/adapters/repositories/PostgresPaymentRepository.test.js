const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  PostgresPaymentRepository,
} = require('../../../src/adapters/repositories/PostgresPaymentRepository');
const { skip, connect } = require('../../support/PostgresTestDatabase');

// Integration tests against a real Postgres, skipped unless TEST_DATABASE_URL is set.
const integration = { skip };

let db;
let repository;

before(async () => {
  if (skip) return;

  db = await connect({ pool: { min: 0, max: 5 } });
  repository = new PostgresPaymentRepository(db);
});

// Payments and transactions can only be deleted through the retention guard (6.3).
async function deletePayment(paymentId) {
  await db.transaction(async (trx) => {
    await trx.raw("SELECT set_config('payment_store.allow_delete', 'on', true)");
    await trx('transactions').where({ payment_id: paymentId }).del();
    await trx('payments').where({ id: paymentId }).del();
  });
}

after(async () => {
  if (db) await db.destroy();
});

test(
  'findByProviderReference resolves the payment that owns the transaction',
  integration,
  async () => {
    const paymentId = randomUUID();
    const providerReference = `ch_test_${randomUUID()}`;

    await db('payments').insert({
      id: paymentId,
      session_id: randomUUID(),
      user_id: randomUUID(),
      amount: 150000,
      currency: 'MXN',
      status: 'AUTHORIZED',
    });
    await db('transactions').insert({
      payment_id: paymentId,
      type: 'CHARGE',
      status: 'SUCCEEDED',
      amount: 150000,
      provider_reference: providerReference,
    });

    try {
      const payment = await repository.findByProviderReference(providerReference);

      assert.ok(payment);
      assert.strictEqual(payment.id, paymentId);
      assert.strictEqual(payment.chargeReference, providerReference);
    } finally {
      await deletePayment(paymentId);
    }
  },
);

test('findByProviderReference resolves to null for an unknown reference', integration, async () => {
  assert.strictEqual(await repository.findByProviderReference(`ch_missing_${randomUUID()}`), null);
});
