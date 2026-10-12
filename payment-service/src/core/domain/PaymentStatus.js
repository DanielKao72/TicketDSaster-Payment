// Same values as the `payment_status` enum in db/migrations.
const PaymentStatus = Object.freeze({
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
});

const PAYMENT_STATUSES = Object.freeze(Object.values(PaymentStatus));

// FAILED and REFUNDED are terminal.
const ALLOWED_TRANSITIONS = Object.freeze({
  [PaymentStatus.PENDING]: [PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED, PaymentStatus.FAILED],
  [PaymentStatus.AUTHORIZED]: [PaymentStatus.CAPTURED, PaymentStatus.FAILED],
  [PaymentStatus.CAPTURED]: [PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.REFUNDED]: [],
});

function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

module.exports = { PaymentStatus, PAYMENT_STATUSES, ALLOWED_TRANSITIONS, canTransition };
