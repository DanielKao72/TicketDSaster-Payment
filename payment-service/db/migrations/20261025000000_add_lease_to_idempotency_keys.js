// Lease for in-progress Idempotency Keys and retention of completed ones (RF-22).
//
// - lease_token: who holds the in-progress key. complete/release only apply with it,
//   so a request that outlived its lease cannot overwrite the new holder's response.
// - lease_expires_at: once it passes, an in-progress key is abandoned and the same
//   request can claim it again.
// - completed_at: when the response was stored; the purge job deletes keys older than
//   the retention period.
exports.up = async function up(knex) {
  await knex.schema.alterTable('idempotency_keys', (table) => {
    table.uuid('lease_token');
    table.timestamp('lease_expires_at', { useTz: true });
    table.timestamp('completed_at', { useTz: true });
  });

  // Keys stuck before this migration are abandoned: they become claimable right away.
  await knex('idempotency_keys')
    .whereNull('response_status')
    .update({ lease_expires_at: knex.ref('created_at') });
  await knex('idempotency_keys')
    .whereNotNull('response_status')
    .update({ completed_at: knex.ref('created_at') });

  // Partial indexes for the purge job, one per kind of expired key.
  await knex.schema.raw(
    'CREATE INDEX idempotency_keys_completed_at_index ON idempotency_keys (completed_at) WHERE completed_at IS NOT NULL',
  );
  await knex.schema.raw(
    'CREATE INDEX idempotency_keys_lease_expires_at_index ON idempotency_keys (lease_expires_at) WHERE response_status IS NULL',
  );
};

exports.down = async function down(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS idempotency_keys_lease_expires_at_index');
  await knex.schema.raw('DROP INDEX IF EXISTS idempotency_keys_completed_at_index');
  await knex.schema.alterTable('idempotency_keys', (table) => {
    table.dropColumn('completed_at');
    table.dropColumn('lease_expires_at');
    table.dropColumn('lease_token');
  });
};
