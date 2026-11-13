// Provider webhooks need the untouched body to verify their signature; keeping the
// raw bytes on every request is cheap and lets the webhook route verify them.
exports.up = async function up(knex) {
  await knex.schema.alterTable('transactions', (table) => {
    table.index('provider_reference', 'transactions_provider_reference_index');
  });

  await knex.schema.createTable('processed_provider_events', (table) => {
    table.string('event_id').primary();
    table.string('type');
    table.timestamp('processed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('processed_provider_events');
  await knex.schema.alterTable('transactions', (table) => {
    table.dropIndex('provider_reference', 'transactions_provider_reference_index');
  });
};
