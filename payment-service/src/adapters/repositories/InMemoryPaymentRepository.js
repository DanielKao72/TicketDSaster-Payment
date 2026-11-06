const { randomUUID } = require('node:crypto');
const { Payment } = require('../../core/domain/Payment');
const { PaymentStatus } = require('../../core/domain/PaymentStatus');
const { PaymentAlreadyExistsError } = require('../../core/domain/DomainErrors');
const { PaymentRepository } = require('../../ports/outbound/PaymentRepository');

// In-memory Payment Store for tests and for running the service without Postgres
// (PAYMENT_STORE=memory). Data is lost on restart.
class InMemoryPaymentRepository extends PaymentRepository {
  // id -> snapshot
  #snapshots = new Map();

  // Synchronous up to the end, so the one-active-payment check is atomic.
  async save(payment) {
    const now = new Date();
    const snapshot = payment.toSnapshot();
    const previous = this.#snapshots.get(snapshot.id);

    if (snapshot.status !== PaymentStatus.FAILED) {
      const active = [...this.#snapshots.values()].some(
        (s) =>
          s.id !== snapshot.id &&
          s.sessionId === snapshot.sessionId &&
          s.status !== PaymentStatus.FAILED,
      );
      if (active) throw new PaymentAlreadyExistsError(snapshot.sessionId);
    }

    const stored = {
      ...snapshot,
      transactions: snapshot.transactions.map((transaction) =>
        transaction.id ? transaction : { ...transaction, id: randomUUID(), createdAt: now },
      ),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.#snapshots.set(stored.id, stored);
    return Payment.fromPersistence(stored);
  }

  async discardPending(payment) {
    const stored = this.#snapshots.get(payment.id);
    if (!stored || stored.status !== PaymentStatus.PENDING || stored.transactions.length > 0) {
      return false;
    }
    this.#snapshots.delete(payment.id);
    return true;
  }

  async findById(id) {
    const snapshot = this.#snapshots.get(id);
    return snapshot ? Payment.fromPersistence(snapshot) : null;
  }

  async findBySessionId(sessionId) {
    // Map keeps insertion order, so the last match is the most recent payment.
    const snapshot = [...this.#snapshots.values()].findLast((s) => s.sessionId === sessionId);
    return snapshot ? Payment.fromPersistence(snapshot) : null;
  }
}

module.exports = { InMemoryPaymentRepository };
