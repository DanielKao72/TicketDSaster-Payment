// Lease behavior of the Idempotency middleware (RF-22): a key whose request never
// finished becomes reusable after the lease, and the late request cannot overwrite the
// response of the one that took the key over.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { idempotency } = require('../../../../src/infrastructure/express/middlewares/Idempotency');
const { errorHandler } = require('../../../../src/infrastructure/express/middlewares/ErrorHandler');
const {
  InMemoryIdempotencyStore,
} = require('../../../../src/adapters/repositories/InMemoryIdempotencyStore');

const LEASE_SECONDS = 60;

let server;
let baseUrl;
let now;
let calls;
let pending;

// Each call to the handler waits until the test resolves it, so a test can keep a
// request "running" (or never finish it, like a crashed process).
function nextResponse() {
  return new Promise((resolve) => pending.push(resolve));
}

beforeEach(() => {
  now = Date.now();
  calls = 0;
  pending = [];
  const store = new InMemoryIdempotencyStore({ leaseSeconds: LEASE_SECONDS, now: () => now });

  const app = express();
  app.use(express.json());
  app.post('/payments', idempotency(store), async (req, res) => {
    calls += 1;
    const body = await nextResponse();
    res.status(201).json(body);
  });
  app.use(errorHandler);

  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

afterEach(() => {
  server.closeAllConnections();
  server.close();
});

function post(body, { key = 'key-1', signal } = {}) {
  return fetch(`${baseUrl}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
    signal,
  });
}

// Starts a request that reaches the handler and stays there.
async function startAbandonedRequest(body) {
  const controller = new AbortController();
  post(body, { signal: controller.signal }).catch(() => {});
  while (pending.length === 0) await new Promise((resolve) => setImmediate(resolve));
  return { abort: () => controller.abort(), finish: pending.shift() };
}

test('an in-progress key is a 409 with Retry-After until its lease expires', async () => {
  await startAbandonedRequest({ amount: 100 });
  now += 20 * 1000;

  const response = await post({ amount: 100 });

  assert.strictEqual(response.status, 409);
  assert.strictEqual((await response.json()).error.code, 'IDEMPOTENCY_IN_PROGRESS');
  const retryAfter = Number(response.headers.get('Retry-After'));
  assert.ok(retryAfter > 0 && retryAfter <= LEASE_SECONDS, `Retry-After was ${retryAfter}`);
  assert.strictEqual(calls, 1);
});

test('an abandoned key runs the same request again once its lease expires', async () => {
  const abandoned = await startAbandonedRequest({ amount: 100 });
  abandoned.abort();
  now += (LEASE_SECONDS + 1) * 1000;

  const retry = post({ amount: 100 });
  while (pending.length === 0) await new Promise((resolve) => setImmediate(resolve));
  pending.shift()({ id: 'second' });
  const response = await retry;

  assert.strictEqual(response.status, 201);
  assert.deepStrictEqual(await response.json(), { id: 'second' });
  assert.strictEqual(calls, 2);

  const replay = await post({ amount: 100 });
  assert.strictEqual(replay.headers.get('Idempotent-Replayed'), 'true');
  assert.deepStrictEqual(await replay.json(), { id: 'second' });
});

test('an abandoned key is still a 409 for a different request', async () => {
  await startAbandonedRequest({ amount: 100 });
  now += (LEASE_SECONDS + 1) * 1000;

  const response = await post({ amount: 999 });

  assert.strictEqual(response.status, 409);
  assert.strictEqual((await response.json()).error.code, 'IDEMPOTENCY_KEY_MISMATCH');
  assert.strictEqual(calls, 1);
});

test('a request that outlived its lease does not overwrite the new response', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const late = await startAbandonedRequest({ amount: 100 });
  now += (LEASE_SECONDS + 1) * 1000;

  const retry = post({ amount: 100 });
  while (pending.length === 0) await new Promise((resolve) => setImmediate(resolve));
  pending.shift()({ id: 'second' });
  await (await retry).json();

  late.finish({ id: 'late' });
  while (warn.mock.callCount() === 0) await new Promise((resolve) => setImmediate(resolve));

  const replay = await post({ amount: 100 });
  assert.deepStrictEqual(await replay.json(), { id: 'second' });
  assert.match(warn.mock.calls[0].arguments[0], /lease expired/);
});
