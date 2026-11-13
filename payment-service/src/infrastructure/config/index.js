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
  paymentProvider: process.env.PAYMENT_PROVIDER || 'fake',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
};

module.exports = config;
