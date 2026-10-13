// Shared setup for use-case tests: the in-memory repository and the fake provider.
const {
  InMemoryPaymentRepository,
} = require('../../../src/adapters/repositories/InMemoryPaymentRepository');
const { FakePaymentProvider } = require('../../../src/adapters/providers/FakePaymentProvider');
const { PaymentProvider } = require('../../../src/ports/outbound/PaymentProvider');
const { CreatePaymentUseCase } = require('../../../src/core/use-cases/CreatePaymentUseCase');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';

const PAYMENT_REQUEST = {
  userId: USER_ID,
  sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  amount: 150000,
  currency: 'MXN',
  paymentMethodToken: 'tok_visa',
  idempotencyKey: 'create-1',
};

// Wraps the fake provider, counts calls (to assert "no double charge") and lets a test
// override one operation's result.
class CountingProvider extends PaymentProvider {
  constructor(overrides = {}) {
    super();
    this.inner = new FakePaymentProvider();
    this.overrides = overrides;
    this.calls = { authorize: 0, capture: 0, refund: 0 };
  }

  async authorize(request) {
    return this.#call('authorize', request);
  }

  async capture(request) {
    return this.#call('capture', request);
  }

  async refund(request) {
    return this.#call('refund', request);
  }

  verifyWebhookSignature(rawBody, signature) {
    return this.inner.verifyWebhookSignature(rawBody, signature);
  }

  #call(operation, request) {
    this.calls[operation] += 1;
    const override = this.overrides[operation];
    return override ? override(request) : this.inner[operation](request);
  }
}

function setup(overrides) {
  const paymentRepository = new InMemoryPaymentRepository();
  const paymentProvider = new CountingProvider(overrides);
  const createPayment = new CreatePaymentUseCase({ paymentRepository, paymentProvider });
  return { paymentRepository, paymentProvider, createPayment };
}

module.exports = { USER_ID, OTHER_USER_ID, PAYMENT_REQUEST, setup };
