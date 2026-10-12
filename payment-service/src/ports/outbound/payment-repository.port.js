/**
 * Outbound port: persistence of the Payment aggregate.
 * Implemented in src/adapters/repositories/.
 *
 * @typedef {import('../../core/domain/payment').Payment} Payment
 *
 * @typedef {object} PaymentRepository
 * @property {(payment: Payment) => Promise<Payment>} save
 *   Inserts or updates the payment and returns it with its persisted id and timestamps.
 * @property {(id: string) => Promise<Payment | null>} findById
 * @property {(sessionId: string) => Promise<Payment | null>} findBySessionId
 */

module.exports = {};
