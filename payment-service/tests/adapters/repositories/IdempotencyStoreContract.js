// Behavior every IdempotencyStore adapter must have, run against each adapter.
//
// setup() resolves to { store, travelPastLease, travelPastRetention }:
//   - travelPastLease(): every lease taken so far is now expired.
//   - travelPastRetention(): every key that exists now is older than the retention period.
// Neither affects keys claimed afterwards.
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');

const LEASE_SECONDS = 60;
const RETENTION_SECONDS = 48 * 3600;
const RESPONSE = { paymentId: null, responseStatus: 201, responseBody: { status: 'AUTHORIZED' } };

function describeIdempotencyStoreContract(name, setup, options = {}) {
  describe(`${name} (IdempotencyStore contract)`, options, () => {
    let store;
    let travelPastLease;
    let travelPastRetention;

    beforeEach(async () => {
      ({ store, travelPastLease, travelPastRetention } = await setup());
    });

    const claim = (key, requestHash = 'hash-1', leaseToken = 'lease-a') =>
      store.claim({ key, requestHash, leaseToken: tokenFor(leaseToken) });

    test('a new key is claimed, and a second claim sees it in progress', async () => {
      assert.strictEqual(await claim('k1'), null);

      const existing = await claim('k1', 'hash-1', 'lease-b');

      assert.strictEqual(existing.key, 'k1');
      assert.strictEqual(existing.requestHash, 'hash-1');
      assert.strictEqual(existing.responseStatus, null);
      assert.ok(existing.leaseExpiresAt instanceof Date);
      assert.ok(existing.leaseExpiresAt.getTime() > Date.now());
    });

    test('complete stores the response so the next claim replays it', async () => {
      await claim('k1');

      assert.strictEqual(await store.complete('k1', tokenFor('lease-a'), RESPONSE), true);

      const existing = await claim('k1', 'hash-1', 'lease-b');
      assert.strictEqual(existing.responseStatus, 201);
      assert.deepStrictEqual(existing.responseBody, { status: 'AUTHORIZED' });
      assert.strictEqual(existing.leaseExpiresAt, null);
    });

    test('release frees the key so it can be claimed again', async () => {
      await claim('k1');

      assert.strictEqual(await store.release('k1', tokenFor('lease-a')), true);

      assert.strictEqual(await claim('k1', 'hash-1', 'lease-b'), null);
    });

    test('an in-progress key is not claimed again before its lease expires', async () => {
      await claim('k1');

      const existing = await claim('k1', 'hash-1', 'lease-b');

      assert.strictEqual(existing.responseStatus, null);
    });

    test('an abandoned key is claimed again by the same request once its lease expires', async () => {
      await claim('k1');
      await travelPastLease();

      assert.strictEqual(await claim('k1', 'hash-1', 'lease-b'), null);
    });

    test('an abandoned key is not claimed by a different request', async () => {
      await claim('k1');
      await travelPastLease();

      const existing = await claim('k1', 'hash-2', 'lease-b');

      assert.strictEqual(existing.requestHash, 'hash-1');
      assert.strictEqual(existing.responseStatus, null);
    });

    test('a completed key is never claimed again, even after the lease period', async () => {
      await claim('k1');
      await store.complete('k1', tokenFor('lease-a'), RESPONSE);
      await travelPastLease();

      const existing = await claim('k1', 'hash-1', 'lease-b');

      assert.strictEqual(existing.responseStatus, 201);
    });

    test('a request that lost its lease cannot complete or release the new claim', async () => {
      await claim('k1', 'hash-1', 'lease-a');
      await travelPastLease();
      await claim('k1', 'hash-1', 'lease-b');

      assert.strictEqual(await store.complete('k1', tokenFor('lease-a'), RESPONSE), false);
      assert.strictEqual(await store.release('k1', tokenFor('lease-a')), false);
      assert.strictEqual((await claim('k1', 'hash-1', 'lease-c')).responseStatus, null);

      assert.strictEqual(
        await store.complete('k1', tokenFor('lease-b'), { ...RESPONSE, responseStatus: 422 }),
        true,
      );
      assert.strictEqual((await claim('k1', 'hash-1', 'lease-c')).responseStatus, 422);
    });

    test('a request whose lease expired can still complete if nobody claimed the key', async () => {
      await claim('k1');
      await travelPastLease();

      assert.strictEqual(await store.complete('k1', tokenFor('lease-a'), RESPONSE), true);
    });

    test('a completed key cannot be completed or released again', async () => {
      await claim('k1');
      await store.complete('k1', tokenFor('lease-a'), RESPONSE);

      assert.strictEqual(await store.complete('k1', tokenFor('lease-a'), RESPONSE), false);
      assert.strictEqual(await store.release('k1', tokenFor('lease-a')), false);
      assert.strictEqual((await claim('k1', 'hash-1', 'lease-b')).responseStatus, 201);
    });

    test('concurrent claims of a new key: exactly one wins', async () => {
      const results = await Promise.all(
        ['a', 'b', 'c', 'd', 'e'].map((lease) => claim('k1', 'hash-1', lease)),
      );

      assert.strictEqual(results.filter((result) => result === null).length, 1);
    });

    test('concurrent claims of an abandoned key: exactly one wins', async () => {
      await claim('k1');
      await travelPastLease();

      const results = await Promise.all(
        ['b', 'c', 'd', 'e'].map((lease) => claim('k1', 'hash-1', lease)),
      );

      assert.strictEqual(results.filter((result) => result === null).length, 1);
    });

    test('purgeExpired deletes completed keys past the retention period and keeps newer ones', async () => {
      await claim('old');
      await store.complete('old', tokenFor('lease-a'), RESPONSE);
      await travelPastRetention();
      await claim('recent');
      await store.complete('recent', tokenFor('lease-a'), RESPONSE);

      assert.strictEqual(await store.purgeExpired({ retentionSeconds: RETENTION_SECONDS }), 1);

      assert.strictEqual(await claim('old', 'hash-2', 'lease-b'), null);
      assert.strictEqual((await claim('recent', 'hash-1', 'lease-b')).responseStatus, 201);
    });

    test('purgeExpired deletes abandoned keys past the retention period, whatever their request', async () => {
      await claim('abandoned');
      await travelPastLease();
      await travelPastRetention();

      assert.strictEqual(await store.purgeExpired({ retentionSeconds: RETENTION_SECONDS }), 1);

      assert.strictEqual(await claim('abandoned', 'hash-2', 'lease-b'), null);
    });

    test('purgeExpired keeps in-progress keys whose lease expired within the retention period', async () => {
      await claim('in-progress');
      await claim('abandoned-recently');
      await travelPastLease();

      assert.strictEqual(await store.purgeExpired({ retentionSeconds: RETENTION_SECONDS }), 0);

      assert.strictEqual((await claim('in-progress', 'hash-2', 'lease-b')).requestHash, 'hash-1');
    });
  });
}

// Lease tokens are uuids (the Postgres column is uuid); readable names map to fixed ones.
const TOKENS = new Map();
function tokenFor(name) {
  if (!TOKENS.has(name)) {
    const suffix = String(TOKENS.size + 1).padStart(12, '0');
    TOKENS.set(name, `00000000-0000-4000-8000-${suffix}`);
  }
  return TOKENS.get(name);
}

module.exports = { describeIdempotencyStoreContract, LEASE_SECONDS, RETENTION_SECONDS };
