// Composition root: the only place that wires adapters into the app and starts the server.
const Stripe = require('stripe');
const config = require('./infrastructure/config');
const { buildApp } = require('./infrastructure/express/App');
const { createKnex } = require('./infrastructure/database/Knex');
const { FakePaymentProvider } = require('./adapters/providers/FakePaymentProvider');
const { RetryingPaymentProvider } = require('./adapters/providers/RetryingPaymentProvider');
const { StripePaymentProvider } = require('./adapters/providers/StripePaymentProvider');
const {
  CircuitBreakerPaymentProvider,
} = require('./adapters/providers/CircuitBreakerPaymentProvider');
const { PostgresPaymentRepository } = require('./adapters/repositories/PostgresPaymentRepository');
const { PostgresIdempotencyStore } = require('./adapters/repositories/PostgresIdempotencyStore');
const { InMemoryPaymentRepository } = require('./adapters/repositories/InMemoryPaymentRepository');
const { InMemoryIdempotencyStore } = require('./adapters/repositories/InMemoryIdempotencyStore');

function buildStores() {
  if (config.paymentStore === 'postgres') {
    const knex = createKnex(config);
    return {
      paymentRepository: new PostgresPaymentRepository(knex),
      idempotencyStore: new PostgresIdempotencyStore(knex),
    };
  }
  if (config.paymentStore === 'memory') {
    return {
      paymentRepository: new InMemoryPaymentRepository(),
      idempotencyStore: new InMemoryIdempotencyStore(),
    };
  }
  throw new Error(`PAYMENT_STORE must be 'postgres' or 'memory', got '${config.paymentStore}'`);
}

function buildPaymentProvider() {
  if (config.paymentProvider === 'fake') {
    return new RetryingPaymentProvider({ provider: new FakePaymentProvider() });
  }
  if (config.paymentProvider === 'stripe') {
    if (!config.stripe.secretKey) {
      throw new Error('STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe');
    }
    // Retries belong to RetryingPaymentProvider, so the SDK does none of its own.
    // The SDK timeout is below the decorator's 5000 ms so the SDK fails first, cleanly.
    const client = new Stripe(config.stripe.secretKey, { timeout: 4500, maxNetworkRetries: 0 });
    const stripeProvider = new StripePaymentProvider({
      client,
      webhookSecret: config.stripe.webhookSecret,
    });
    const retrying = new RetryingPaymentProvider({ provider: stripeProvider });
    return new CircuitBreakerPaymentProvider({ provider: retrying });
  }
  throw new Error(`PAYMENT_PROVIDER must be 'fake' or 'stripe', got '${config.paymentProvider}'`);
}

if (!config.jwt.secret) {
  throw new Error('JWT_SECRET is required to validate the tokens issued by the Auth Service');
}

const app = buildApp({
  ...buildStores(),
  paymentProvider: buildPaymentProvider(),
  jwtSecret: config.jwt.secret,
});

app.listen(config.port, () => {
  console.log(
    `Payment Service listening on port ${config.port} ` +
      `(payment store: ${config.paymentStore}, provider: ${config.paymentProvider})`,
  );
});
