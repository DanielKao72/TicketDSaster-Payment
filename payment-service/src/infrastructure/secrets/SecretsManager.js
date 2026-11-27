const fs = require('node:fs');
const path = require('node:path');

/**
 * Secrets Manager Adapter (Issue #159 / Report Ref: 4.3).
 *
 * Provides an abstraction layer to load service credentials (Stripe, Database, Auth JWKS)
 * without hardcoding them in flat .env files in production.
 *
 * Supported providers:
 * - 'env': Standard environment variables (used for local development and CI testing).
 * - 'file': Docker/Kubernetes secrets mounted as files (e.g. /run/secrets/ or SECRETS_FILE).
 * - 'cloud': Extensible hook to fetch secrets asynchronously from AWS Secrets Manager,
 *            HashiCorp Vault, GCP Secret Manager, etc., once finalized by DevOps in #159.
 */
class SecretsManager {
  /**
   * Loads secrets synchronously for config initialization.
   *
   * @param {Object} [options]
   * @param {string} [options.provider] - 'env' or 'file'
   * @param {string} [options.secretsPath]
   * @returns {Object} Map of secret keys
   */
  static loadSync({
    provider = process.env.SECRETS_PROVIDER || 'env',
    secretsPath = process.env.SECRETS_FILE,
  } = {}) {
    switch (provider.toLowerCase()) {
      case 'file':
        return SecretsManager.#loadFromFilesOrJson(secretsPath);
      case 'env':
      default:
        return SecretsManager.#loadFromEnv();
    }
  }

  /**
   * Loads secrets asynchronously (supporting 'cloud' providers like AWS Secrets Manager or Vault).
   *
   * @param {Object} [options]
   * @param {string} [options.provider] - 'env', 'file', or 'cloud'
   * @param {string} [options.secretsPath]
   * @returns {Promise<Object>} Map of secret keys
   */
  static async load({
    provider = process.env.SECRETS_PROVIDER || 'env',
    secretsPath = process.env.SECRETS_FILE,
  } = {}) {
    switch (provider.toLowerCase()) {
      case 'file':
        return SecretsManager.#loadFromFilesOrJson(secretsPath);
      case 'cloud':
        return SecretsManager.#loadFromCloudSecretManager();
      case 'env':
      default:
        return SecretsManager.#loadFromEnv();
    }
  }

  /**
   * Default loader: Pulls from process.env (backward compatible for local dev & automated tests).
   */
  static #loadFromEnv() {
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

  /**
   * Reads secrets from a JSON file or standard Docker/Kubernetes secret directory (/run/secrets).
   */
  static #loadFromFilesOrJson(customPath) {
    const targetPath = customPath || process.env.SECRETS_DIR || '/run/secrets';

    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
      try {
        const raw = fs.readFileSync(targetPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          databaseUrl: parsed.DATABASE_URL || parsed.databaseUrl,
          stripeSecretKey: parsed.STRIPE_SECRET_KEY || parsed.stripeSecretKey,
          stripeWebhookSecret: parsed.STRIPE_WEBHOOK_SECRET || parsed.stripeWebhookSecret,
          jwksUri: parsed.JWKS_URI || parsed.jwksUri,
          jwtIssuer: parsed.JWT_ISSUER || parsed.jwtIssuer,
          jwtAudience: parsed.JWT_AUDIENCE || parsed.jwtAudience,
          jwtSecret: parsed.JWT_SECRET || parsed.jwtSecret,
        };
      } catch (err) {
        throw new Error(`Failed to parse secrets file at ${targetPath}: ${err.message}`);
      }
    }

    // Attempt reading discrete files per secret key (e.g. /run/secrets/stripe_secret_key)
    const readSecretFile = (name) => {
      const filePath = path.join(targetPath, name);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8').trim();
      }
      return undefined;
    };

    return {
      databaseUrl:
        readSecretFile('DATABASE_URL') ||
        readSecretFile('database_url') ||
        process.env.DATABASE_URL,
      stripeSecretKey:
        readSecretFile('STRIPE_SECRET_KEY') ||
        readSecretFile('stripe_secret_key') ||
        process.env.STRIPE_SECRET_KEY,
      stripeWebhookSecret:
        readSecretFile('STRIPE_WEBHOOK_SECRET') ||
        readSecretFile('stripe_webhook_secret') ||
        process.env.STRIPE_WEBHOOK_SECRET,
      jwksUri: readSecretFile('JWKS_URI') || process.env.JWKS_URI,
      jwtIssuer: readSecretFile('JWT_ISSUER') || process.env.JWT_ISSUER,
      jwtAudience: readSecretFile('JWT_AUDIENCE') || process.env.JWT_AUDIENCE,
      jwtSecret: readSecretFile('JWT_SECRET') || process.env.JWT_SECRET,
    };
  }

  /**
   * Placeholder hook for cloud-native secret managers (AWS Secrets Manager, HashiCorp Vault, GCP).
   * Once DevOps defines the specific cloud client in #159, implement the SDK fetch here.
   */
  static async #loadFromCloudSecretManager() {
    const secretName = process.env.SECRETS_MANAGER_NAME || 'ticketdsaster/payment-service';
    throw new Error(
      `Cloud secret manager is enabled (provider='cloud'), but remote client for '${secretName}' ` +
        `is pending coordination with DevOps (#159). Please use SECRETS_PROVIDER=file or SECRETS_PROVIDER=env.`,
    );
  }
}

module.exports = { SecretsManager };
