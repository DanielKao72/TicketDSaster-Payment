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

const config = {
  port: Number(process.env.PORT) || 3000,
  appVersion: process.env.APP_VERSION || version,
  database: {
    url: secrets.databaseUrl || process.env.DATABASE_URL,
  },
  paymentStore: process.env.PAYMENT_STORE || 'memory',
  paymentProvider: (process.env.PAYMENT_PROVIDER || 'fake').toLowerCase(),
  stripe: {
    secretKey: secrets.stripeSecretKey || process.env.STRIPE_SECRET_KEY,
    webhookSecret: secrets.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET,
  },
  jwt: {
    jwksUri: secrets.jwksUri || process.env.JWKS_URI,
    issuer: secrets.jwtIssuer || process.env.JWT_ISSUER,
    audience: secrets.jwtAudience || process.env.JWT_AUDIENCE,
    secret: secrets.jwtSecret || process.env.JWT_SECRET,
  },
};

// Fail fast: Validate critical environment variables at startup (except in tests)
if (config.paymentStore === 'postgres' && !config.database.url) {
  throw new Error('FATAL: DATABASE_URL is required when PAYMENT_STORE=postgres.');
}

if (config.paymentProvider === 'stripe' && !config.stripe.secretKey) {
  throw new Error('FATAL: STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe.');
}

if (process.env.npm_lifecycle_event !== 'test') {
  if (!config.jwt.jwksUri || !config.jwt.issuer || !config.jwt.audience) {
    throw new Error(
      'FATAL: JWKS_URI, JWT_ISSUER, and JWT_AUDIENCE are required to validate authentication tokens.',
    );
  }
}

module.exports = config;
