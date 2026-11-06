const { version } = require('../../../package.json');

// Deployment environment. It decides the database defaults and whether seeds may run
// (never in production). The Docker image defaults to production.
const APP_ENVS = ['development', 'test', 'production'];
const appEnv = process.env.APP_ENV || 'development';
if (!APP_ENVS.includes(appEnv)) {
  throw new Error(`APP_ENV must be one of ${APP_ENVS.join(', ')}, got '${appEnv}'`);
}

// Database pool and timeouts per environment (6.4). Each value can be overridden with
// the DB_* variable next to it. Every statement of the service is a short lookup or a
// single-row write, so anything slower than a few seconds is a problem to cut off.
const DATABASE_DEFAULTS = {
  development: {
    poolMin: 0, // DB_POOL_MIN
    poolMax: 5, // DB_POOL_MAX
    acquireTimeoutMs: 5000, // DB_ACQUIRE_TIMEOUT_MS: wait for a free pool connection
    idleTimeoutMs: 30000, // DB_IDLE_TIMEOUT_MS: close pool connections idle this long
    statementTimeoutMs: 10000, // DB_STATEMENT_TIMEOUT_MS
    lockTimeoutMs: 5000, // DB_LOCK_TIMEOUT_MS
    idleInTransactionTimeoutMs: 30000, // DB_IDLE_IN_TRANSACTION_TIMEOUT_MS
  },
  test: {
    poolMin: 0,
    poolMax: 5,
    acquireTimeoutMs: 5000,
    idleTimeoutMs: 10000,
    statementTimeoutMs: 5000,
    lockTimeoutMs: 2000,
    idleInTransactionTimeoutMs: 10000,
  },
  production: {
    poolMin: 2,
    poolMax: 10,
    acquireTimeoutMs: 5000,
    idleTimeoutMs: 30000,
    statementTimeoutMs: 5000,
    lockTimeoutMs: 3000,
    idleInTransactionTimeoutMs: 10000,
  },
};

// Migrations may build indexes or rewrite tables, so they get no statement timeout;
// a lock timeout keeps a migration that waits on a lock from queueing all the traffic
// behind it (DB_MIGRATION_LOCK_TIMEOUT_MS).
const MIGRATION_LOCK_TIMEOUT_MS = 10000;

// Reads a non-negative integer env var, or defaultValue when it is unset or empty.
// An invalid value stops the service at startup instead of running with a bad setting.
function readInteger(name, defaultValue, { min = 0 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, got '${raw}'`);
  }
  return value;
}

function readDatabaseConfig() {
  const defaults = DATABASE_DEFAULTS[appEnv];
  const database = {
    url: process.env.DATABASE_URL,
    poolMin: readInteger('DB_POOL_MIN', defaults.poolMin),
    poolMax: readInteger('DB_POOL_MAX', defaults.poolMax, { min: 1 }),
    acquireTimeoutMs: readInteger('DB_ACQUIRE_TIMEOUT_MS', defaults.acquireTimeoutMs, { min: 1 }),
    idleTimeoutMs: readInteger('DB_IDLE_TIMEOUT_MS', defaults.idleTimeoutMs, { min: 1 }),
    // 0 disables a Postgres timeout.
    statementTimeoutMs: readInteger('DB_STATEMENT_TIMEOUT_MS', defaults.statementTimeoutMs),
    lockTimeoutMs: readInteger('DB_LOCK_TIMEOUT_MS', defaults.lockTimeoutMs),
    idleInTransactionTimeoutMs: readInteger(
      'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
      defaults.idleInTransactionTimeoutMs,
    ),
    migrationLockTimeoutMs: readInteger('DB_MIGRATION_LOCK_TIMEOUT_MS', MIGRATION_LOCK_TIMEOUT_MS),
  };
  if (database.poolMin > database.poolMax) {
    throw new Error(
      `DB_POOL_MIN (${database.poolMin}) cannot be greater than DB_POOL_MAX (${database.poolMax})`,
    );
  }
  return database;
}

const config = {
  appEnv,
  port: Number(process.env.PORT) || 3000,
  appVersion: process.env.APP_VERSION || version,
  database: readDatabaseConfig(),
  // 'postgres' uses the Payment Store; 'memory' runs without a database (data is lost on restart).
  paymentStore: process.env.PAYMENT_STORE || 'memory',
  jwt: {
    // Shared HS256 secret with the Auth Service, which issues the tokens.
    secret: process.env.JWT_SECRET,
  },
};

module.exports = config;
