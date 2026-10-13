const { test } = require('node:test');
const assert = require('node:assert');
const {
  RetryingPaymentProvider,
} = require('../../../src/adapters/providers/RetryingPaymentProvider');
const { PaymentProvider } = require('../../../src/ports/outbound/PaymentProvider');
const { ProviderUnavailableError } = require('../../../src/core/domain/DomainErrors');

// Fails with the given errors in order, then authorizes. Records every request.
class ScriptedProvider extends PaymentProvider {
  constructor(failures = [], { delayMs = 0 } = {}) {
    super();
    this.failures = [...failures];
    this.delayMs = delayMs;
    this.requests = [];
  }

  async authorize(request) {
    this.requests.push(request);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const failure = this.failures.shift();
    if (failure) throw failure;
    return { status: 'AUTHORIZED', providerReference: 'ch_1' };
  }

  async capture() {}
  async refund() {}
  verifyWebhookSignature() {
    return true;
  }
}

const REQUEST = { paymentId: 'p1', amount: 100, currency: 'MXN', idempotencyKey: 'key-1' };

test('retries ProviderUnavailableError with the same request', async () => {
  const inner = new ScriptedProvider([
    new ProviderUnavailableError(),
    new ProviderUnavailableError(),
  ]);
  const provider = new RetryingPaymentProvider({ provider: inner, retries: 2, baseDelayMs: 0 });

  const result = await provider.authorize(REQUEST);

  assert.strictEqual(result.status, 'AUTHORIZED');
  assert.strictEqual(inner.requests.length, 3);
  assert.ok(inner.requests.every((r) => r.idempotencyKey === 'key-1'));
});

test('gives up after the configured retries', async () => {
  const failures = [1, 2, 3].map(() => new ProviderUnavailableError());
  const inner = new ScriptedProvider(failures);
  const provider = new RetryingPaymentProvider({ provider: inner, retries: 2, baseDelayMs: 0 });

  await assert.rejects(provider.authorize(REQUEST), ProviderUnavailableError);
  assert.strictEqual(inner.requests.length, 3);
});

test('does not retry other errors', async () => {
  const inner = new ScriptedProvider([new TypeError('bug')]);
  const provider = new RetryingPaymentProvider({ provider: inner, baseDelayMs: 0 });

  await assert.rejects(provider.authorize(REQUEST), TypeError);
  assert.strictEqual(inner.requests.length, 1);
});

test('a slow provider times out as ProviderUnavailableError', async () => {
  const inner = new ScriptedProvider([], { delayMs: 50 });
  const provider = new RetryingPaymentProvider({ provider: inner, retries: 0, timeoutMs: 10 });

  await assert.rejects(provider.authorize(REQUEST), ProviderUnavailableError);
});
