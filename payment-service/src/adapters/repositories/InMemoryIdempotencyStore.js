const { IdempotencyStore } = require('../../ports/outbound/IdempotencyStore');

// In-memory Idempotency Key store (PAYMENT_STORE=memory). claim is atomic because
// it runs synchronously up to the first await.
class InMemoryIdempotencyStore extends IdempotencyStore {
  #records = new Map();

  async claim({ key, requestHash }) {
    const existing = this.#records.get(key);
    if (existing) return { ...existing };

    this.#records.set(key, {
      key,
      requestHash,
      paymentId: null,
      responseStatus: null,
      responseBody: null,
    });
    return null;
  }

  async complete(key, { paymentId = null, responseStatus, responseBody }) {
    const record = this.#records.get(key);
    if (record) Object.assign(record, { paymentId, responseStatus, responseBody });
  }

  async release(key) {
    this.#records.delete(key);
  }
}

module.exports = { InMemoryIdempotencyStore };
