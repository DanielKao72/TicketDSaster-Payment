const { test } = require('node:test');
const assert = require('node:assert');
const { PAYMENT_REQUEST, setup } = require('./Fixtures');
const {
  PaymentAlreadyExistsError,
  ProviderUnavailableError,
  InvalidMoneyError,
} = require('../../../src/core/domain/DomainErrors');

test('creates an AUTHORIZED payment with its CHARGE transaction', async () => {
  const { createPayment, paymentRepository } = setup();

  const payment = await createPayment.execute(PAYMENT_REQUEST);

  assert.strictEqual(payment.status, 'AUTHORIZED');
  assert.strictEqual(payment.userId, PAYMENT_REQUEST.userId);
  assert.ok(payment.chargeReference);
  assert.ok(payment.transactions[0].id);
  const stored = await paymentRepository.findById(payment.id);
  assert.deepStrictEqual(stored.toSnapshot(), payment.toSnapshot());
});

test('a declined authorization is persisted as FAILED with the reason', async () => {
  const { createPayment } = setup();

  const payment = await createPayment.execute({
    ...PAYMENT_REQUEST,
    paymentMethodToken: 'tok_decline',
  });

  assert.strictEqual(payment.status, 'FAILED');
  assert.strictEqual(payment.declineReason, 'card_declined');
});

test('a Session with an active payment cannot be charged again', async () => {
  const { createPayment, paymentProvider } = setup();
  await createPayment.execute(PAYMENT_REQUEST);

  await assert.rejects(
    createPayment.execute({ ...PAYMENT_REQUEST, idempotencyKey: 'create-2' }),
    PaymentAlreadyExistsError,
  );
  assert.strictEqual(paymentProvider.calls.authorize, 1);
});

test('a Session whose payment FAILED can be paid again', async () => {
  const { createPayment } = setup();
  await createPayment.execute({ ...PAYMENT_REQUEST, paymentMethodToken: 'tok_decline' });

  const retry = await createPayment.execute({ ...PAYMENT_REQUEST, idempotencyKey: 'create-2' });

  assert.strictEqual(retry.status, 'AUTHORIZED');
});

test('nothing is persisted when the provider is unavailable', async () => {
  const { createPayment, paymentRepository } = setup();

  await assert.rejects(
    createPayment.execute({ ...PAYMENT_REQUEST, paymentMethodToken: 'tok_provider_error' }),
    ProviderUnavailableError,
  );
  assert.strictEqual(await paymentRepository.findBySessionId(PAYMENT_REQUEST.sessionId), null);
});

test('a PENDING provider result keeps the payment PENDING', async () => {
  const { createPayment } = setup({
    authorize: async () => ({ status: 'PENDING', providerReference: 'ch_async' }),
  });

  const payment = await createPayment.execute(PAYMENT_REQUEST);

  assert.strictEqual(payment.status, 'PENDING');
  assert.strictEqual(payment.transactions[0].status, 'PENDING');
});

test('invalid money is rejected before calling the provider', async () => {
  const { createPayment, paymentProvider } = setup();

  await assert.rejects(
    createPayment.execute({ ...PAYMENT_REQUEST, amount: 10.5 }),
    InvalidMoneyError,
  );
  assert.strictEqual(paymentProvider.calls.authorize, 0);
});
