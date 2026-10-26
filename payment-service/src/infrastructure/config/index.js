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

// Fail fast: Validate critical environment variables at startup
if (config.paymentStore === 'postgres' && !config.database.url) {
  throw new Error('FATAL: DATABASE_URL is required when PAYMENT_STORE=postgres.');
}

if (!config.jwt.secret) {
  throw new Error('FATAL: JWT_SECRET is required to validate authentication tokens.');
}

module.exports = config;
