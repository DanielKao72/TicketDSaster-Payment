const {
  DomainError,
  InvalidMoneyError,
  InvalidPaymentTransitionError,
  PaymentNotFoundError,
  PaymentAlreadyExistsError,
  PaymentAccessDeniedError,
  ProviderUnavailableError,
} = require('../../../core/domain/DomainErrors');
const { HttpError } = require('../HttpError');

const STATUS_BY_ERROR = new Map([
  [InvalidMoneyError, 400],
  [PaymentAccessDeniedError, 403],
  [PaymentNotFoundError, 404],
  [InvalidPaymentTransitionError, 409],
  [PaymentAlreadyExistsError, 409],
  [ProviderUnavailableError, 502],
]);

function statusFor(err) {
  if (err instanceof HttpError) return err.status;
  // express.json() errors (malformed JSON, body too large) carry their own 4xx status.
  if (err.type && Number.isInteger(err.status) && err.status < 500) return err.status;
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

  const code = err instanceof DomainError || err instanceof HttpError ? err.code : 'BAD_REQUEST';
  res.status(status).json({ error: { code, message: err.message } });
}

module.exports = { errorHandler };
