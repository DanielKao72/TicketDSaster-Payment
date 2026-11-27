const { test } = require('node:test');
const assert = require('node:assert');
const { assertSeedsAllowed } = require('../../db/SeedGuard');

test('seeds refuse to run in production', () => {
  assert.throws(() => assertSeedsAllowed('production'), /never run in production/);
});

test('seeds may run in development and test', () => {
  assert.doesNotThrow(() => assertSeedsAllowed('development'));
  assert.doesNotThrow(() => assertSeedsAllowed('test'));
});
