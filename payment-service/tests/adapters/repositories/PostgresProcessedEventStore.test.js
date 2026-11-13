const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const knex = require('knex');
const {
  PostgresProcessedEventStore,
} = require('../../../src/adapters/repositories/PostgresProcessedEventStore');

// Integration tests against a real Postgres. They are skipped unless DATABASE_URL
// points to a disposable test database.
const DATABASE_URL = process.env.DATABASE_URL;
const integration = {
  skip: DATABASE_URL ? false : 'DATABASE_URL is not set (needs a test Postgres)',
};

let db;
let store;

before(async () => {
  if (!DATABASE_URL) return;

  db = knex({ client: 'pg', connection: DATABASE_URL, pool: { min: 0, max: 5 } });
  await db.migrate.latest({ directory: path.join(__dirname, '../../../db/migrations') });
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
