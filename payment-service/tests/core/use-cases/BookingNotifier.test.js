const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  InMemoryPaymentRepository,
} = require('../../../src/adapters/repositories/InMemoryPaymentRepository');
const {
  InMemoryProcessedEventStore,
} = require('../../../src/adapters/repositories/InMemoryProcessedEventStore');
const { CreatePaymentUseCase } = require('../../../src/core/use-cases/CreatePaymentUseCase');
const { CapturePaymentUseCase } = require('../../../src/core/use-cases/CapturePaymentUseCase');
const {
  HandleProviderWebhookUseCase,
} = require('../../../src/core/use-cases/HandleProviderWebhookUseCase');
const { FakeBookingNotifier, PAYMENT_REQUEST, CountingProvider } = require('./Fixtures');
const { FakePaymentProvider } = require('../../../src/adapters/providers/FakePaymentProvider');

function buildCreate({ paymentRepository, bookingNotifier, authorizeResult }) {
  const paymentProvider = new CountingProvider(
    authorizeResult ? { authorize: async () => authorizeResult } : {},
  );
  return {
    createPayment: new CreatePaymentUseCase({
      paymentRepository,
      paymentProvider,
      bookingNotifier,
    }),
    paymentProvider,
  };
}

// ─── CreatePaymentUseCase ────────────────────────────────────────────────────

describe('BookingNotifier · CreatePaymentUseCase', () => {
  test('notifies Booking when authorization is FAILED', async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const bookingNotifier = new FakeBookingNotifier();
    const { createPayment } = buildCreate({ paymentRepository, bookingNotifier });

    // tok_decline triggers FAILED in FakePaymentProvider
    const payment = await createPayment.execute({
      ...PAYMENT_REQUEST,
      paymentMethodToken: 'tok_decline',
    });
    // fire-and-forget: give the microtask queue a tick
    await new Promise(setImmediate);

    assert.equal(payment.status, 'FAILED');
    assert.equal(bookingNotifier.calls.length, 1);
    assert.equal(bookingNotifier.calls[0].status, 'FAILED');
    assert.equal(bookingNotifier.calls[0].paymentId, payment.id);
  });

  test('does NOT notify Booking when authorization is AUTHORIZED', async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const bookingNotifier = new FakeBookingNotifier();
    const { createPayment } = buildCreate({ paymentRepository, bookingNotifier });

    await createPayment.execute(PAYMENT_REQUEST);
    await new Promise(setImmediate);

    assert.equal(bookingNotifier.calls.length, 0);
  });

  test('does NOT notify Booking when authorization is PENDING', async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const bookingNotifier = new FakeBookingNotifier();
    const { createPayment } = buildCreate({
      paymentRepository,
      bookingNotifier,
      authorizeResult: { status: 'PENDING', providerReference: 'ch_async' },
    });

    await createPayment.execute(PAYMENT_REQUEST);
    await new Promise(setImmediate);

    assert.equal(bookingNotifier.calls.length, 0);
  });

  test('a notifier that throws does not break the use case', async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const bookingNotifier = new FakeBookingNotifier({ shouldThrow: true });
    const { createPayment } = buildCreate({ paymentRepository, bookingNotifier });

    // Should resolve, not reject, even though the notifier throws
    const payment = await createPayment.execute({
      ...PAYMENT_REQUEST,
      paymentMethodToken: 'tok_decline',
    });
    await new Promise(setImmediate);

    assert.equal(payment.status, 'FAILED');
  });
});

// ─── CapturePaymentUseCase ───────────────────────────────────────────────────

describe('BookingNotifier · CapturePaymentUseCase', () => {
  async function authorizedPayment() {
    const paymentRepository = new InMemoryPaymentRepository();
    const provider = new FakePaymentProvider();
    const bookingNotifier = new FakeBookingNotifier();

    const created = await new CreatePaymentUseCase({
      paymentRepository,
      paymentProvider: provider,
      bookingNotifier,
    }).execute(PAYMENT_REQUEST);

    // Reset notifier calls after create (not interested in those here)
    bookingNotifier.calls = [];

    const capturePayment = new CapturePaymentUseCase({
      paymentRepository,
      paymentProvider: provider,
      bookingNotifier,
    });

    return { paymentRepository, bookingNotifier, capturePayment, paymentId: created.id };
  }

  test('does NOT notify Booking when capture succeeds (CAPTURED not in NOTIFY_STATUSES)', async () => {
    const { capturePayment, bookingNotifier, paymentId } = await authorizedPayment();

    await capturePayment.execute({
      userId: PAYMENT_REQUEST.userId,
      paymentId,
      idempotencyKey: 'capture-1',
    });
    await new Promise(setImmediate);

    assert.equal(bookingNotifier.calls.length, 0);
  });

  test('notifies Booking when capture is declined (FAILED)', async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const bookingNotifier = new FakeBookingNotifier();

    // Create an AUTHORIZED payment first
    const provider = new CountingProvider({});
    const created = await new CreatePaymentUseCase({
      paymentRepository,
      paymentProvider: provider,
      bookingNotifier,
    }).execute(PAYMENT_REQUEST);
    bookingNotifier.calls = [];

    // Capture with a provider that returns FAILED
    const failingProvider = new CountingProvider({
      capture: async () => ({ status: 'FAILED', declineReason: 'capture_declined' }),
    });
    const capturePayment = new CapturePaymentUseCase({
      paymentRepository,
      paymentProvider: failingProvider,
      bookingNotifier,
    });

    const result = await capturePayment.execute({
      userId: PAYMENT_REQUEST.userId,
      paymentId: created.id,
      idempotencyKey: 'capture-fail',
    });
    await new Promise(setImmediate);

    assert.equal(result.status, 'FAILED');
    assert.equal(bookingNotifier.calls.length, 1);
    assert.equal(bookingNotifier.calls[0].status, 'FAILED');
  });
});

