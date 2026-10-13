const { Payment } = require('../../core/domain/Payment');
const { PaymentRepository } = require('../../ports/outbound/PaymentRepository');

// knex implementation over the `payments` and `transactions` tables.
class PostgresPaymentRepository extends PaymentRepository {
  #knex;

  constructor(knex) {
    super();
    this.#knex = knex;
  }

  async save(payment) {
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
