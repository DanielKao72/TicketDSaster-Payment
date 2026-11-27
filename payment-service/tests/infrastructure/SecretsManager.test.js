const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SecretsManager } = require('../../src/infrastructure/secrets/SecretsManager');

test('SecretsManager: defaults to env provider and reads process.env', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock_env';
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/mock_db';

  const secrets = await SecretsManager.load({ provider: 'env' });

  assert.strictEqual(secrets.stripeSecretKey, 'sk_test_mock_env');
  assert.strictEqual(secrets.databaseUrl, 'postgres://user:pass@localhost:5432/mock_db');
});

test('SecretsManager: loads secrets from a JSON file (K8s / Docker secrets volume)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
  const secretsFile = path.join(tempDir, 'secrets.json');

  const payload = {
    DATABASE_URL: 'postgres://file_user:file_pass@db.internal:5432/production',
    STRIPE_SECRET_KEY: 'sk_test_from_secret_manager_file',
    STRIPE_WEBHOOK_SECRET: 'whsec_file_secret',
    JWKS_URI: 'https://auth.internal/.well-known/jwks.json',
  };

  fs.writeFileSync(secretsFile, JSON.stringify(payload), 'utf8');

  try {
    const secrets = await SecretsManager.load({ provider: 'file', secretsPath: secretsFile });
    assert.strictEqual(secrets.stripeSecretKey, 'sk_test_from_secret_manager_file');
    assert.strictEqual(secrets.stripeWebhookSecret, 'whsec_file_secret');
    assert.strictEqual(
      secrets.databaseUrl,
      'postgres://file_user:file_pass@db.internal:5432/production',
    );
    assert.strictEqual(secrets.jwksUri, 'https://auth.internal/.well-known/jwks.json');

    // Also check synchronous load
    const syncSecrets = SecretsManager.loadSync({ provider: 'file', secretsPath: secretsFile });
    assert.strictEqual(syncSecrets.stripeSecretKey, 'sk_test_from_secret_manager_file');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('SecretsManager: throws explanatory error when cloud provider is invoked before #159 is finished', async () => {
  await assert.rejects(
    async () => {
      await SecretsManager.load({ provider: 'cloud' });
    },
    {
      name: 'Error',
      message: /pending coordination with DevOps \(#159\)/,
    },
  );
});
