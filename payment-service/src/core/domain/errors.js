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

module.exports = { DomainError, InvalidMoneyError, InvalidPaymentTransitionError };
