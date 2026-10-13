const { randomUUID } = require('node:crypto');
const { Payment } = require('../../core/domain/Payment');
const { PaymentRepository } = require('../../ports/outbound/PaymentRepository');

// In-memory Payment Store for tests and for running the service without Postgres
// (PAYMENT_STORE=memory). Data is lost on restart.
class InMemoryPaymentRepository extends PaymentRepository {
  // id -> snapshot
  #snapshots = new Map();

  async save(payment) {
    const now = new Date();
    const snapshot = payment.toSnapshot();
    const previous = this.#snapshots.get(snapshot.id);

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
