const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  PostgresProcessedEventStore,
} = require('../../../src/adapters/repositories/PostgresProcessedEventStore');
const { skip, connect } = require('../../support/PostgresTestDatabase');

// Integration tests against a real Postgres, skipped unless TEST_DATABASE_URL is set.
const integration = { skip };

let db;
let store;

before(async () => {
  if (skip) return;

  db = await connect({ pool: { min: 0, max: 5 } });
  store = new PostgresProcessedEventStore(db);
});

after(async () => {
  if (db) await db.destroy();
});

test('registers the first delivery and ignores a repeated event id', integration, async () => {
  const eventId = `evt_test_${randomUUID()}`;

  try {
    assert.strictEqual(await store.register(eventId, { type: 'payment_intent.succeeded' }), true);
    assert.strictEqual(await store.register(eventId, { type: 'payment_intent.succeeded' }), false);
  } finally {
    await db('processed_provider_events').where({ event_id: eventId }).del();
  }
});

test('two parallel deliveries of the same event id insert a single row', integration, async () => {
  const eventId = `evt_test_${randomUUID()}`;

  try {
    const results = await Promise.all([store.register(eventId), store.register(eventId)]);

    assert.strictEqual(results.filter(Boolean).length, 1);
    const rows = await db('processed_provider_events').where({ event_id: eventId });
    assert.strictEqual(rows.length, 1);
  } finally {
    await db('processed_provider_events').where({ event_id: eventId }).del();
  }
});
