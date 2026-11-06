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

test('database defaults depend on APP_ENV', () => {
  const development = loadConfig({ APP_ENV: 'development' }).database;
  const production = loadConfig({ APP_ENV: 'production' }).database;

  assert.deepStrictEqual(
    { min: development.poolMin, max: development.poolMax },
    { min: 0, max: 5 },
  );
  assert.deepStrictEqual({ min: production.poolMin, max: production.poolMax }, { min: 2, max: 10 });
  assert.strictEqual(production.statementTimeoutMs, 5000);
  assert.strictEqual(production.lockTimeoutMs, 3000);
  assert.strictEqual(production.idleInTransactionTimeoutMs, 10000);
  assert.strictEqual(production.acquireTimeoutMs, 5000);
  assert.strictEqual(production.migrationLockTimeoutMs, 10000);
});

test('DB_* variables override the environment defaults', () => {
  const { database } = loadConfig({
    APP_ENV: 'production',
    DB_POOL_MIN: '1',
    DB_POOL_MAX: '20',
    DB_ACQUIRE_TIMEOUT_MS: '2000',
    DB_IDLE_TIMEOUT_MS: '60000',
    DB_STATEMENT_TIMEOUT_MS: '0',
    DB_LOCK_TIMEOUT_MS: '1000',
    DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '5000',
    DB_MIGRATION_LOCK_TIMEOUT_MS: '30000',
  });

  assert.deepStrictEqual(database, {
    url: process.env.DATABASE_URL,
    poolMin: 1,
    poolMax: 20,
    acquireTimeoutMs: 2000,
    idleTimeoutMs: 60000,
    statementTimeoutMs: 0,
    lockTimeoutMs: 1000,
    idleInTransactionTimeoutMs: 5000,
    migrationLockTimeoutMs: 30000,
  });
});

test('invalid database settings stop the service at startup', () => {
  for (const env of [
    { DB_POOL_MAX: '0' },
    { DB_POOL_MIN: '-1' },
    { DB_STATEMENT_TIMEOUT_MS: 'abc' },
    { DB_LOCK_TIMEOUT_MS: '1.5' },
    { DB_ACQUIRE_TIMEOUT_MS: '0' },
  ]) {
    assert.throws(() => loadConfig(env), /must be an integer/, JSON.stringify(env));
  }
  assert.throws(
    () => loadConfig({ DB_POOL_MIN: '6', DB_POOL_MAX: '5' }),
    /DB_POOL_MIN \(6\) cannot be greater than DB_POOL_MAX \(5\)/,
  );
});
