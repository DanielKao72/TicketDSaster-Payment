const { test } = require('node:test');
const assert = require('node:assert');
const { Payment } = require('../../../src/core/domain/Payment');
const { PAYMENT_STATUSES } = require('../../../src/core/domain/PaymentStatus');
const {
  InvalidMoneyError,
  InvalidPaymentTransitionError,
} = require('../../../src/core/domain/DomainErrors');

const VALID_PAYMENT = {
  sessionId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
  amount: 150000,
  currency: 'MXN',
};

function paymentIn(status) {
  return Payment.fromPersistence({ ...VALID_PAYMENT, id: 'payment-1', status });
}

test('Payment.create starts in PENDING', () => {
  const payment = Payment.create(VALID_PAYMENT);

  assert.strictEqual(payment.status, 'PENDING');
  assert.strictEqual(payment.amount, 150000);
  assert.strictEqual(payment.currency, 'MXN');
});

test('PENDING → AUTHORIZED → CAPTURED → REFUNDED is allowed', () => {
  const payment = Payment.create(VALID_PAYMENT);

  payment.authorize();
  payment.capture();
  payment.refund();

  assert.strictEqual(payment.status, 'REFUNDED');
});

test('PENDING → CAPTURED is allowed (provider captures in one step)', () => {
  const payment = Payment.create(VALID_PAYMENT);

  payment.capture();

  assert.strictEqual(payment.status, 'CAPTURED');
});

test('PENDING → FAILED and AUTHORIZED → FAILED are allowed', () => {
  const pending = Payment.create(VALID_PAYMENT);
  const authorized = paymentIn('AUTHORIZED');

  pending.fail();
  authorized.fail();

  assert.strictEqual(pending.status, 'FAILED');
  assert.strictEqual(authorized.status, 'FAILED');
});

test('invalid transitions throw InvalidPaymentTransitionError', () => {
  const cases = [
    ['CAPTURED', (p) => p.authorize()],
    ['FAILED', (p) => p.capture()],
    ['PENDING', (p) => p.refund()],
    ['AUTHORIZED', (p) => p.refund()],
    ['CAPTURED', (p) => p.fail()],
  ];

  for (const [status, transition] of cases) {
    const payment = paymentIn(status);
    assert.throws(() => transition(payment), InvalidPaymentTransitionError);
    assert.strictEqual(payment.status, status);
  }
});

test('REFUNDED is terminal', () => {
  const transitions = ['authorize', 'capture', 'fail', 'refund'];

  for (const transition of transitions) {
    assert.throws(() => paymentIn('REFUNDED')[transition](), InvalidPaymentTransitionError);
  }
});

test('invalid money is rejected', () => {
  const invalid = [
    { amount: 10.5 },
    { amount: 0 },
    { amount: -100 },
    { amount: '1000' },
    { currency: 'usd' },
    { currency: 'MXNN' },
  ];

  for (const override of invalid) {
    assert.throws(() => Payment.create({ ...VALID_PAYMENT, ...override }), InvalidMoneyError);
  }
});

test('toSnapshot round-trips through fromPersistence', () => {
  const snapshot = paymentIn('AUTHORIZED').toSnapshot();

  assert.deepStrictEqual(Payment.fromPersistence(snapshot).toSnapshot(), snapshot);
});

test('PAYMENT_STATUSES matches the payment_status enum', () => {
  assert.deepStrictEqual(PAYMENT_STATUSES, [
    'PENDING',
    'AUTHORIZED',
    'CAPTURED',
    'FAILED',
    'REFUNDED',
  ]);
});
