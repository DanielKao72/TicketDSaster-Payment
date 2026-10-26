const {
  InMemoryIdempotencyStore,
} = require('../../../src/adapters/repositories/InMemoryIdempotencyStore');
const {
  describeIdempotencyStoreContract,
  LEASE_SECONDS,
  RETENTION_SECONDS,
} = require('./IdempotencyStoreContract');

// The store reads a fake clock; travelling moves it forward for every existing key.
describeIdempotencyStoreContract('InMemoryIdempotencyStore', () => {
  let now = Date.now();
  const store = new InMemoryIdempotencyStore({ leaseSeconds: LEASE_SECONDS, now: () => now });
  return {
    store,
    travelPastLease: () => {
      now += (LEASE_SECONDS + 1) * 1000;
    },
    travelPastRetention: () => {
      now += (RETENTION_SECONDS + 1) * 1000;
    },
  };
});
