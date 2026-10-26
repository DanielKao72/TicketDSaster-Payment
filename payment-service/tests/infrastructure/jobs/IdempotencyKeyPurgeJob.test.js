const { test } = require('node:test');
const assert = require('node:assert');
const {
  IdempotencyKeyPurgeJob,
} = require('../../../src/infrastructure/jobs/IdempotencyKeyPurgeJob');

// Lets the pending purge run finish (setImmediate is not mocked).
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function silentLogger() {
  return { info: () => {}, error: () => {} };
}

function fakeStore(purgeExpired) {
  const calls = [];
  return {
    calls,
    purgeExpired: async (args) => {
      calls.push(args);
      return purgeExpired(args);
    },
  };
}

test('runOnce purges with the retention period in seconds', async () => {
  const store = fakeStore(() => 3);
  const job = new IdempotencyKeyPurgeJob({
    idempotencyStore: store,
    retentionHours: 48,
    intervalMinutes: 60,
    logger: silentLogger(),
  });

  assert.strictEqual(await job.runOnce(), 3);
  assert.deepStrictEqual(store.calls, [{ retentionSeconds: 48 * 3600 }]);
});

test('runOnce shares a run that is still in progress', async () => {
  let finish;
  const store = fakeStore(() => new Promise((resolve) => (finish = resolve)));
  const job = new IdempotencyKeyPurgeJob({
    idempotencyStore: store,
    retentionHours: 1,
    intervalMinutes: 60,
    logger: silentLogger(),
  });

  const first = job.runOnce();
  const second = job.runOnce();
  finish(5);

  assert.deepStrictEqual(await Promise.all([first, second]), [5, 5]);
  assert.strictEqual(store.calls.length, 1);
  const third = job.runOnce();
  finish(0);
  await third;
  assert.strictEqual(store.calls.length, 2);
});

test('start runs a purge right away and then every interval, until stop', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const store = fakeStore(() => 0);
  const job = new IdempotencyKeyPurgeJob({
    idempotencyStore: store,
    retentionHours: 1,
    intervalMinutes: 10,
    logger: silentLogger(),
  });

  job.start();
  await settle();
  assert.strictEqual(store.calls.length, 1);

  t.mock.timers.tick(10 * 60 * 1000);
  await settle();
  assert.strictEqual(store.calls.length, 2);

  job.stop();
  t.mock.timers.tick(30 * 60 * 1000);
  assert.strictEqual(store.calls.length, 2);
});

test('an interval of 0 disables the job', async () => {
  const store = fakeStore(() => 0);
  const job = new IdempotencyKeyPurgeJob({
    idempotencyStore: store,
    retentionHours: 1,
    intervalMinutes: 0,
    logger: silentLogger(),
  });

  job.start();
  await settle();

  assert.strictEqual(store.calls.length, 0);
});

test('a failed purge is logged and does not stop the job', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const errors = [];
  let attempt = 0;
  const store = fakeStore(() => {
    attempt += 1;
    if (attempt === 1) throw new Error('database unavailable');
    return 1;
  });
  const job = new IdempotencyKeyPurgeJob({
    idempotencyStore: store,
    retentionHours: 1,
    intervalMinutes: 1,
    logger: { info: () => {}, error: (...args) => errors.push(args) },
  });

  job.start();
  await settle();
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0][0], /Could not purge/);

  t.mock.timers.tick(60 * 1000);
  await settle();
  assert.strictEqual(store.calls.length, 2);
  assert.strictEqual(errors.length, 1);
  job.stop();
});
