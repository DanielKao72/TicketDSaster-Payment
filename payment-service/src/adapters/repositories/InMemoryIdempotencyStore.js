const {
  IdempotencyStore,
  DEFAULT_LEASE_SECONDS,
} = require('../../ports/outbound/IdempotencyStore');

// In-memory Idempotency Key store (PAYMENT_STORE=memory). claim is atomic because
// it runs synchronously up to the first await. `now` can be replaced in tests to
// move the clock past a lease or the retention period.
class InMemoryIdempotencyStore extends IdempotencyStore {
  #records = new Map();
  #leaseMs;
  #now;

  constructor({ leaseSeconds = DEFAULT_LEASE_SECONDS, now = () => Date.now() } = {}) {
    super();
    this.#leaseMs = leaseSeconds * 1000;
    this.#now = now;
  }

  async claim({ key, requestHash, leaseToken }) {
    const now = this.#now();
    const existing = this.#records.get(key);

    const abandoned =
      existing &&
      existing.responseStatus === null &&
      existing.requestHash === requestHash &&
      existing.leaseExpiresAt <= now;

    if (existing && !abandoned) return InMemoryIdempotencyStore.#toRecord(existing);

    this.#records.set(key, {
      key,
      requestHash,
      paymentId: null,
      responseStatus: null,
      responseBody: null,
      leaseToken,
      leaseExpiresAt: now + this.#leaseMs,
      completedAt: null,
    });
    return null;
  }

  async complete(key, leaseToken, { paymentId = null, responseStatus, responseBody }) {
    const record = this.#heldRecord(key, leaseToken);
    if (!record) return false;

    Object.assign(record, {
      paymentId,
      responseStatus,
      responseBody,
      leaseExpiresAt: null,
      completedAt: this.#now(),
    });
    return true;
  }

  async release(key, leaseToken) {
    if (!this.#heldRecord(key, leaseToken)) return false;

    this.#records.delete(key);
    return true;
  }

  async purgeExpired({ retentionSeconds }) {
    const cutoff = this.#now() - retentionSeconds * 1000;
    let deleted = 0;

    for (const [key, record] of this.#records) {
      const expired =
        record.responseStatus === null
          ? record.leaseExpiresAt < cutoff
          : record.completedAt < cutoff;
      if (expired) {
        this.#records.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  // The in-progress record of key, only while leaseToken still holds it.
  #heldRecord(key, leaseToken) {
    const record = this.#records.get(key);
    if (!record || record.responseStatus !== null || record.leaseToken !== leaseToken) {
      return null;
    }
    return record;
  }

  static #toRecord(record) {
    return {
      key: record.key,
      requestHash: record.requestHash,
      paymentId: record.paymentId,
      responseStatus: record.responseStatus,
      responseBody: record.responseBody,
      leaseExpiresAt: record.leaseExpiresAt === null ? null : new Date(record.leaseExpiresAt),
    };
  }
}

module.exports = { InMemoryIdempotencyStore };
