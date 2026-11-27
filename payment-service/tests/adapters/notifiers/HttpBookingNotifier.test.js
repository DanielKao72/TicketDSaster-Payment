const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { HttpBookingNotifier } = require('../../../src/adapters/notifiers/HttpBookingNotifier');
const { BOOKING_NOTIFY_PATH } = require('../../../src/ports/outbound/BookingNotifierContract');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Creates a lightweight HTTP server that replies with the given responses in order.
 * responses: Array of { status, body? } – consumed one per request.
 * Any extra request beyond the list gets a 200.
 */
function makeServer(responses) {
  const received = [];
  const queue = [...responses];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      received.push({ method: req.method, url: req.url, headers: req.headers, body });
      const { status = 200, body: resBody = '{}' } = queue.shift() ?? {};
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(resBody);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        server,
        baseUrl,
        received,
        close: () => server.close(),
      });
    });
  });
}

function failedPayment(overrides = {}) {
  return {
    id: 'pay-test-1',
    status: 'FAILED',
    declineReason: 'insufficient_funds',
    chargeReference: 'pi_test_ref',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HttpBookingNotifier', () => {
  test('sends correct payload, path and Authorization header on first try', async () => {
    const { baseUrl, received, close } = await makeServer([{ status: 200 }]);
    try {
      const notifier = new HttpBookingNotifier({
        notifyUrl: baseUrl,
        serviceToken: 'tok-secret',
        timeoutMs: 2000,
      });

      const payment = failedPayment();
      await notifier.notifyPaymentResult(payment);
      await new Promise(setImmediate);

      assert.equal(received.length, 1);
      const req = received[0];
      assert.equal(req.method, 'POST');
      assert.equal(req.url, BOOKING_NOTIFY_PATH);
      assert.equal(req.headers['authorization'], 'Bearer tok-secret');
      assert.equal(req.headers['content-type'], 'application/json');

      const body = JSON.parse(req.body);
      assert.equal(body.paymentId, payment.id);
      assert.equal(body.providerReference, payment.chargeReference);
      assert.equal(body.status, payment.status);
      assert.equal(body.declineReason, payment.declineReason);
      assert.ok(body.occurredAt);
    } finally {
      close();
    }
  });

  test('retries on 5xx and succeeds on the second attempt', async () => {
    const { baseUrl, received, close } = await makeServer([{ status: 503 }, { status: 200 }]);
    try {
      const notifier = new HttpBookingNotifier({
        notifyUrl: baseUrl,
        serviceToken: null,
        timeoutMs: 2000,
      });

      await notifier.notifyPaymentResult(failedPayment());
      await new Promise(setImmediate);

      assert.equal(received.length, 2);
    } finally {
      close();
    }
  });

  test('does NOT retry on 4xx', async () => {
    const { baseUrl, received, close } = await makeServer([{ status: 422 }]);
    try {
      const notifier = new HttpBookingNotifier({
        notifyUrl: baseUrl,
        serviceToken: null,
        timeoutMs: 2000,
      });

      await notifier.notifyPaymentResult(failedPayment());
      await new Promise(setImmediate);

      assert.equal(received.length, 1);
    } finally {
      close();
    }
  });

  test('does NOT notify for statuses not in NOTIFY_STATUSES', async () => {
    const { baseUrl, received, close } = await makeServer([]);
    try {
      const notifier = new HttpBookingNotifier({ notifyUrl: baseUrl, timeoutMs: 1000 });

      // CAPTURED is not in NOTIFY_STATUSES
      await notifier.notifyPaymentResult({ ...failedPayment(), status: 'CAPTURED' });
      await new Promise(setImmediate);

      assert.equal(received.length, 0);
    } finally {
      close();
    }
  });

  test('exhausts retries and does not throw', async () => {
    // Respond 503 three times (1 attempt + 2 retries)
    const { baseUrl, received, close } = await makeServer([
      { status: 503 },
      { status: 503 },
      { status: 503 },
    ]);
    try {
      const notifier = new HttpBookingNotifier({
        notifyUrl: baseUrl,
        serviceToken: null,
        timeoutMs: 2000,
      });

      // Must resolve without throwing despite all retries failing
      await assert.doesNotReject(() => notifier.notifyPaymentResult(failedPayment()));
      await new Promise(setImmediate);

      assert.equal(received.length, 3);
    } finally {
      close();
    }
  });

  test('times out and does not throw', async () => {
    // Server that never responds
    const server = http.createServer(() => {}); // never calls res.end
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      const notifier = new HttpBookingNotifier({
        notifyUrl: `http://127.0.0.1:${port}`,
        serviceToken: null,
        timeoutMs: 100,
      });

      await assert.doesNotReject(() => notifier.notifyPaymentResult(failedPayment()));
    } finally {
      server.close();
    }
  });
});
