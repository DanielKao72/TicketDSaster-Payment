const { test } = require('node:test');
const assert = require('node:assert');
const { buildOpenApiSpec } = require('../src/docs/openapi');
const config = require('../src/config');

test('OpenAPI spec documents GET /health', () => {
  const spec = buildOpenApiSpec();

  assert.ok(spec.paths['/health'].get);
});

test('OpenAPI spec version matches the app version', () => {
  const spec = buildOpenApiSpec();

  assert.strictEqual(spec.info.version, config.appVersion);
});
