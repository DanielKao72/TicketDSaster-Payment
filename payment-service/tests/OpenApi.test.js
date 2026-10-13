const { test } = require('node:test');
const assert = require('node:assert');
const { buildOpenApiSpec } = require('../src/infrastructure/express/OpenApi');
const config = require('../src/infrastructure/config');

test('OpenAPI spec documents GET /health', () => {
  const spec = buildOpenApiSpec();

  assert.ok(spec.paths['/health'].get);
});

test('OpenAPI spec version matches the app version', () => {
  const spec = buildOpenApiSpec();

  assert.strictEqual(spec.info.version, config.appVersion);
});

test('OpenAPI spec documents the payment routes', () => {
  const { paths, components } = buildOpenApiSpec();

  assert.ok(paths['/payments'].post);
  assert.ok(paths['/payments'].get);
  assert.ok(paths['/payments/{paymentId}'].get);
  assert.ok(paths['/payments/{paymentId}/capture'].post);
  assert.ok(paths['/payments/{paymentId}/refund'].post);
  assert.ok(components.securitySchemes.bearerAuth);
  assert.ok(components.schemas.Payment);
});
