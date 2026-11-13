const { version } = require('../../../package.json');
const { SecretsManager } = require('../secrets/SecretsManager');

// Issue #159 / Report Ref: 4.3: Load secrets using the SecretsManager abstraction
// Supports 'env' (local dev & tests), 'file' (Docker/K8s secrets volume), and 'cloud' (Secret Manager)
const secrets = (() => {
  try {
    return (
      SecretsManager.loadSync?.() || {
        databaseUrl: process.env.DATABASE_URL,
        stripeSecretKey: process.env.STRIPE_SECRET_KEY,
        stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        jwksUri: process.env.JWKS_URI,
        jwtIssuer: process.env.JWT_ISSUER,
        jwtAudience: process.env.JWT_AUDIENCE,
        jwtSecret: process.env.JWT_SECRET,
      }
    );
  } catch {
    return {
      databaseUrl: process.env.DATABASE_URL,
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      jwksUri: process.env.JWKS_URI,
      jwtIssuer: process.env.JWT_ISSUER,
      jwtAudience: process.env.JWT_AUDIENCE,
      jwtSecret: process.env.JWT_SECRET,
    };
  }
})();

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
    url: secrets.databaseUrl || process.env.DATABASE_URL,
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
  paymentProvider: (process.env.PAYMENT_PROVIDER || 'fake').toLowerCase(),
  stripe: {
    secretKey: secrets.stripeSecretKey || process.env.STRIPE_SECRET_KEY,
    // Endpoint signing secret (`whsec_...`) that verifies `Stripe-Signature` on
    // POST /webhooks/payments; without it every webhook is rejected.
    webhookSecret: secrets.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET,
  },
  jwt: {
    jwksUri: secrets.jwksUri || process.env.JWKS_URI,
    issuer: secrets.jwtIssuer || process.env.JWT_ISSUER,
    audience: secrets.jwtAudience || process.env.JWT_AUDIENCE,
    secret: secrets.jwtSecret || process.env.JWT_SECRET,
  },
  // Applies to /payments only (not /health or provider webhooks). Booking Service is the
  // only caller, so all its traffic shares one client IP: keep max well above its peak.
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 1000,
  },
};

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.env.npm_lifecycle_event === 'test' ||
  process.argv.includes('--test') ||
  Boolean(process.env.NODE_TEST_CONTEXT);

// Fail fast: Validate critical environment variables at startup (Report ref: 5.4)
function validateConfig(cfg = config, { isTest = isTestEnv } = {}) {
  if (cfg.paymentStore === 'postgres' && !cfg.database?.url) {
    throw new Error('FATAL: DATABASE_URL is required when PAYMENT_STORE=postgres.');
  }

  if (cfg.paymentProvider === 'stripe' && !cfg.stripe?.secretKey) {
    throw new Error('FATAL: STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe.');
  }

  // Tokens are validated either against the Auth Service's JWKS (RS256/ES256) or, until
  // it publishes one, with the shared HS256 JWT_SECRET (local, docker compose, CI).
  if (!isTest && !cfg.jwt?.secret) {
    if (!cfg.jwt?.jwksUri || !cfg.jwt?.issuer || !cfg.jwt?.audience) {
      throw new Error(
        'FATAL: JWKS_URI, JWT_ISSUER, and JWT_AUDIENCE are required to validate authentication tokens. ' +
          'Set them, or JWT_SECRET to validate HS256 tokens.',
      );
    }
  }
}

// Called by the composition root (src/index.js) when the service starts, not on require:
// knexfile.js, npm run openapi and npm run token load this module without the service's
// secrets.
config.validateConfig = validateConfig;
module.exports = config;
