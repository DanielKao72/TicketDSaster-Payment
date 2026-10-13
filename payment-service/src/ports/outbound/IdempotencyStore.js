const { NotImplementedError, ensurePortImplementation } = require('../Port');

// Outbound port: storage of Idempotency Keys (table `idempotency_keys`).
// A repeated key with the same requestHash replays the stored response; with a
// different requestHash it is a 409.
//
// IdempotencyRecord: { key, requestHash, paymentId, responseStatus, responseBody }
//   responseStatus is null while the first request with that key is still running.
class IdempotencyStore {
  constructor() {
    ensurePortImplementation(this, IdempotencyStore);
  }

  // Atomically claims the key. Resolves to null when this call claimed it, or to the
  // existing IdempotencyRecord when another request already did. Two concurrent
  // requests with the same key must never both get null.
  async claim({ key, requestHash }) {
    throw new NotImplementedError('IdempotencyStore.claim');
  }

  // Stores the response of a claimed key so retries replay it.
  async complete(key, { paymentId, responseStatus, responseBody }) {
    throw new NotImplementedError('IdempotencyStore.complete');
  }

  // Frees a claimed key (the request failed with a 5xx), so a retry runs again.
  async release(key) {
    throw new NotImplementedError('IdempotencyStore.release');
  }
}

module.exports = { IdempotencyStore };
