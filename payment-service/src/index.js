// Composition root: the only place that wires adapters into the app and starts the server.
const config = require('./infrastructure/config');
const { buildApp } = require('./infrastructure/express/App');
const { createKnex } = require('./infrastructure/database/Knex');
const { FakePaymentProvider } = require('./adapters/providers/FakePaymentProvider');
const { RetryingPaymentProvider } = require('./adapters/providers/RetryingPaymentProvider');
const { StripeWebhookAdapter } = require('./adapters/providers/StripeWebhookAdapter');
const { PostgresPaymentRepository } = require('./adapters/repositories/PostgresPaymentRepository');
const { PostgresIdempotencyStore } = require('./adapters/repositories/PostgresIdempotencyStore');
const {
  PostgresProcessedEventStore,
} = require('./adapters/repositories/PostgresProcessedEventStore');
const { InMemoryPaymentRepository } = require('./adapters/repositories/InMemoryPaymentRepository');
const { InMemoryIdempotencyStore } = require('./adapters/repositories/InMemoryIdempotencyStore');
const {
  InMemoryProcessedEventStore,
} = require('./adapters/repositories/InMemoryProcessedEventStore');

function buildStores() {
  if (config.paymentStore === 'postgres') {
    const knex = createKnex(config);
    return {
      paymentRepository: new PostgresPaymentRepository(knex),
      idempotencyStore: new PostgresIdempotencyStore(knex),
      processedEventStore: new PostgresProcessedEventStore(knex),
    };
  }
  if (config.paymentStore === 'memory') {
    return {
      paymentRepository: new InMemoryPaymentRepository(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      processedEventStore: new InMemoryProcessedEventStore(),
    };
  }
  throw new Error(`PAYMENT_STORE must be 'postgres' or 'memory', got '${config.paymentStore}'`);
}

if (!config.jwt.secret) {
  throw new Error('JWT_SECRET is required to validate the tokens issued by the Auth Service');
}

// The external provider is still mocked; a real adapter would replace FakePaymentProvider here.
const paymentProvider = new RetryingPaymentProvider({ provider: new FakePaymentProvider() });
const webhookAdapter = new StripeWebhookAdapter({
  webhookSecret: config.webhook.secret,
});

const app = buildApp({
  ...buildStores(),
  paymentProvider,
  webhookAdapter,
  jwtSecret: config.jwt.secret,
});

app.listen(config.port, () => {
  console.log(
    `Payment Service listening on port ${config.port} (payment store: ${config.paymentStore})`,
  );
});
