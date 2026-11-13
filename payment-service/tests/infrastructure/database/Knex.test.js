// The pool and timeouts reach knex and every Postgres connection. The checks against a
// real database run only with TEST_DATABASE_URL (see README).
const { describe, test, after } = require('node:test');
const assert = require('node:assert');
const knexFactory = require('knex');
const {
  buildKnexConfig,
  buildMigrationKnexConfig,
} = require('../../../src/infrastructure/database/Knex');

const DATABASE = {
  url: 'postgres://user:pass@db:5432/payment_store',
  poolMin: 2,
  poolMax: 10,
  acquireTimeoutMs: 5000,
  idleTimeoutMs: 30000,
  statementTimeoutMs: 5000,
  lockTimeoutMs: 3000,
  idleInTransactionTimeoutMs: 10000,
  migrationLockTimeoutMs: 10000,
};

test('the service knex config carries the pool and the timeouts', () => {
  assert.deepStrictEqual(buildKnexConfig({ database: DATABASE }), {
    client: 'pg',
    connection: {
      connectionString: DATABASE.url,
      application_name: 'payment-service',
      statement_timeout: 5000,
      lock_timeout: 3000,
      idle_in_transaction_session_timeout: 10000,
    },
    pool: { min: 2, max: 10, idleTimeoutMillis: 30000 },
    acquireConnectionTimeout: 5000,
  });
});

test('migrations use one connection, no statement timeout and their own lock timeout', () => {
  const { connection, pool } = buildMigrationKnexConfig({ database: DATABASE });

  assert.deepStrictEqual(pool, { min: 0, max: 1 });
  assert.strictEqual(connection.lock_timeout, 10000);
  assert.match(connection.options, /statement_timeout=0/);
});

const url = process.env.TEST_DATABASE_URL;

describe(
  'against Postgres',
  { skip: url ? false : 'set TEST_DATABASE_URL to run it against Postgres' },
  () => {
    const database = {
      ...DATABASE,
      url,
      poolMin: 0,
      poolMax: 2,
      statementTimeoutMs: 300,
      lockTimeoutMs: 200,
    };
    let knex;
    let migrationKnex;

    after(async () => {
      await knex?.destroy();
      await migrationKnex?.destroy();
    });

    test('each connection gets the configured timeouts', async () => {
      knex = knexFactory(buildKnexConfig({ database }));
      const { rows } = await knex.raw(
        `SELECT current_setting('statement_timeout') AS statement,
                current_setting('lock_timeout') AS lock,
                current_setting('idle_in_transaction_session_timeout') AS idle,
                current_setting('application_name') AS app`,
      );

      assert.deepStrictEqual(rows[0], {
        statement: '300ms',
        lock: '200ms',
        idle: '10s',
        app: 'payment-service',
      });
    });

    test('a statement slower than statement_timeout is cancelled', async () => {
      await assert.rejects(knex.raw('SELECT pg_sleep(2)'), { code: '57014' });
    });

    test('a statement waiting on a lock longer than lock_timeout fails', async () => {
      await knex.raw('CREATE TABLE IF NOT EXISTS knex_timeout_probe (id int PRIMARY KEY)');
      const holder = await knex.transaction();
      try {
        await holder.raw('LOCK TABLE knex_timeout_probe IN ACCESS EXCLUSIVE MODE');
        await assert.rejects(knex.raw('SELECT * FROM knex_timeout_probe'), { code: '55P03' });
      } finally {
        await holder.rollback();
        await knex.raw('DROP TABLE knex_timeout_probe');
      }
    });

    test('migration connections have no statement timeout', async () => {
      migrationKnex = knexFactory(buildMigrationKnexConfig({ database }));
      const { rows } = await migrationKnex.raw(
        `SELECT current_setting('statement_timeout') AS statement,
                current_setting('lock_timeout') AS lock`,
      );

      assert.deepStrictEqual(rows[0], { statement: '0', lock: '10s' });
    });
  },
);
