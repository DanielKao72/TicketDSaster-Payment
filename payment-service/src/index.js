// Composition root: the only place that wires adapters into the app and starts the server.
const config = require('./infrastructure/config');
const { buildApp } = require('./infrastructure/express/App');
const { createKnex } = require('./infrastructure/database/Knex');
const { FakePaymentProvider } = require('./adapters/providers/FakePaymentProvider');
const { RetryingPaymentProvider } = require('./adapters/providers/RetryingPaymentProvider');
const { PostgresPaymentRepository } = require('./adapters/repositories/PostgresPaymentRepository');
const { PostgresIdempotencyStore } = require('./adapters/repositories/PostgresIdempotencyStore');
const { InMemoryPaymentRepository } = require('./adapters/repositories/InMemoryPaymentRepository');
const { InMemoryIdempotencyStore } = require('./adapters/repositories/InMemoryIdempotencyStore');
const { IdempotencyKeyPurgeJob } = require('./infrastructure/jobs/IdempotencyKeyPurgeJob');

function buildStores() {
  const { leaseSeconds } = config.idempotency;
  if (config.paymentStore === 'postgres') {
    const knex = createKnex(config);
    return {
      paymentRepository: new PostgresPaymentRepository(knex),
      idempotencyStore: new PostgresIdempotencyStore(knex, { leaseSeconds }),
    };
  }
  if (config.paymentStore === 'memory') {
    return {
      paymentRepository: new InMemoryPaymentRepository(),
      idempotencyStore: new InMemoryIdempotencyStore({ leaseSeconds }),
    };
  }
  throw new Error(`PAYMENT_STORE must be 'postgres' or 'memory', got '${config.paymentStore}'`);
}

if (!config.jwt.secret) {
  throw new Error('JWT_SECRET is required to validate the tokens issued by the Auth Service');
}

// The external provider is still mocked; a real adapter would replace FakePaymentProvider here.
const paymentProvider = new RetryingPaymentProvider({ provider: new FakePaymentProvider() });

const stores = buildStores();
const app = buildApp({ ...stores, paymentProvider, jwtSecret: config.jwt.secret });

// Deletes the Idempotency Keys past their retention period (IDEMPOTENCY_PURGE_INTERVAL_MINUTES=0 disables it).
new IdempotencyKeyPurgeJob({
  idempotencyStore: stores.idempotencyStore,
  retentionHours: config.idempotency.retentionHours,
  intervalMinutes: config.idempotency.purgeIntervalMinutes,
}).start();

app.listen(config.port, () => {
  console.log(
    `Payment Service listening on port ${config.port} (payment store: ${config.paymentStore})`,
  );
});
