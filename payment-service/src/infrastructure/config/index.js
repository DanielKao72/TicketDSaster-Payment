const { version } = require('../../../package.json');

// Reads an integer env var, falling back to defaultValue when it is unset or empty.
// An invalid value stops the service at startup instead of running with a bad setting.
function readInteger(name, defaultValue, { min }) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, got '${raw}'`);
  }
  return value;
}

const config = {
  port: Number(process.env.PORT) || 3000,
  appVersion: process.env.APP_VERSION || version,
  database: {
    url: process.env.DATABASE_URL,
  },
  // 'postgres' uses the Payment Store; 'memory' runs without a database (data is lost on restart).
  paymentStore: process.env.PAYMENT_STORE || 'memory',
  jwt: {
    // Shared HS256 secret with the Auth Service, which issues the tokens.
    secret: process.env.JWT_SECRET,
  },
  idempotency: {
    // How long a request holds its Idempotency-Key. If the process dies before storing
    // the response, the same request can reuse the key once this passes. It must outlast
    // the slowest request (the provider call alone can take ~20 s).
    leaseSeconds: readInteger('IDEMPOTENCY_LEASE_SECONDS', 60, { min: 1 }),
    // Completed keys (and abandoned ones) older than this are deleted by the purge job.
    retentionHours: readInteger('IDEMPOTENCY_RETENTION_HOURS', 48, { min: 1 }),
    // How often the service runs the purge job; 0 disables it (e.g. when an external
    // scheduler runs `npm run idempotency:purge`).
    purgeIntervalMinutes: readInteger('IDEMPOTENCY_PURGE_INTERVAL_MINUTES', 60, { min: 0 }),
  },
};

module.exports = config;
