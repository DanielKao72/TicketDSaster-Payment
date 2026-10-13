// Same values as the `transaction_type` and `transaction_status` enums in db/migrations.
const TransactionType = Object.freeze({
  CHARGE: 'CHARGE',
  CAPTURE: 'CAPTURE',
  REFUND: 'REFUND',
});

const TransactionStatus = Object.freeze({
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  PENDING: 'PENDING',
});

// One operation against the provider for a Payment. It has no id until it is persisted.
function createTransaction({ type, status, amount, providerReference = null }) {
  return Object.freeze({ type, status, amount, providerReference });
}

module.exports = { TransactionType, TransactionStatus, createTransaction };
