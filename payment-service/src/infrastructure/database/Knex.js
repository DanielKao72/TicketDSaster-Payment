const knex = require('knex');

// knex options for the service: the pool and the Postgres timeouts of each connection
// come from config.database (per APP_ENV, overridable with DB_* variables).
// - statement_timeout cancels a statement that runs too long (Postgres error 57014).
// - lock_timeout fails a statement that waits too long for a row or table lock (55P03).
// - idle_in_transaction_session_timeout closes a connection left in an open transaction.
// A value of 0 is not sent, so the server or role default applies (off unless set there).
function buildKnexConfig({ database }) {
  return {
    client: 'pg',
    connection: {
      connectionString: database.url,
      application_name: 'payment-service',
      statement_timeout: database.statementTimeoutMs,
      lock_timeout: database.lockTimeoutMs,
      idle_in_transaction_session_timeout: database.idleInTransactionTimeoutMs,
    },
    pool: {
      min: database.poolMin,
      max: database.poolMax,
      idleTimeoutMillis: database.idleTimeoutMs,
    },
    acquireConnectionTimeout: database.acquireTimeoutMs,
  };
}

// knex options for migrations (knexfile.js): one connection, no statement timeout
// (building an index can take a while) but a lock timeout, so a migration stuck behind
// live traffic fails instead of blocking every query queued after it.
function buildMigrationKnexConfig({ database }) {
  return {
    client: 'pg',
    connection: {
      connectionString: database.url,
      application_name: 'payment-service-migrations',
      lock_timeout: database.migrationLockTimeoutMs,
      // pg does not send a 0 timeout, so a role-level default would still apply: force it off.
      options: '-c statement_timeout=0 -c idle_in_transaction_session_timeout=0',
    },
    pool: { min: 0, max: 1 },
  };
}

// Builds the knex instance; it does not connect until the first query.
function createKnex(config) {
  return knex(buildKnexConfig(config));
}

module.exports = { createKnex, buildKnexConfig, buildMigrationKnexConfig };
