// Errors raised by the HTTP layer itself (auth, validation, idempotency), as opposed
// to DomainError subclasses raised by the core.
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

module.exports = { HttpError };
