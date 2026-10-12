const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  FakePaymentProvider,
  DECLINE_TOKEN,
} = require('../../../src/adapters/providers/fake-payment-provider');
const { PaymentProvider } = require('../../../src/ports/outbound/payment-provider.port');

const AUTHORIZE_REQUEST = {
  paymentId: 'payment-1',
  amount: 150000,
  currency: 'MXN',
  paymentMethodToken: 'tok_visa',
  idempotencyKey: 'key-1',
};

test('FakePaymentProvider implements the PaymentProvider port', () => {
  assert.ok(new FakePaymentProvider() instanceof PaymentProvider);
});

test('authorize returns AUTHORIZED in domain language', async () => {
  const provider = new FakePaymentProvider();

  const result = await provider.authorize(AUTHORIZE_REQUEST);

  assert.strictEqual(result.status, 'AUTHORIZED');
  assert.ok(result.providerReference);
});

test('the decline token returns FAILED with a reason', async () => {
  const provider = new FakePaymentProvider();

  const result = await provider.authorize({
    ...AUTHORIZE_REQUEST,
    paymentMethodToken: DECLINE_TOKEN,
  });

  assert.strictEqual(result.status, 'FAILED');
  assert.strictEqual(result.declineReason, 'card_declined');
});

test('the same idempotency key does not charge twice', async () => {
  const provider = new FakePaymentProvider();

  const first = await provider.authorize(AUTHORIZE_REQUEST);
  const retry = await provider.authorize(AUTHORIZE_REQUEST);
  const other = await provider.authorize({ ...AUTHORIZE_REQUEST, idempotencyKey: 'key-2' });

  assert.strictEqual(retry.providerReference, first.providerReference);
  assert.notStrictEqual(other.providerReference, first.providerReference);
});

test('capture and refund return CAPTURED and REFUNDED', async () => {
  const provider = new FakePaymentProvider();
  const { providerReference } = await provider.authorize(AUTHORIZE_REQUEST);

  const captured = await provider.capture({
    paymentId: 'payment-1',
    providerReference,
    amount: 150000,
    idempotencyKey: 'capture-1',
  });
  const refunded = await provider.refund({
    paymentId: 'payment-1',
    providerReference,
    amount: 150000,
    idempotencyKey: 'refund-1',
  });

  assert.strictEqual(captured.status, 'CAPTURED');
  assert.strictEqual(refunded.status, 'REFUNDED');
});

test('verifyWebhookSignature accepts only the HMAC of the body', () => {
  const provider = new FakePaymentProvider({ webhookSecret: 'secret' });
  const body = '{"event":"charge.succeeded"}';
  const signature = crypto.createHmac('sha256', 'secret').update(body).digest('hex');

  assert.strictEqual(provider.verifyWebhookSignature(body, signature), true);
  assert.strictEqual(provider.verifyWebhookSignature(body, 'bad'), false);
  assert.strictEqual(provider.verifyWebhookSignature(body, undefined), false);
});
