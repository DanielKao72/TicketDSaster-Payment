const { test, afterEach } = require('node:test');
const assert = require('node:assert');

const CONFIG_PATH = require.resolve('../../../src/infrastructure/config');
const VARS = [
  'IDEMPOTENCY_LEASE_SECONDS',
  'IDEMPOTENCY_RETENTION_HOURS',
  'IDEMPOTENCY_PURGE_INTERVAL_MINUTES',
];
const original = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));

// The config is read when the module loads, so each test loads a fresh copy.
function loadConfig(env) {
  for (const name of VARS) delete process.env[name];
  Object.assign(process.env, env);
  delete require.cache[CONFIG_PATH];
  return require(CONFIG_PATH);
}

afterEach(() => {
  for (const name of VARS) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
  delete require.cache[CONFIG_PATH];
});

test('idempotency settings default to a 60 s lease, 48 h retention and an hourly purge', () => {
  assert.deepStrictEqual(loadConfig({}).idempotency, {
    leaseSeconds: 60,
    retentionHours: 48,
    purgeIntervalMinutes: 60,
  });
});

test('idempotency settings are read from the environment', () => {
  const { idempotency } = loadConfig({
    IDEMPOTENCY_LEASE_SECONDS: '120',
    IDEMPOTENCY_RETENTION_HOURS: '72',
    IDEMPOTENCY_PURGE_INTERVAL_MINUTES: '0',
  });

  assert.deepStrictEqual(idempotency, {
    leaseSeconds: 120,
    retentionHours: 72,
    purgeIntervalMinutes: 0,
  });
});

test('invalid idempotency settings stop the service at startup', () => {
  for (const env of [
    { IDEMPOTENCY_LEASE_SECONDS: '0' },
    { IDEMPOTENCY_LEASE_SECONDS: 'abc' },
    { IDEMPOTENCY_RETENTION_HOURS: '1.5' },
    { IDEMPOTENCY_PURGE_INTERVAL_MINUTES: '-1' },
  ]) {
    assert.throws(() => loadConfig(env), /must be an integer/, JSON.stringify(env));
  }
});
