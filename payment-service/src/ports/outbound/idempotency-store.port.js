/**
 * Outbound port: storage of Idempotency Keys (table `idempotency_keys`).
 * A repeated key with the same requestHash replays the stored response; with a
 * different requestHash it is a 409.
 *
 * @typedef {object} IdempotencyRecord
 * @property {string} key
 * @property {string} requestHash Hash of the request payload.
 * @property {string | null} paymentId
 * @property {number | null} responseStatus
 * @property {object | null} responseBody
 *
 * @typedef {object} IdempotencyStore
 * @property {(key: string) => Promise<IdempotencyRecord | null>} find
 * @property {(record: IdempotencyRecord) => Promise<void>} save
 */

module.exports = {};
