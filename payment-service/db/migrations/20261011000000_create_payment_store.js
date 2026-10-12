const PAYMENT_STATUSES = ['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED'];
const TRANSACTION_TYPES = ['CHARGE', 'CAPTURE', 'REFUND'];
const TRANSACTION_STATUSES = ['SUCCEEDED', 'FAILED', 'PENDING'];

exports.up = async function up(knex) {
  await knex.schema.createTable('payments', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('session_id').notNullable();
    table.uuid('user_id').notNullable();
    // Money in the currency's minor unit (e.g. cents), never floats.
    table.bigInteger('amount').notNullable();
    table.specificType('currency', 'char(3)').notNullable();
    table
      .enu('status', PAYMENT_STATUSES, { useNative: true, enumName: 'payment_status' })
      .notNullable()
      .defaultTo('PENDING');
    table.timestamps(true, true);
    table.index('session_id');
  });

  await knex.schema.raw(
    'ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0)',
  );

  await knex.schema.createTable('transactions', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('payment_id').notNullable().references('id').inTable('payments').onDelete('CASCADE');
    table
      .enu('type', TRANSACTION_TYPES, { useNative: true, enumName: 'transaction_type' })
      .notNullable();
    table
      .enu('status', TRANSACTION_STATUSES, { useNative: true, enumName: 'transaction_status' })
      .notNullable();
    table.bigInteger('amount').notNullable();
    table.string('provider_reference');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index('payment_id');
  });

  await knex.schema.createTable('idempotency_keys', (table) => {
    table.string('key').primary();
    // Hash of the request payload: the same key with a different payload is a 409.
    table.string('request_hash').notNullable();
    table.uuid('payment_id').references('id').inTable('payments').onDelete('SET NULL');
    table.integer('response_status');
    table.jsonb('response_body');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('idempotency_keys');
  await knex.schema.dropTableIfExists('transactions');
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.raw('DROP TYPE IF EXISTS transaction_status');
  await knex.schema.raw('DROP TYPE IF EXISTS transaction_type');
  await knex.schema.raw('DROP TYPE IF EXISTS payment_status');
};
