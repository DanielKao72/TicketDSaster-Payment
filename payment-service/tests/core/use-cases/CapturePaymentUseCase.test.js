const { test } = require('node:test');
const assert = require('node:assert');
const { USER_ID, OTHER_USER_ID, PAYMENT_REQUEST, setup } = require('./Fixtures');
const { CapturePaymentUseCase } = require('../../../src/core/use-cases/CapturePaymentUseCase');
const {
  InvalidPaymentTransitionError,
  PaymentNotFoundError,
  PaymentAccessDeniedError,
} = require('../../../src/core/domain/DomainErrors');

function setupCapture(overrides) {
  const deps = setup(overrides);
  return { ...deps, capturePayment: new CapturePaymentUseCase(deps) };
}

function capture(capturePayment, payment, overrides = {}) {
  return capturePayment.execute({
    userId: USER_ID,
    paymentId: payment.id,
    idempotencyKey: 'capture-1',
    ...overrides,
  });
}

test('captures an AUTHORIZED payment using its charge reference', async () => {
  const requests = [];
  const { createPayment, capturePayment } = setupCapture({
    capture: async (request) => {
      requests.push(request);
      return { status: 'CAPTURED', providerReference: request.providerReference };
    },
  });
  const payment = await createPayment.execute(PAYMENT_REQUEST);

  const result = await capture(capturePayment, payment);

  assert.strictEqual(result.status, 'CAPTURED');
  assert.strictEqual(requests[0].providerReference, payment.chargeReference);
  assert.strictEqual(requests[0].idempotencyKey, 'capture-1');
});

test('a FAILED payment cannot be captured and the provider is not called', async () => {
  const { createPayment, capturePayment, paymentProvider } = setupCapture();
  const payment = await createPayment.execute({
    ...PAYMENT_REQUEST,
    paymentMethodToken: 'tok_decline',
  });

  await assert.rejects(capture(capturePayment, payment), InvalidPaymentTransitionError);
  assert.strictEqual(paymentProvider.calls.capture, 0);
});

test('a CAPTURED payment cannot be captured twice', async () => {
  const { createPayment, capturePayment, paymentProvider } = setupCapture();
  const payment = await createPayment.execute(PAYMENT_REQUEST);
  await capture(capturePayment, payment);

  await assert.rejects(
    capture(capturePayment, payment, { idempotencyKey: 'capture-2' }),
    InvalidPaymentTransitionError,
  );
  assert.strictEqual(paymentProvider.calls.capture, 1);
});

test('a declined capture fails the payment', async () => {
  const { createPayment, capturePayment } = setupCapture({
    capture: async () => ({
      status: 'FAILED',
      providerReference: 'ch_1',
      declineReason: 'expired_authorization',
    }),
  });
  const payment = await createPayment.execute(PAYMENT_REQUEST);

  const result = await capture(capturePayment, payment);

  assert.strictEqual(result.status, 'FAILED');
  assert.strictEqual(result.declineReason, 'expired_authorization');
});

test('only the owner can capture, and unknown payments are not found', async () => {
  const { createPayment, capturePayment } = setupCapture();
  const payment = await createPayment.execute(PAYMENT_REQUEST);

  await assert.rejects(
    capture(capturePayment, payment, { userId: OTHER_USER_ID }),
    PaymentAccessDeniedError,
  );
  await assert.rejects(capture(capturePayment, { id: 'missing' }), PaymentNotFoundError);
});
