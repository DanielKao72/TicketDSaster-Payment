const { createMoney } = require('./Money');
const { PaymentStatus, canTransition } = require('./PaymentStatus');
const { InvalidPaymentTransitionError } = require('./DomainErrors');

// Aggregate root. Status transitions only happen through its methods.
class Payment {
  #status;

  constructor({ id, sessionId, userId, amount, currency, status, createdAt, updatedAt }) {
    const money = createMoney(amount, currency);
    this.id = id;
    this.sessionId = sessionId;
    this.userId = userId;
    this.amount = money.amount;
    this.currency = money.currency;
    this.#status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static create({ sessionId, userId, amount, currency }) {
    return new Payment({ sessionId, userId, amount, currency, status: PaymentStatus.PENDING });
  }

  static fromPersistence(snapshot) {
    return new Payment(snapshot);
  }

  get status() {
    return this.#status;
  }

  authorize() {
    this.#transitionTo(PaymentStatus.AUTHORIZED);
  }

  capture() {
    this.#transitionTo(PaymentStatus.CAPTURED);
  }

  fail() {
    this.#transitionTo(PaymentStatus.FAILED);
  }

  refund() {
    this.#transitionTo(PaymentStatus.REFUNDED);
  }

  toSnapshot() {
    return {
      id: this.id,
      sessionId: this.sessionId,
      userId: this.userId,
      amount: this.amount,
      currency: this.currency,
      status: this.#status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  #transitionTo(next) {
    if (!canTransition(this.#status, next)) {
      throw new InvalidPaymentTransitionError(this.#status, next);
    }
    this.#status = next;
  }
}

module.exports = { Payment };
