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

  if (!isTest) {
    if (!cfg.jwt?.jwksUri || !cfg.jwt?.issuer || !cfg.jwt?.audience) {
      throw new Error(
        'FATAL: JWKS_URI, JWT_ISSUER, and JWT_AUDIENCE are required to validate authentication tokens.',
      );
    }
  }
}

validateConfig(config);

config.validateConfig = validateConfig;
module.exports = config;
