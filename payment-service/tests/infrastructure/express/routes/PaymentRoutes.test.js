const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { buildApp } = require('../../../../src/infrastructure/express/App');
const {
  InMemoryPaymentRepository,
} = require('../../../../src/adapters/repositories/InMemoryPaymentRepository');
const {
  InMemoryIdempotencyStore,
} = require('../../../../src/adapters/repositories/InMemoryIdempotencyStore');
const { FakePaymentProvider } = require('../../../../src/adapters/providers/FakePaymentProvider');

const JWT_SECRET = 'test-secret';
const FAN_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_FAN_ID = '00000000-0000-4000-8000-000000000002';
const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

const PAYMENT_BODY = {
  sessionId: SESSION_ID,
  amount: 150000,
  currency: 'MXN',
  paymentMethodToken: 'tok_visa',
};

let server;
let baseUrl;
let paymentRepository;

function tokenFor(sub = FAN_ID, role = 'Fan', options = { expiresIn: '5m' }) {
  return jwt.sign({ sub, role }, JWT_SECRET, options);
}

function request(path, { method = 'GET', body, key, token = tokenFor(), headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createPayment(body = PAYMENT_BODY, key = 'create-1', options = {}) {
  return request('/payments', { method: 'POST', body, key, ...options });
}

beforeEach(() => {
  paymentRepository = new InMemoryPaymentRepository();
  const app = buildApp({
    paymentRepository,
    paymentProvider: new FakePaymentProvider(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    jwtSecret: JWT_SECRET,
  });
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

afterEach(() => {
  server.close();
});

test('full flow: create → capture → refund → get', async () => {
  const created = await createPayment();
  assert.strictEqual(created.status, 201);
  const payment = await created.json();
  assert.strictEqual(payment.status, 'AUTHORIZED');
  assert.strictEqual(payment.userId, FAN_ID);
  assert.strictEqual(payment.amount, 150000);

  const captured = await request(`/payments/${payment.id}/capture`, {
    method: 'POST',
    key: 'capture-1',
  });
  assert.strictEqual(captured.status, 200);
  assert.strictEqual((await captured.json()).status, 'CAPTURED');

  const refunded = await request(`/payments/${payment.id}/refund`, {
    method: 'POST',
    key: 'refund-1',
  });
  assert.strictEqual(refunded.status, 200);
  assert.strictEqual((await refunded.json()).status, 'REFUNDED');

  const byId = await request(`/payments/${payment.id}`);
  const bySession = await request(`/payments?sessionId=${SESSION_ID}`);
  assert.strictEqual((await byId.json()).status, 'REFUNDED');
  assert.strictEqual((await bySession.json()).id, payment.id);
});

test('a declined payment responds 422 with the decline reason', async () => {
  const response = await createPayment({ ...PAYMENT_BODY, paymentMethodToken: 'tok_decline' });

  assert.strictEqual(response.status, 422);
  const payment = await response.json();
  assert.strictEqual(payment.status, 'FAILED');
  assert.strictEqual(payment.declineReason, 'card_declined');
});

test('a provider outage responds 502', async () => {
  const response = await createPayment({
    ...PAYMENT_BODY,
    paymentMethodToken: 'tok_provider_error',
  });

  assert.strictEqual(response.status, 502);
  assert.strictEqual((await response.json()).error.code, 'PROVIDER_UNAVAILABLE');
});

test('idempotency: the same key and body replays the response and charges once', async () => {
  const first = await createPayment();
  const retry = await createPayment();

  assert.strictEqual(retry.status, 201);
  assert.strictEqual(retry.headers.get('Idempotent-Replayed'), 'true');
  assert.deepStrictEqual(await retry.json(), await first.json());
});

test('idempotency: the body key order does not matter', async () => {
  const first = await createPayment();
  const reordered = Object.fromEntries(Object.entries(PAYMENT_BODY).reverse());

  const retry = await createPayment(reordered);

  assert.strictEqual(retry.status, 201);
  assert.strictEqual((await retry.json()).id, (await first.json()).id);
});

test('idempotency: the same key with a different body is a 409', async () => {
  await createPayment();

  const response = await createPayment({ ...PAYMENT_BODY, amount: 999 });

  assert.strictEqual(response.status, 409);
  assert.strictEqual((await response.json()).error.code, 'IDEMPOTENCY_KEY_MISMATCH');
});

test('idempotency: another user cannot replay a key', async () => {
  await createPayment();

  const response = await createPayment(PAYMENT_BODY, 'create-1', {
    token: tokenFor(OTHER_FAN_ID),
  });

  assert.strictEqual(response.status, 409);
});

test('idempotency: a 4xx is replayed, a 5xx lets the retry run again', async () => {
  const declined = { ...PAYMENT_BODY, paymentMethodToken: 'tok_decline' };
  await createPayment(declined, 'declined-key');
  const replay = await createPayment(declined, 'declined-key');
  assert.strictEqual(replay.status, 422);
  assert.strictEqual(replay.headers.get('Idempotent-Replayed'), 'true');

  const outage = { ...PAYMENT_BODY, paymentMethodToken: 'tok_provider_error' };
  await createPayment(outage, 'outage-key');
  const retry = await createPayment(outage, 'outage-key');
  assert.strictEqual(retry.status, 502);
  assert.strictEqual(retry.headers.get('Idempotent-Replayed'), null);
});

test('concurrent requests with the same key create a single payment', async () => {
  const responses = await Promise.all([createPayment(), createPayment(), createPayment()]);
  const statuses = responses.map((r) => r.status).sort();

  assert.ok(statuses.includes(201));
  assert.ok(statuses.every((s) => s === 201 || s === 409));
  const ids = new Set();
  for (const response of responses) {
    const body = await response.json();
    if (body.id) ids.add(body.id);
  }
  assert.strictEqual(ids.size, 1);
});

test('a second payment for the same Session is a 409', async () => {
  await createPayment();

  const response = await createPayment(PAYMENT_BODY, 'create-2');

  assert.strictEqual(response.status, 409);
  assert.strictEqual((await response.json()).error.code, 'PAYMENT_ALREADY_EXISTS');
});

test('POST without Idempotency-Key is a 400', async () => {
  const response = await request('/payments', { method: 'POST', body: PAYMENT_BODY });

  assert.strictEqual(response.status, 400);
  assert.strictEqual((await response.json()).error.code, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('invalid bodies are a 400, including unknown fields such as card data', async () => {
  const invalid = [
    { ...PAYMENT_BODY, amount: 10.5 },
    { ...PAYMENT_BODY, currency: 'mxn' },
    { ...PAYMENT_BODY, sessionId: 'not-a-uuid' },
    { ...PAYMENT_BODY, cardNumber: '4242424242424242' },
    { sessionId: SESSION_ID },
  ];

  for (const [index, body] of invalid.entries()) {
    const response = await createPayment(body, `invalid-${index}`);
    assert.strictEqual(response.status, 400, JSON.stringify(body));
    assert.strictEqual((await response.json()).error.code, 'VALIDATION_ERROR');
  }
});

test('malformed JSON is a 400', async () => {
  const response = await fetch(`${baseUrl}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenFor()}`,
      'Idempotency-Key': 'bad-json',
    },
    body: '{"sessionId":',
  });

  assert.strictEqual(response.status, 400);
});

test('missing, invalid or expired tokens are a 401', async () => {
  const tokens = [
    null,
    'not-a-jwt',
    jwt.sign({ sub: FAN_ID, role: 'Fan' }, 'another-secret'),
    tokenFor(FAN_ID, 'Fan', { expiresIn: -10 }),
    tokenFor('not-a-uuid'),
    tokenFor(FAN_ID, 'Admin'),
  ];

  for (const token of tokens) {
    const response = await request(`/payments?sessionId=${SESSION_ID}`, { token });
    assert.strictEqual(response.status, 401, String(token));
  }
});

test('roles other than Fan are a 403', async () => {
  const response = await createPayment(PAYMENT_BODY, 'create-1', {
    token: tokenFor(FAN_ID, 'Organizer'),
  });

  assert.strictEqual(response.status, 403);
  assert.strictEqual((await response.json()).error.code, 'FORBIDDEN');
});

test("another user's payment is a 403, an unknown one a 404", async () => {
  const payment = await (await createPayment()).json();

  const foreign = await request(`/payments/${payment.id}`, { token: tokenFor(OTHER_FAN_ID) });
  const missing = await request('/payments/bbbbbbbb-bbbb-4bbb-8bbb-000000000000');

  assert.strictEqual(foreign.status, 403);
  assert.strictEqual(missing.status, 404);
});

test('invalid transitions are a 409', async () => {
  const declined = await (
    await createPayment({ ...PAYMENT_BODY, paymentMethodToken: 'tok_decline' })
  ).json();
  const authorized = await (
    await createPayment(
      { ...PAYMENT_BODY, sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002' },
      'create-2',
    )
  ).json();

  const capture = await request(`/payments/${declined.id}/capture`, { method: 'POST', key: 'c-1' });
  const refund = await request(`/payments/${authorized.id}/refund`, { method: 'POST', key: 'r-1' });

  assert.strictEqual(capture.status, 409);
  assert.strictEqual(refund.status, 409);
  assert.strictEqual((await capture.json()).error.code, 'INVALID_PAYMENT_TRANSITION');
});
