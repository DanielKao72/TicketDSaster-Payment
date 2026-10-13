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

test('Payment.create assigns an id', () => {
  const first = Payment.create(VALID_PAYMENT);
  const second = Payment.create(VALID_PAYMENT);

  assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.notStrictEqual(first.id, second.id);
});

test('each transition records its Transaction', () => {
  const payment = Payment.create(VALID_PAYMENT);

  payment.authorize('ch_1');
  payment.capture('ch_1');
  payment.refund('re_1');

  assert.deepStrictEqual(
    payment.transactions.map(({ type, status, amount, providerReference }) => [
      type,
      status,
      amount,
      providerReference,
    ]),
    [
      ['CHARGE', 'SUCCEEDED', 150000, 'ch_1'],
      ['CAPTURE', 'SUCCEEDED', 150000, 'ch_1'],
      ['REFUND', 'SUCCEEDED', 150000, 're_1'],
    ],
  );
});

test('chargeReference is the reference of the successful charge', () => {
  const payment = Payment.create(VALID_PAYMENT);
  assert.strictEqual(payment.chargeReference, null);

  payment.authorize('ch_1');

  assert.strictEqual(payment.chargeReference, 'ch_1');
});

test('fail keeps the decline reason and records a failed CHARGE or CAPTURE', () => {
  const declinedCharge = Payment.create(VALID_PAYMENT);
  const declinedCapture = Payment.create(VALID_PAYMENT);
  declinedCapture.authorize('ch_1');

  declinedCharge.fail('card_declined', 'ch_0');
  declinedCapture.fail('expired_authorization', 'ch_1');

  assert.strictEqual(declinedCharge.declineReason, 'card_declined');
  assert.strictEqual(declinedCharge.transactions.at(-1).type, 'CHARGE');
  assert.strictEqual(declinedCapture.transactions.at(-1).type, 'CAPTURE');
  assert.strictEqual(declinedCapture.transactions.at(-1).status, 'FAILED');
});

test('declineRefund keeps the payment CAPTURED and only applies to captured payments', () => {
  const payment = paymentIn('CAPTURED');

  payment.declineRefund('refund_window_expired', 're_1');

  assert.strictEqual(payment.status, 'CAPTURED');
  assert.strictEqual(payment.declineReason, 'refund_window_expired');
  assert.strictEqual(payment.transactions.at(-1).status, 'FAILED');
  assert.throws(() => paymentIn('AUTHORIZED').declineRefund('x'), InvalidPaymentTransitionError);
});

test('awaitProviderResult records a PENDING transaction without changing the status', () => {
  const payment = Payment.create(VALID_PAYMENT);

  payment.awaitProviderResult('CHARGE', 'ch_1');

  assert.strictEqual(payment.status, 'PENDING');
  assert.strictEqual(payment.transactions.at(-1).status, 'PENDING');
});

test('assertCanTransitionTo rejects without changing anything', () => {
  const payment = paymentIn('FAILED');

  assert.throws(() => payment.assertCanTransitionTo('CAPTURED'), InvalidPaymentTransitionError);
  assert.strictEqual(payment.status, 'FAILED');
  assert.strictEqual(payment.transactions.length, 0);
});

test('transactions cannot be mutated from outside', () => {
  const payment = Payment.create(VALID_PAYMENT);

  payment.transactions.push({ type: 'REFUND' });

  assert.strictEqual(payment.transactions.length, 0);
});
