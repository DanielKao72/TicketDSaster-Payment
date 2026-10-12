const { NotImplementedError, ensurePortImplementation } = require('../Port');

// Outbound port: storage of Idempotency Keys (table `idempotency_keys`).
// A repeated key with the same requestHash replays the stored response; with a
// different requestHash it is a 409.
//
// IdempotencyRecord: { key, requestHash, paymentId, responseStatus, responseBody }
class IdempotencyStore {
  constructor() {
    ensurePortImplementation(this, IdempotencyStore);
  }

  // Resolves to the IdempotencyRecord for that key, or null.
  async find(key) {
    throw new NotImplementedError('IdempotencyStore.find');
  }

  // Persists an IdempotencyRecord.
  async save(record) {
    throw new NotImplementedError('IdempotencyStore.save');
  }
}

module.exports = { IdempotencyStore };
