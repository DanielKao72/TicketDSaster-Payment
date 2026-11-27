// One active (not FAILED) payment per Session, enforced by the database (3.1 / RF-21).
//
// CreatePaymentUseCase now reserves the Session by inserting the payment as PENDING
// before calling the provider. This unique partial index makes that insert atomic: of
// several concurrent requests for the same Session, only one gets the reservation, so
// only one reaches the provider.
//
// If the provider is unavailable, the use case releases the reservation by deleting
// that PENDING payment, which has no transactions yet. payments_guard (6.3) is updated
// to allow exactly that delete; it is still recorded in payment_audit_log.

const PAYMENTS_GUARD_WITHOUT_RESERVATIONS = `
  CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF NOT payment_store_delete_allowed() THEN
        RAISE EXCEPTION 'payments rows cannot be deleted (retention policy)'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN OLD;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.session_id IS DISTINCT FROM OLD.session_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'the id, session, user, amount, currency and created_at of a payment cannot change'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END;
  $$;
`;

exports.up = async function up(knex) {
  // Never fix financial data silently: existing duplicates must be resolved by hand.
  const { rows: duplicates } = await knex.raw(`
    SELECT session_id, count(*) AS active_payments
    FROM payments
    WHERE status <> 'FAILED'
    GROUP BY session_id
    HAVING count(*) > 1
  `);
  if (duplicates.length > 0) {
    const sessions = duplicates
      .map((row) => `${row.session_id} (${row.active_payments})`)
      .join(', ');
    throw new Error(
      `Sessions with more than one active payment must be resolved before this migration: ${sessions}`,
    );
  }

  await knex.schema.raw(`
    CREATE UNIQUE INDEX payments_one_active_per_session
      ON payments (session_id)
      WHERE status <> 'FAILED'
  `);

  await knex.schema.raw(`
    CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        -- Releasing a Session reservation: a PENDING payment that never got a
        -- transaction (the provider was unavailable).
        IF OLD.status = 'PENDING'
           AND NOT EXISTS (SELECT 1 FROM transactions WHERE payment_id = OLD.id) THEN
          RETURN OLD;
        END IF;
        IF NOT payment_store_delete_allowed() THEN
          RAISE EXCEPTION 'payments rows cannot be deleted (retention policy)'
            USING ERRCODE = 'insufficient_privilege';
        END IF;
        RETURN OLD;
      END IF;

      IF NEW.id IS DISTINCT FROM OLD.id
         OR NEW.session_id IS DISTINCT FROM OLD.session_id
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.amount IS DISTINCT FROM OLD.amount
         OR NEW.currency IS DISTINCT FROM OLD.currency
         OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'the id, session, user, amount, currency and created_at of a payment cannot change'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
};

exports.down = async function down(knex) {
  await knex.schema.raw(PAYMENTS_GUARD_WITHOUT_RESERVATIONS);
  await knex.schema.raw('DROP INDEX IF EXISTS payments_one_active_per_session');
};
