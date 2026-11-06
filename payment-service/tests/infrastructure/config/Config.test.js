const { test, afterEach } = require('node:test');
const assert = require('node:assert');

const CONFIG_PATH = require.resolve('../../../src/infrastructure/config');
const original = { ...process.env };

// The config is read when the module loads, so each test loads a fresh copy with only
// the given variables set (besides the ones it does not read).
function loadConfig(env = {}) {
  for (const name of Object.keys(process.env)) {
    if (name === 'APP_ENV' || name.startsWith('DB_')) delete process.env[name];
  }
  Object.assign(process.env, env);
  delete require.cache[CONFIG_PATH];
  return require(CONFIG_PATH);
}

afterEach(() => {
  process.env = { ...original };
  delete require.cache[CONFIG_PATH];
});

test('APP_ENV defaults to development', () => {
  assert.strictEqual(loadConfig().appEnv, 'development');
});

test('APP_ENV accepts development, test and production', () => {
  for (const appEnv of ['development', 'test', 'production']) {
    assert.strictEqual(loadConfig({ APP_ENV: appEnv }).appEnv, appEnv);
  }
});

test('an unknown APP_ENV stops the service at startup', () => {
  assert.throws(() => loadConfig({ APP_ENV: 'staging' }), /APP_ENV must be one of/);
});
