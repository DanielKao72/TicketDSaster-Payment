const { Payment } = require('../../core/domain/Payment');
const { PaymentAlreadyExistsError } = require('../../core/domain/DomainErrors');
const { PaymentRepository } = require('../../ports/outbound/PaymentRepository');

// Unique partial index: one active (not FAILED) payment per Session.
const ONE_ACTIVE_PER_SESSION = 'payments_one_active_per_session';
const UNIQUE_VIOLATION = '23505';

// knex implementation over the `payments` and `transactions` tables.
class PostgresPaymentRepository extends PaymentRepository {
  #knex;

  constructor(knex) {
    super();
    this.#knex = knex;
  }

  async save(payment) {
    try {
      return await this.#save(payment);
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION && err.constraint === ONE_ACTIVE_PER_SESSION) {
        throw new PaymentAlreadyExistsError(payment.sessionId);
      }
      throw err;
    }
  }

  async discardPending(payment) {
    const deleted = await this.#knex('payments')
      .where({ id: payment.id, status: 'PENDING' })
      .whereNotExists(this.#knex('transactions').where('payment_id', payment.id))
      .del();
    return deleted > 0;
  }

  async #save(payment) {
    const snapshot = payment.toSnapshot();

    return this.#knex.transaction(async (trx) => {
      await trx('payments')
        .insert({
          id: snapshot.id,
          session_id: snapshot.sessionId,
          user_id: snapshot.userId,
          amount: snapshot.amount,
          currency: snapshot.currency,
          status: snapshot.status,
          decline_reason: snapshot.declineReason,
        })
        .onConflict('id')
        .merge({
          status: snapshot.status,
          decline_reason: snapshot.declineReason,
          updated_at: trx.fn.now(),
        });

      const newTransactions = snapshot.transactions.filter((t) => !t.id);
      if (newTransactions.length > 0) {
        await trx('transactions').insert(
          newTransactions.map((t) => ({
            payment_id: snapshot.id,
            type: t.type,
            status: t.status,
            amount: t.amount,
            provider_reference: t.providerReference,
          })),
        );
      }

      return this.#find(trx, { id: snapshot.id });
    });
  }

  async findById(id) {
    return this.#find(this.#knex, { id });
  }

  async findBySessionId(sessionId) {
    return this.#find(this.#knex, { session_id: sessionId });
  }

  async findByProviderReference(providerReference) {
    if (!providerReference) return null;

    const transaction = await this.#knex('transactions')
      .select('payment_id')
      .where({ provider_reference: providerReference })
      .orderBy('created_at', 'desc')
      .first();
    if (!transaction) return null;

    return this.#find(this.#knex, { id: transaction.payment_id });
  }

  async #find(db, where) {
    const row = await db('payments').where(where).orderBy('created_at', 'desc').first();
    if (!row) return null;

    // Transactions saved together share created_at (now() is fixed per database
    // transaction). They are never updated, so ctid keeps their insertion order.
    const transactions = await db('transactions')
      .where({ payment_id: row.id })
      .orderBy([{ column: 'created_at' }, { column: 'ctid' }]);

    return Payment.fromPersistence({
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      // bigint columns come back from pg as strings.
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      declineReason: row.decline_reason,
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        status: t.status,
        amount: Number(t.amount),
        providerReference: t.provider_reference,
        createdAt: t.created_at,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

module.exports = { PostgresPaymentRepository };
