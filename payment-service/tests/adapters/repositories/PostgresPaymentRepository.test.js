const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const knex = require('knex');
const {
  PostgresPaymentRepository,
} = require('../../../src/adapters/repositories/PostgresPaymentRepository');

// Integration tests against a real Postgres. They are skipped unless DATABASE_URL
// points to a disposable test database.
const DATABASE_URL = process.env.DATABASE_URL;
const integration = {
  skip: DATABASE_URL ? false : 'DATABASE_URL is not set (needs a test Postgres)',
};

let db;
let repository;

before(async () => {
  if (!DATABASE_URL) return;

  db = knex({ client: 'pg', connection: DATABASE_URL, pool: { min: 0, max: 5 } });
  await db.migrate.latest({ directory: path.join(__dirname, '../../../db/migrations') });
  repository = new PostgresPaymentRepository(db);
});

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
      await db('payments').where({ id: paymentId }).del();
    }
  },
);

test('findByProviderReference resolves to null for an unknown reference', integration, async () => {
  assert.strictEqual(await repository.findByProviderReference(`ch_missing_${randomUUID()}`), null);
});
