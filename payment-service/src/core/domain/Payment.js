const { randomUUID } = require('node:crypto');
const { createMoney } = require('./Money');
const { PaymentStatus, canTransition } = require('./PaymentStatus');
const { TransactionType, TransactionStatus, createTransaction } = require('./Transaction');
const { InvalidPaymentTransitionError } = require('./DomainErrors');

// Aggregate root. Status transitions only happen through its methods, and each one
// records the Transaction (provider operation) that caused it.
class Payment {
  #status;
  #declineReason;
  #transactions;

  constructor({
    id,
    sessionId,
    userId,
    amount,
    currency,
    status,
    declineReason = null,
    transactions = [],
    createdAt,
    updatedAt,
  }) {
    const money = createMoney(amount, currency);
    this.id = id;
    this.sessionId = sessionId;
    this.userId = userId;
    this.amount = money.amount;
    this.currency = money.currency;
    this.#status = status;
    this.#declineReason = declineReason;
    this.#transactions = [...transactions];
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static create({ sessionId, userId, amount, currency }) {
    return new Payment({
      id: randomUUID(),
      sessionId,
      userId,
      amount,
      currency,
      status: PaymentStatus.PENDING,
    });
  }

  static fromPersistence(snapshot) {
    return new Payment(snapshot);
  }

  get status() {
    return this.#status;
  }

  get declineReason() {
    return this.#declineReason;
  }

  get transactions() {
    return [...this.#transactions];
  }

  // Provider reference of the successful charge; capture and refund act on it.
  get chargeReference() {
    const charge = this.#transactions.findLast(
      (t) => t.type === TransactionType.CHARGE && t.status === TransactionStatus.SUCCEEDED,
    );
    return charge?.providerReference ?? null;
  }

  // Lets use cases reject an invalid operation before calling the provider.
  assertCanTransitionTo(next) {
    if (!canTransition(this.#status, next)) {
      throw new InvalidPaymentTransitionError(this.#status, next);
    }
  }

  authorize(providerReference) {
    this.#transitionTo(PaymentStatus.AUTHORIZED);
    this.#record(TransactionType.CHARGE, TransactionStatus.SUCCEEDED, providerReference);
  }

  capture(providerReference) {
    this.#transitionTo(PaymentStatus.CAPTURED);
    this.#record(TransactionType.CAPTURE, TransactionStatus.SUCCEEDED, providerReference);
  }

  // A declined charge (from PENDING) or a declined capture (from AUTHORIZED).
  fail(declineReason, providerReference) {
    const type =
      this.#status === PaymentStatus.AUTHORIZED ? TransactionType.CAPTURE : TransactionType.CHARGE;
    this.#transitionTo(PaymentStatus.FAILED);
    this.#declineReason = declineReason ?? null;
    this.#record(type, TransactionStatus.FAILED, providerReference);
  }

  refund(providerReference) {
    this.#transitionTo(PaymentStatus.REFUNDED);
    this.#record(TransactionType.REFUND, TransactionStatus.SUCCEEDED, providerReference);
  }

  // The provider declined the refund: the payment stays CAPTURED.
  declineRefund(declineReason, providerReference) {
    this.assertCanTransitionTo(PaymentStatus.REFUNDED);
    this.#declineReason = declineReason ?? null;
    this.#record(TransactionType.REFUND, TransactionStatus.FAILED, providerReference);
  }

  // The provider will report the result later (webhook); the status does not change yet.
  awaitProviderResult(type, providerReference) {
    this.#record(type, TransactionStatus.PENDING, providerReference);
  }

  toSnapshot() {
    return {
      id: this.id,
      sessionId: this.sessionId,
      userId: this.userId,
      amount: this.amount,
      currency: this.currency,
      status: this.#status,
      declineReason: this.#declineReason,
      transactions: this.transactions,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  #transitionTo(next) {
    this.assertCanTransitionTo(next);
    this.#status = next;
  }

  #record(type, status, providerReference) {
    this.#transactions.push(
      createTransaction({ type, status, amount: this.amount, providerReference }),
    );
  }
}

module.exports = { Payment };
