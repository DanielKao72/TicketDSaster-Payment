// Runs the IdempotencyStore contract against a real Postgres. Skipped unless
// TEST_DATABASE_URL points to a database it may freely migrate and wipe, e.g.:
//   docker compose up -d db
//   TEST_DATABASE_URL=postgres://payment:change-me@localhost:5432/payment_store npm test
const { after } = require('node:test');
const path = require('node:path');
const knexFactory = require('knex');
const {
  PostgresIdempotencyStore,
} = require('../../../src/adapters/repositories/PostgresIdempotencyStore');
const {
  describeIdempotencyStoreContract,
  LEASE_SECONDS,
  RETENTION_SECONDS,
} = require('./IdempotencyStoreContract');

const url = process.env.TEST_DATABASE_URL;
let knex;
let migrated = false;

// Moves the timestamps of every existing key back, as if that much time had passed.
async function travel(seconds) {
  await knex.raw(
    `UPDATE idempotency_keys
     SET lease_expires_at = lease_expires_at - make_interval(secs => :seconds),
         completed_at = completed_at - make_interval(secs => :seconds),
         created_at = created_at - make_interval(secs => :seconds)`,
    { seconds },
  );
}

describeIdempotencyStoreContract(
  'PostgresIdempotencyStore',
  async () => {
    if (!knex) {
      knex = knexFactory({ client: 'pg', connection: url });
    }
    if (!migrated) {
      await knex.migrate.latest({ directory: path.join(__dirname, '../../../db/migrations') });
      migrated = true;
    }
    await knex('idempotency_keys').del();
    return {
      store: new PostgresIdempotencyStore(knex, { leaseSeconds: LEASE_SECONDS }),
      travelPastLease: () => travel(LEASE_SECONDS + 1),
      travelPastRetention: () => travel(RETENTION_SECONDS + 1),
    };
  },
  { skip: url ? false : 'set TEST_DATABASE_URL to run it against Postgres' },
);

after(async () => {
  await knex?.destroy();
});
