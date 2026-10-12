const {
  DomainError,
  InvalidMoneyError,
  InvalidPaymentTransitionError,
} = require('../../../core/domain/errors');

const STATUS_BY_ERROR = new Map([
  [InvalidMoneyError, 400],
  [InvalidPaymentTransitionError, 409],
]);

function statusFor(err) {
  for (const [ErrorType, status] of STATUS_BY_ERROR) {
    if (err instanceof ErrorType) return status;
  }
  return 500;
}

// Express recognizes error handlers by their four parameters, so `next` must stay.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = statusFor(err);

  if (status === 500) {
    // Log only the error itself: request bodies may carry payment details.
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    return;
  }

  const code = err instanceof DomainError ? err.code : 'ERROR';
  res.status(status).json({ error: { code, message: err.message } });
}

module.exports = { errorHandler };
