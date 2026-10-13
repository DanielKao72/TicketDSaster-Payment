class DomainError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

class InvalidMoneyError extends DomainError {
  constructor(message) {
    super(message, 'INVALID_MONEY');
  }
}

class InvalidPaymentTransitionError extends DomainError {
  constructor(from, to) {
    super(`Cannot transition payment from ${from} to ${to}`, 'INVALID_PAYMENT_TRANSITION');
    this.from = from;
    this.to = to;
  }
}

class PaymentNotFoundError extends DomainError {
  constructor() {
    super('Payment not found', 'PAYMENT_NOT_FOUND');
  }
}

class PaymentAlreadyExistsError extends DomainError {
  constructor(sessionId) {
    super(`Session ${sessionId} already has an active payment`, 'PAYMENT_ALREADY_EXISTS');
    this.sessionId = sessionId;
  }
}

class PaymentAccessDeniedError extends DomainError {
  constructor() {
    super('The payment belongs to another user', 'PAYMENT_ACCESS_DENIED');
  }
}

// Thrown by provider adapters on timeouts, network errors or provider 5xx.
class ProviderUnavailableError extends DomainError {
  constructor(message = 'The payment provider is unavailable') {
    super(message, 'PROVIDER_UNAVAILABLE');
  }
}

module.exports = {
  DomainError,
  InvalidMoneyError,
  InvalidPaymentTransitionError,
  PaymentNotFoundError,
  PaymentAlreadyExistsError,
  PaymentAccessDeniedError,
  ProviderUnavailableError,
};
