const { test } = require('node:test');
const assert = require('node:assert');
const { USER_ID, PAYMENT_REQUEST, setup } = require('./Fixtures');
const { CapturePaymentUseCase } = require('../../../src/core/use-cases/CapturePaymentUseCase');
const { RefundPaymentUseCase } = require('../../../src/core/use-cases/RefundPaymentUseCase');
const { InvalidPaymentTransitionError } = require('../../../src/core/domain/DomainErrors');

async function setupCapturedPayment(overrides) {
  const deps = setup(overrides);
  const payment = await deps.createPayment.execute(PAYMENT_REQUEST);
  await new CapturePaymentUseCase(deps).execute({
    userId: USER_ID,
    paymentId: payment.id,
    idempotencyKey: 'capture-1',
  });
  return { ...deps, payment, refundPayment: new RefundPaymentUseCase(deps) };
}

function refund(refundPayment, payment, idempotencyKey = 'refund-1') {
  return refundPayment.execute({ userId: USER_ID, paymentId: payment.id, idempotencyKey });
}

test('refunds a CAPTURED payment', async () => {
  const { payment, refundPayment } = await setupCapturedPayment();

  const result = await refund(refundPayment, payment);

  assert.strictEqual(result.status, 'REFUNDED');
  assert.deepStrictEqual(
    result.transactions.map((t) => t.type),
    ['CHARGE', 'CAPTURE', 'REFUND'],
  );
});

test('a REFUNDED payment cannot be refunded twice', async () => {
  const { payment, refundPayment, paymentProvider } = await setupCapturedPayment();
  await refund(refundPayment, payment);

  await assert.rejects(refund(refundPayment, payment, 'refund-2'), InvalidPaymentTransitionError);
  assert.strictEqual(paymentProvider.calls.refund, 1);
});

test('an AUTHORIZED payment cannot be refunded', async () => {
  const deps = setup();
  const payment = await deps.createPayment.execute(PAYMENT_REQUEST);

  await assert.rejects(
    refund(new RefundPaymentUseCase(deps), payment),
    InvalidPaymentTransitionError,
  );
  assert.strictEqual(deps.paymentProvider.calls.refund, 0);
});

test('a declined refund keeps the payment CAPTURED', async () => {
  const { payment, refundPayment } = await setupCapturedPayment({
    refund: async () => ({
      status: 'FAILED',
      providerReference: 're_1',
      declineReason: 'refund_window_expired',
    }),
  });

  const result = await refund(refundPayment, payment);

  assert.strictEqual(result.status, 'CAPTURED');
  assert.strictEqual(result.declineReason, 'refund_window_expired');
  assert.strictEqual(result.transactions.at(-1).status, 'FAILED');
});
