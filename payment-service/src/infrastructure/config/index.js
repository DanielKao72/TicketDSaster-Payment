const { version } = require('../../../package.json');

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
};

// Fail fast: Validate critical environment variables at startup
if (config.paymentStore === 'postgres' && !config.database.url) {
  throw new Error('FATAL: DATABASE_URL is required when PAYMENT_STORE=postgres.');
}

if (!config.jwt.secret) {
  throw new Error('FATAL: JWT_SECRET is required to validate authentication tokens.');
}

module.exports = config;
