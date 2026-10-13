// Why the provider declined the last operation of a payment (e.g. card_declined).
exports.up = async function up(knex) {
  await knex.schema.alterTable('payments', (table) => {
    table.string('decline_reason');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('payments', (table) => {
    table.dropColumn('decline_reason');
  });
};
