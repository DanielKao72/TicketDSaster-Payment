const { IdempotencyStore } = require('../../ports/outbound/IdempotencyStore');

// knex implementation over the `idempotency_keys` table.
class PostgresIdempotencyStore extends IdempotencyStore {
  #knex;

  constructor(knex) {
    super();
    this.#knex = knex;
  }

  async claim({ key, requestHash }) {
    // The primary key makes the claim atomic: only one concurrent insert wins.
    const inserted = await this.#knex('idempotency_keys')
      .insert({ key, request_hash: requestHash })
      .onConflict('key')
      .ignore()
      .returning('key');
    if (inserted.length > 0) return null;

    const row = await this.#knex('idempotency_keys').where({ key }).first();
    return {
      key: row.key,
      requestHash: row.request_hash,
      paymentId: row.payment_id,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    };
  }

  async complete(key, { paymentId = null, responseStatus, responseBody }) {
    await this.#knex('idempotency_keys')
      .where({ key })
      .update({
        payment_id: paymentId,
        response_status: responseStatus,
        response_body: JSON.stringify(responseBody),
      });
  }

  async release(key) {
    await this.#knex('idempotency_keys').where({ key }).del();
  }
}

module.exports = { PostgresIdempotencyStore };
