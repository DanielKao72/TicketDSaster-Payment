const { ProcessedEventStore } = require('../../ports/outbound/ProcessedEventStore');

// In-memory deduplication for tests and for running without Postgres
// (PAYMENT_STORE=memory). Data is lost on restart.
class InMemoryProcessedEventStore extends ProcessedEventStore {
  #eventIds = new Set();

  async register(eventId) {
    if (this.#eventIds.has(eventId)) return false;
    this.#eventIds.add(eventId);
    return true;
  }
}

module.exports = { InMemoryProcessedEventStore };
