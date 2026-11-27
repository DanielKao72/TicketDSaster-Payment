// Audit trail and append-only guards for payments and transactions (6.3).
//
// - payment_audit_log records every change to payments (insert, status or decline
//   reason change, delete) and every new transaction, with the database user,
//   application_name and time.
// - transactions are append-only: they can never be updated.
// - A payment's financial identity (id, session, user, amount, currency, created_at)
//   can never change.
// - Rows of payments, transactions and payment_audit_log can only be deleted inside a
//   transaction that sets `payment_store.allow_delete = on` (SET LOCAL). Only the dev
//   seeds and a future retention purge (after the legal retention period) do that.
//
// These guards stop mistakes in code and manual queries; they do not stop a role that
// is allowed to set the flag or drop triggers. Privileges per role are the other half
// (see docs/operations/database.md).

exports.up = async function up(knex) {
  await knex.schema.createTable('payment_audit_log', (table) => {
    table.bigIncrements('id');
    table.string('table_name').notNullable();
    table.string('operation').notNullable();
    table.uuid('record_id').notNullable();
    // No foreign key: the log must outlive a deleted payment.
    table.uuid('payment_id').notNullable();
    table.jsonb('old_data');
    table.jsonb('new_data');
    table.string('db_user').notNullable();
    table.string('application_name');
    table.timestamp('changed_at', { useTz: true }).notNullable();
    table.index(['payment_id', 'changed_at']);
    table.index('changed_at');
  });

  await knex.schema.raw(`
    ALTER TABLE payment_audit_log
      ADD CONSTRAINT payment_audit_log_operation_check
      CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE'))
  `);

  await knex.schema.raw(`
    CREATE FUNCTION payment_store_delete_allowed() RETURNS boolean
    LANGUAGE sql STABLE AS $$
      SELECT coalesce(current_setting('payment_store.allow_delete', true), '') = 'on'
    $$;

    -- SECURITY DEFINER: the service role needs no INSERT privilege on the audit log, so
    -- it cannot write fake entries. session_user still names the role that connected.
    CREATE FUNCTION payment_audit_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
    DECLARE
      row_data jsonb := to_jsonb(coalesce(NEW, OLD));
    BEGIN
      -- updated_at alone changes on every save: only status or decline reason count.
      -- (Nested IFs: plpgsql does not short-circuit, and transactions has no status
      -- change to compare.)
      IF TG_TABLE_NAME = 'payments' AND TG_OP = 'UPDATE' THEN
        IF row(OLD.status, OLD.decline_reason) IS NOT DISTINCT FROM row(NEW.status, NEW.decline_reason) THEN
          RETURN NULL;
        END IF;
      END IF;

      INSERT INTO payment_audit_log
        (table_name, operation, record_id, payment_id, old_data, new_data,
         db_user, application_name, changed_at)
      VALUES (
        TG_TABLE_NAME,
        TG_OP,
        (row_data ->> 'id')::uuid,
        CASE WHEN TG_TABLE_NAME = 'payments'
             THEN (row_data ->> 'id')::uuid
             ELSE (row_data ->> 'payment_id')::uuid END,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
        CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
        session_user,
        current_setting('application_name', true),
        clock_timestamp()
      );
      RETURN NULL;
    END;
    $$;

    CREATE FUNCTION payments_guard() RETURNS trigger
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

    CREATE FUNCTION append_only_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND payment_store_delete_allowed() THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END;
    $$;

    CREATE FUNCTION truncate_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT payment_store_delete_allowed() THEN
        RAISE EXCEPTION '% cannot be truncated (retention policy)', TG_TABLE_NAME
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NULL;
    END;
    $$;

    CREATE TRIGGER payments_audit
      AFTER INSERT OR UPDATE OR DELETE ON payments
      FOR EACH ROW EXECUTE FUNCTION payment_audit_write();
    CREATE TRIGGER transactions_audit
      AFTER INSERT OR DELETE ON transactions
      FOR EACH ROW EXECUTE FUNCTION payment_audit_write();

    CREATE TRIGGER payments_guard
      BEFORE UPDATE OR DELETE ON payments
      FOR EACH ROW EXECUTE FUNCTION payments_guard();
    CREATE TRIGGER transactions_append_only
      BEFORE UPDATE OR DELETE ON transactions
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER payment_audit_log_append_only
      BEFORE UPDATE OR DELETE ON payment_audit_log
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();

    CREATE TRIGGER payments_no_truncate
      BEFORE TRUNCATE ON payments
      FOR EACH STATEMENT EXECUTE FUNCTION truncate_guard();
    CREATE TRIGGER transactions_no_truncate
      BEFORE TRUNCATE ON transactions
      FOR EACH STATEMENT EXECUTE FUNCTION truncate_guard();
    CREATE TRIGGER payment_audit_log_no_truncate
      BEFORE TRUNCATE ON payment_audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION truncate_guard();
  `);
};

exports.down = async function down(knex) {
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS payments_no_truncate ON payments;
    DROP TRIGGER IF EXISTS transactions_no_truncate ON transactions;
    DROP TRIGGER IF EXISTS payments_guard ON payments;
    DROP TRIGGER IF EXISTS transactions_append_only ON transactions;
    DROP TRIGGER IF EXISTS payments_audit ON payments;
    DROP TRIGGER IF EXISTS transactions_audit ON transactions;
  `);
  await knex.schema.dropTableIfExists('payment_audit_log');
  await knex.schema.raw(`
    DROP FUNCTION IF EXISTS truncate_guard();
    DROP FUNCTION IF EXISTS append_only_guard();
    DROP FUNCTION IF EXISTS payments_guard();
    DROP FUNCTION IF EXISTS payment_audit_write();
    DROP FUNCTION IF EXISTS payment_store_delete_allowed();
  `);
};
