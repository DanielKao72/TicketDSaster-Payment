const { test } = require('node:test');
const assert = require('node:assert');
const { USER_ID, OTHER_USER_ID, PAYMENT_REQUEST, setup } = require('./Fixtures');
const { GetPaymentUseCase } = require('../../../src/core/use-cases/GetPaymentUseCase');
const {
  PaymentNotFoundError,
  PaymentAccessDeniedError,
} = require('../../../src/core/domain/DomainErrors');

const { sessionId } = PAYMENT_REQUEST;

test('finds a payment by id and by Session', async () => {
  const deps = setup();
  const payment = await deps.createPayment.execute(PAYMENT_REQUEST);
  const getPayment = new GetPaymentUseCase(deps);

  const byId = await getPayment.execute({ userId: USER_ID, paymentId: payment.id });
  const bySession = await getPayment.execute({ userId: USER_ID, sessionId });

  assert.strictEqual(byId.id, payment.id);
  assert.strictEqual(bySession.id, payment.id);
});

test('by Session returns the most recent payment', async () => {
  const deps = setup();
  await deps.createPayment.execute({ ...PAYMENT_REQUEST, paymentMethodToken: 'tok_decline' });
  const retry = await deps.createPayment.execute({
    ...PAYMENT_REQUEST,
    idempotencyKey: 'create-2',
  });

  const found = await new GetPaymentUseCase(deps).execute({ userId: USER_ID, sessionId });

  assert.strictEqual(found.id, retry.id);
});

test('other users get access denied and unknown payments are not found', async () => {
  const deps = setup();
  const payment = await deps.createPayment.execute(PAYMENT_REQUEST);
  const getPayment = new GetPaymentUseCase(deps);

  await assert.rejects(
    getPayment.execute({ userId: OTHER_USER_ID, paymentId: payment.id }),
    PaymentAccessDeniedError,
  );
  await assert.rejects(
    getPayment.execute({ userId: OTHER_USER_ID, sessionId }),
    PaymentAccessDeniedError,
  );
  await assert.rejects(
    getPayment.execute({ userId: USER_ID, paymentId: 'missing' }),
    PaymentNotFoundError,
  );
});
