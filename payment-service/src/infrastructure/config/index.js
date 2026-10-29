const { version } = require('../../../package.json');

const config = {
  port: Number(process.env.PORT) || 3000,
  appVersion: process.env.APP_VERSION || version,
  database: {
    url: process.env.DATABASE_URL,
  },
  paymentStore: process.env.PAYMENT_STORE || 'memory',
  jwt: {
    jwksUri: process.env.JWKS_URI,
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
  },
};

// Fail fast: Validate critical environment variables at startup (except in tests)
if (config.paymentStore === 'postgres' && !config.database.url) {
  throw new Error('FATAL: DATABASE_URL is required when PAYMENT_STORE=postgres.');
}

if (process.env.npm_lifecycle_event !== 'test') {
  if (!config.jwt.jwksUri || !config.jwt.issuer || !config.jwt.audience) {
    throw new Error(
      'FATAL: JWKS_URI, JWT_ISSUER, and JWT_AUDIENCE are required to validate authentication tokens.',
    );
  }
}

module.exports = config;
