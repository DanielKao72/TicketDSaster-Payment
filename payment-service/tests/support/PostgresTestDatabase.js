// Shared setup for the tests that need a real Postgres. They run only when
// TEST_DATABASE_URL points to a database they may freely migrate and wipe, e.g.:
//   docker compose up -d db
//   TEST_DATABASE_URL=postgres://payment:change-me@localhost:5432/payment_store npm test
const path = require('node:path');
const knexFactory = require('knex');

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'set TEST_DATABASE_URL to run it against Postgres';

// A knex instance on the migrated test database (migrated once per process).
async function connect(options = {}) {
  const knex = knexFactory({ client: 'pg', connection: url, ...options });
  await knex.migrate.latest({ directory: path.join(__dirname, '../../db/migrations') });
  return knex;
}

// Empties every table, going through the delete guard of the Payment Store (6.3).
async function wipe(knex) {
  await knex.transaction(async (trx) => {
    await trx.raw("SELECT set_config('payment_store.allow_delete', 'on', true)");
    await trx.raw(
      'TRUNCATE idempotency_keys, transactions, payments, payment_audit_log RESTART IDENTITY',
    );
  });
}

module.exports = { url, skip, connect, wipe };
