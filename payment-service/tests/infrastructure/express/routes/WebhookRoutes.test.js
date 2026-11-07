const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { buildApp } = require('../../../../src/infrastructure/express/App');
const { CreatePaymentUseCase } = require('../../../../src/core/use-cases/CreatePaymentUseCase');
const {
  InMemoryPaymentRepository,
} = require('../../../../src/adapters/repositories/InMemoryPaymentRepository');
const {
  InMemoryProcessedEventStore,
} = require('../../../../src/adapters/repositories/InMemoryProcessedEventStore');
const {
  InMemoryIdempotencyStore,
} = require('../../../../src/adapters/repositories/InMemoryIdempotencyStore');
const { FakePaymentProvider } = require('../../../../src/adapters/providers/FakePaymentProvider');
const { StripeWebhookAdapter } = require('../../../../src/adapters/providers/StripeWebhookAdapter');
const { PAYMENT_REQUEST } = require('../../../core/use-cases/Fixtures');

const WEBHOOK_SECRET = 'whsec_test_secret';
const PROVIDER_REFERENCE = 'pi_pending_1';

let server;
let baseUrl;
let paymentRepository;
let payment;

function sign(body, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function eventBody(overrides = {}) {
  return JSON.stringify({
    id: 'evt_1',
    type: 'payment_intent.amount_capturable_updated',
    data: { object: { id: PROVIDER_REFERENCE } },
    ...overrides,
  });
}

function postWebhook(body, signature = sign(body)) {
  return fetch(`${baseUrl}/webhooks/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
    body,
  });
}

beforeEach(async () => {
  paymentRepository = new InMemoryPaymentRepository();
  const createPayment = new CreatePaymentUseCase({
    paymentRepository,
    paymentProvider: {
      authorize: async () => ({ status: 'PENDING', providerReference: PROVIDER_REFERENCE }),
    },
  });
  payment = await createPayment.execute(PAYMENT_REQUEST);

  const app = buildApp({
    paymentRepository,
    paymentProvider: new FakePaymentProvider(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    processedEventStore: new InMemoryProcessedEventStore(),
    webhookAdapter: new StripeWebhookAdapter({ webhookSecret: WEBHOOK_SECRET }),
    jwtSecret: 'test-secret',
  });
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

afterEach(() => {
  server.close();
});

test('a signed event resolves the PENDING payment without a JWT', async () => {
  const body = eventBody();

  const response = await postWebhook(body);

  assert.strictEqual(response.status, 200);
  assert.strictEqual((await response.json()).outcome, 'applied');
  assert.strictEqual((await paymentRepository.findById(payment.id)).status, 'AUTHORIZED');
});

test('a retried delivery is acknowledged as a duplicate and changes nothing', async () => {
  const body = eventBody();
  await postWebhook(body);

  const response = await postWebhook(body);

  assert.strictEqual(response.status, 200);
  assert.strictEqual((await response.json()).outcome, 'duplicate');
  const stored = await paymentRepository.findById(payment.id);
  assert.strictEqual(stored.status, 'AUTHORIZED');
  assert.strictEqual(stored.transactions.length, payment.transactions.length + 1);
});

test('verifies the signature over the exact raw body', async () => {
  const body =
    '{\n  "id": "evt_spaces",\n  "type": "payment_intent.succeeded",\n  "data": { "object": { "id": "pi_pending_1" } }\n}';

  const response = await postWebhook(body);

  assert.strictEqual(response.status, 200);
  assert.strictEqual((await paymentRepository.findById(payment.id)).status, 'CAPTURED');
});

test('rejects an invalid signature with 400 and leaves the payment untouched', async () => {
  const body = eventBody();

  const response = await postWebhook(body, sign(body, Math.floor(Date.now() / 1000) - 3600));

  assert.strictEqual(response.status, 400);
  assert.strictEqual((await response.json()).error.code, 'INVALID_WEBHOOK_SIGNATURE');
  assert.strictEqual((await paymentRepository.findById(payment.id)).status, 'PENDING');
});

test('acknowledges an event for an unknown provider reference', async () => {
  const body = eventBody({ data: { object: { id: 'pi_unknown' } } });

  const response = await postWebhook(body);

  assert.strictEqual(response.status, 200);
  assert.strictEqual((await response.json()).outcome, 'ignored');
});

test('rejects a signed but malformed event with 400', async () => {
  const body = JSON.stringify({ type: 'payment_intent.succeeded' });

  const response = await postWebhook(body);

  assert.strictEqual(response.status, 400);
  assert.strictEqual((await response.json()).error.code, 'INVALID_WEBHOOK_PAYLOAD');
});
