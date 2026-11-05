const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../../../src/infrastructure/express/App');
const {
  InMemoryPaymentRepository,
} = require('../../../src/adapters/repositories/InMemoryPaymentRepository');
const {
  InMemoryIdempotencyStore,
} = require('../../../src/adapters/repositories/InMemoryIdempotencyStore');
const { FakePaymentProvider } = require('../../../src/adapters/providers/FakePaymentProvider');

test('helmet: includes security headers in responses', async () => {
  const server = buildApp().listen(0);
  const baseUrl = `http://localhost:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/health`);
    assert.strictEqual(response.status, 200);

    const headers = response.headers;
    assert.strictEqual(headers.get('x-dns-prefetch-control'), 'off');
    assert.strictEqual(headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(headers.get('x-frame-options'), 'SAMEORIGIN');
  } finally {
    server.close();
  }
});

test('rate limiter: returns 429 when max requests are exceeded', async () => {
  const server = buildApp({
    rateLimitOptions: {
      max: 2,
      windowMs: 60 * 1000,
    },
  }).listen(0);
  const baseUrl = `http://localhost:${server.address().port}`;

  try {
    const res1 = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res1.status, 200);

    const res2 = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res2.status, 200);

    const res3 = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res3.status, 429);

    const body = await res3.json();
    assert.deepStrictEqual(body, {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later.',
      },
    });
  } finally {
    server.close();
  }
});

test('body size limit: rejects requests larger than 100kb with 413', async () => {
  const server = buildApp({
    paymentRepository: new InMemoryPaymentRepository(),
    paymentProvider: new FakePaymentProvider(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    jwtConfig: { secret: 'test-secret' },
  }).listen(0);
  const baseUrl = `http://localhost:${server.address().port}`;

  try {
    // Generate an oversized payload (> 100kb)
    const largePadding = 'a'.repeat(105 * 1024);
    const response = await fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ padding: largePadding }),
    });

    assert.strictEqual(response.status, 413);
    const body = await response.json();
    assert.strictEqual(body.error.code, 'BAD_REQUEST');
  } finally {
    server.close();
  }
});
