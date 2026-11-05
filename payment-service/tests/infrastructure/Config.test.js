const { test } = require('node:test');
const assert = require('node:assert');
const { validateConfig } = require('../../src/infrastructure/config');

test('validateConfig: allows default valid configuration', () => {
  const cfg = {
    paymentStore: 'memory',
    paymentProvider: 'fake',
    database: { url: undefined },
    stripe: { secretKey: undefined },
    jwt: {},
  };

  assert.doesNotThrow(() => validateConfig(cfg, { isTest: true }));
});

test('validateConfig: throws if paymentStore is postgres and DATABASE_URL is missing', () => {
  const cfg = {
    paymentStore: 'postgres',
    paymentProvider: 'fake',
    database: { url: undefined },
    stripe: { secretKey: undefined },
    jwt: {},
  };

  assert.throws(
    () => validateConfig(cfg, { isTest: true }),
    /FATAL: DATABASE_URL is required when PAYMENT_STORE=postgres\./,
  );
});

test('validateConfig: succeeds when paymentStore is postgres and database url is provided', () => {
  const cfg = {
    paymentStore: 'postgres',
    paymentProvider: 'fake',
    database: { url: 'postgres://user:pass@localhost:5432/db' },
    stripe: { secretKey: undefined },
    jwt: {},
  };

  assert.doesNotThrow(() => validateConfig(cfg, { isTest: true }));
});

test('validateConfig: throws if paymentProvider is stripe and STRIPE_SECRET_KEY is missing', () => {
  const cfg = {
    paymentStore: 'memory',
    paymentProvider: 'stripe',
    database: { url: undefined },
    stripe: { secretKey: undefined },
    jwt: {},
  };

  assert.throws(
    () => validateConfig(cfg, { isTest: true }),
    /FATAL: STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe\./,
  );
});

test('validateConfig: succeeds when paymentProvider is stripe and secretKey is provided', () => {
  const cfg = {
    paymentStore: 'memory',
    paymentProvider: 'stripe',
    database: { url: undefined },
    stripe: { secretKey: 'sk_test_123' },
    jwt: {},
  };

  assert.doesNotThrow(() => validateConfig(cfg, { isTest: true }));
});

test('validateConfig: in non-test mode, throws when JWT JWKS configuration is incomplete', () => {
  const cfg = {
    paymentStore: 'memory',
    paymentProvider: 'fake',
    database: { url: undefined },
    stripe: { secretKey: undefined },
    jwt: {
      jwksUri: 'https://auth.example.com/.well-known/jwks.json',
      // missing issuer and audience
    },
  };

  assert.throws(
    () => validateConfig(cfg, { isTest: false }),
    /FATAL: JWKS_URI, JWT_ISSUER, and JWT_AUDIENCE are required to validate authentication tokens\./,
  );
});

test('validateConfig: in non-test mode, succeeds when JWKS_URI, JWT_ISSUER and JWT_AUDIENCE are provided', () => {
  const cfg = {
    paymentStore: 'memory',
    paymentProvider: 'fake',
    database: { url: undefined },
    stripe: { secretKey: undefined },
    jwt: {
      jwksUri: 'https://auth.example.com/.well-known/jwks.json',
      issuer: 'urn:ticket-dsaster:auth',
      audience: 'urn:ticket-dsaster:payments',
    },
  };

  assert.doesNotThrow(() => validateConfig(cfg, { isTest: false }));
});
