const {
  IdempotencyStore,
  DEFAULT_LEASE_SECONDS,
} = require('../../ports/outbound/IdempotencyStore');

// Rows deleted per statement by purgeExpired, so a large purge never holds long locks.
const PURGE_BATCH_SIZE = 1000;

// A claim retries when the key is released between its insert and its read.
const MAX_CLAIM_ATTEMPTS = 3;

// knex implementation over the `idempotency_keys` table. Lease times come from the
// database clock (now()), so every replica agrees on when a lease expires.
class PostgresIdempotencyStore extends IdempotencyStore {
  #knex;
  #leaseSeconds;

  constructor(knex, { leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
    super();
    this.#knex = knex;
    this.#leaseSeconds = leaseSeconds;
  }

  async claim({ key, requestHash, leaseToken }) {
    for (let attempt = 1; attempt <= MAX_CLAIM_ATTEMPTS; attempt += 1) {
      // The primary key makes the claim atomic: only one concurrent insert wins. On a
      // conflict the row is taken over only if it is abandoned (in progress, same
      // request, lease expired); the row lock makes that takeover atomic too.
      const { rows } = await this.#knex.raw(
        `INSERT INTO idempotency_keys (key, request_hash, lease_token, lease_expires_at)
         VALUES (:key, :requestHash, :leaseToken, now() + make_interval(secs => :leaseSeconds))
         ON CONFLICT (key) DO UPDATE
           SET lease_token = EXCLUDED.lease_token,
               lease_expires_at = EXCLUDED.lease_expires_at
           WHERE idempotency_keys.response_status IS NULL
             AND idempotency_keys.request_hash = EXCLUDED.request_hash
             AND idempotency_keys.lease_expires_at <= now()
         RETURNING key`,
        { key, requestHash, leaseToken, leaseSeconds: this.#leaseSeconds },
      );
      if (rows.length > 0) return null;

      const row = await this.#knex('idempotency_keys').where({ key }).first();
      if (row) return PostgresIdempotencyStore.#toRecord(row);
      // The holder released the key in between: claim again.
    }
    throw new Error(`Could not claim the Idempotency Key after ${MAX_CLAIM_ATTEMPTS} attempts`);
  }

  async complete(key, leaseToken, { paymentId = null, responseStatus, responseBody }) {
    const updated = await this.#heldKey(key, leaseToken).update({
      payment_id: paymentId,
      response_status: responseStatus,
      response_body: JSON.stringify(responseBody),
      lease_expires_at: null,
      completed_at: this.#knex.fn.now(),
    });
    return updated > 0;
  }

  async release(key, leaseToken) {
    const deleted = await this.#heldKey(key, leaseToken).del();
    return deleted > 0;
  }

  async purgeExpired({ retentionSeconds }) {
    let total = 0;
    for (;;) {
      const { rowCount } = await this.#knex.raw(
        `DELETE FROM idempotency_keys
         WHERE key IN (
           SELECT key FROM idempotency_keys
           WHERE completed_at < now() - make_interval(secs => :retentionSeconds)
           UNION ALL
           SELECT key FROM idempotency_keys
           WHERE response_status IS NULL
             AND lease_expires_at < now() - make_interval(secs => :retentionSeconds)
           LIMIT :batchSize
         )`,
        { retentionSeconds, batchSize: PURGE_BATCH_SIZE },
      );
      total += rowCount;
      if (rowCount < PURGE_BATCH_SIZE) return total;
    }
  }

  // The in-progress row of key, only while leaseToken still holds it.
  #heldKey(key, leaseToken) {
    return this.#knex('idempotency_keys')
      .where({ key, lease_token: leaseToken })
      .whereNull('response_status');
  }

  static #toRecord(row) {
    return {
      key: row.key,
      requestHash: row.request_hash,
      paymentId: row.payment_id,
      responseStatus: row.response_status,
      responseBody: row.response_body,
      leaseExpiresAt: row.lease_expires_at,
    };
  }
}

module.exports = { PostgresIdempotencyStore };
