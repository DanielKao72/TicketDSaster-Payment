// Provider webhooks resolve a payment through the reference recorded in its
// transactions, so that lookup gets an index.
exports.up = async function up(knex) {
  await knex.schema.alterTable('transactions', (table) => {
    table.index('provider_reference', 'transactions_provider_reference_index');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('transactions', (table) => {
    table.dropIndex('provider_reference', 'transactions_provider_reference_index');
  });
};
