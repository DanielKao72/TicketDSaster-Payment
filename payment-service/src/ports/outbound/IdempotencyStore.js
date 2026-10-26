const { NotImplementedError, ensurePortImplementation } = require('../Port');

// Outbound port: storage of Idempotency Keys (table `idempotency_keys`).
// A repeated key with the same requestHash replays the stored response; with a
// different requestHash it is a 409.
//
// IdempotencyRecord: { key, requestHash, paymentId, responseStatus, responseBody, leaseExpiresAt }
//   responseStatus is null while the request that claimed the key is still running.
//   leaseExpiresAt (Date) is when that in-progress claim is considered abandoned.
//
// Lease: a claim lasts for a lease period set by the adapter. If the process dies
// between claim and complete, the key is abandoned once the lease expires, and the
// same request (same requestHash) can claim it again. Each claim carries a
// leaseToken; complete and release only apply while the caller still holds the lease,
// so a request that outlived its lease cannot overwrite the new holder's response.
class IdempotencyStore {
  constructor() {
    ensurePortImplementation(this, IdempotencyStore);
  }

  // Atomically claims the key for leaseToken. Resolves to null when this call claimed
  // it (a new key, or an abandoned one with the same requestHash), or to the existing
  // IdempotencyRecord otherwise. Two concurrent requests with the same key must never
  // both get null.
  async claim({ key, requestHash, leaseToken }) {
    throw new NotImplementedError('IdempotencyStore.claim');
  }

  // Stores the response of a claimed key so retries replay it. Resolves to false, and
  // stores nothing, when leaseToken no longer holds the key.
  async complete(key, leaseToken, { paymentId, responseStatus, responseBody }) {
    throw new NotImplementedError('IdempotencyStore.complete');
  }

  // Frees a claimed key (the request failed with a 5xx), so a retry runs again.
  // Resolves to false, and frees nothing, when leaseToken no longer holds the key.
  async release(key, leaseToken) {
    throw new NotImplementedError('IdempotencyStore.release');
  }

  // Deletes the keys completed more than retentionSeconds ago, and the abandoned ones
  // whose lease expired more than retentionSeconds ago. Resolves to how many it deleted.
  async purgeExpired({ retentionSeconds }) {
    throw new NotImplementedError('IdempotencyStore.purgeExpired');
  }
}

// Default lease when the adapter is created without one. It must outlast the slowest
// request: the provider call alone can take ~20 s (5 s timeout, 2 retries with backoff).
const DEFAULT_LEASE_SECONDS = 60;

module.exports = { IdempotencyStore, DEFAULT_LEASE_SECONDS };