// ─── HandleProviderWebhookUseCase ────────────────────────────────────────────

describe('BookingNotifier · HandleProviderWebhookUseCase', () => {
  async function pendingPayment(providerReference = 'ch_pending_wh') {
    const paymentRepository = new InMemoryPaymentRepository();
    const processedEventStore = new InMemoryProcessedEventStore();
    const bookingNotifier = new FakeBookingNotifier();

    await new CreatePaymentUseCase({
      paymentRepository,
      paymentProvider: new CountingProvider({
        authorize: async () => ({ status: 'PENDING', providerReference }),
      }),
      bookingNotifier,
    }).execute(PAYMENT_REQUEST);

    bookingNotifier.calls = [];

    const webhook = new HandleProviderWebhookUseCase({
      paymentRepository,
      processedEventStore,
      bookingNotifier,
    });

    return { paymentRepository, bookingNotifier, webhook, providerReference };
  }

  function event(providerReference, status, overrides = {}) {
    return {
      eventId: `evt_${status}_${Math.random().toString(36).slice(2)}`,
      type: `test.${status}`,
      providerReference,
      status,
      ...overrides,
    };
  }

  test('notifies Booking when webhook resolves to FAILED', async () => {
    const { webhook, bookingNotifier, providerReference } = await pendingPayment();

    await webhook.execute(event(providerReference, 'FAILED', { declineReason: 'card_declined' }));
    await new Promise(setImmediate);

    assert.equal(bookingNotifier.calls.length, 1);
    assert.equal(bookingNotifier.calls[0].status, 'FAILED');
  });

  test('does NOT notify Booking when webhook resolves to AUTHORIZED', async () => {
    const { webhook, bookingNotifier, providerReference } = await pendingPayment();

    await webhook.execute(event(providerReference, 'AUTHORIZED'));
    await new Promise(setImmediate);

    assert.equal(bookingNotifier.calls.length, 0);
  });

  test('does NOT notify Booking for a duplicate event', async () => {
    const { webhook, bookingNotifier, providerReference } = await pendingPayment();
    const sameEvent = event(providerReference, 'FAILED', { declineReason: 'x' });

    await webhook.execute(sameEvent);
    bookingNotifier.calls = [];

    await webhook.execute(sameEvent); // duplicate
    await new Promise(setImmediate);

    assert.equal(bookingNotifier.calls.length, 0);
  });

  test('does NOT notify Booking for an ignored/out-of-order event', async () => {
    const { webhook, bookingNotifier, providerReference } = await pendingPayment();

    // REFUNDED from PENDING is an invalid transition → ignored
    await webhook.execute(event(providerReference, 'REFUNDED'));
    await new Promise(setImmediate);

    assert.equal(bookingNotifier.calls.length, 0);
  });

  test('a notifier that throws does not make the webhook return an error', async () => {
    const paymentRepository = new InMemoryPaymentRepository();
    const processedEventStore = new InMemoryProcessedEventStore();
    const bookingNotifier = new FakeBookingNotifier({ shouldThrow: true });

    await new CreatePaymentUseCase({
      paymentRepository,
      paymentProvider: new CountingProvider({
        authorize: async () => ({ status: 'PENDING', providerReference: 'ch_throw' }),
      }),
      bookingNotifier,
    }).execute(PAYMENT_REQUEST);

    const webhook = new HandleProviderWebhookUseCase({
      paymentRepository,
      processedEventStore,
      bookingNotifier,
    });

    const result = await webhook.execute(event('ch_throw', 'FAILED', { declineReason: 'x' }));
    await new Promise(setImmediate);

    assert.equal(result.outcome, 'applied');
  });
});
