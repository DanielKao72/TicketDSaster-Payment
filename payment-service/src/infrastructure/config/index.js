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
  webhook: {
    // Stripe endpoint signing secret (`whsec_...`); without it every webhook is rejected.
    secret: process.env.PAYMENT_PROVIDER_WEBHOOK_SECRET,
  },
  paymentProvider: process.env.PAYMENT_PROVIDER || 'fake',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  // PROVISIONAL: pendiente de confirmar con Booking (reunión 7 nov: notificamos FAILED).
  booking: {
    notifyUrl: process.env.BOOKING_NOTIFY_URL || null,
    serviceToken: process.env.BOOKING_SERVICE_TOKEN || null,
    notifyTimeoutMs: Number(process.env.BOOKING_NOTIFY_TIMEOUT_MS) || 3000,
  },
};

module.exports = config;
