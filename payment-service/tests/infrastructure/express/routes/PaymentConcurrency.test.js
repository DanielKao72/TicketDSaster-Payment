// Concurrency proof (8.2 / RF-21): many POST /payments for the same Session at the same
// time, each with its own Idempotency-Key, must authorize at the provider once and
// leave exactly one active payment. Runs with the in-memory store always, and with
// Postgres when TEST_DATABASE_URL is set.
const { describe, test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { buildApp } = require('../../../../src/infrastructure/express/App');
const { FakePaymentProvider } = require('../../../../src/adapters/providers/FakePaymentProvider');
const {
  InMemoryPaymentRepository,
} = require('../../../../src/adapters/repositories/InMemoryPaymentRepository');
const {
  InMemoryIdempotencyStore,
} = require('../../../../src/adapters/repositories/InMemoryIdempotencyStore');
const {
  PostgresPaymentRepository,
} = require('../../../../src/adapters/repositories/PostgresPaymentRepository');
const {
  PostgresIdempotencyStore,
} = require('../../../../src/adapters/repositories/PostgresIdempotencyStore');
const { skip: postgresSkip, connect, wipe } = require('../../../support/PostgresTestDatabase');

const JWT_SECRET = 'test-secret';
const FAN_ID = '00000000-0000-4000-8000-000000000001';
const CONCURRENT_REQUESTS = 10;
// The provider takes this long to answer, like a real one over the network: it keeps
// every request inside the race window between "is there a payment?" and "save it".
const PROVIDER_LATENCY_MS = 50;

// The mock provider, counting every authorization it grants.
class CountingPaymentProvider extends FakePaymentProvider {
  authorizations = [];

  async authorize(request) {
    await new Promise((resolve) => setTimeout(resolve, PROVIDER_LATENCY_MS));
    const result = await super.authorize(request);
    if (result.status === 'AUTHORIZED') this.authorizations.push(request);
    return result;
  }
}

function describeConcurrency(name, { setup, teardown, activePaymentsOf }, options = {}) {
  describe(`concurrent payments for one Session (${name})`, options, () => {
    let server;
    let baseUrl;
    let provider;
    let stores;

    beforeEach(async () => {
      stores = await setup();
      provider = new CountingPaymentProvider();
      const app = buildApp({ ...stores, paymentProvider: provider, jwtSecret: JWT_SECRET });
      server = app.listen(0);
      baseUrl = `http://localhost:${server.address().port}`;
    });

    afterEach(async () => {
      server.closeAllConnections();
      server.close();
      await teardown?.();
    });

    const token = jwt.sign({ sub: FAN_ID, role: 'Fan' }, JWT_SECRET, { expiresIn: '5m' });

    function createPayment(
      sessionId,
      { key = randomUUID(), paymentMethodToken = 'tok_visa' } = {},
    ) {
      return fetch(`${baseUrl}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ sessionId, amount: 150000, currency: 'MXN', paymentMethodToken }),
      });
    }

    async function settle(responses) {
      return Promise.all(
        responses.map(async (response) => ({
          status: response.status,
          body: await response.json(),
        })),
      );
    }

    test('different keys: one 201, the rest 409, one authorization and one active payment', async () => {
      const sessionId = randomUUID();

      const results = await settle(
        await Promise.all(
          Array.from({ length: CONCURRENT_REQUESTS }, () => createPayment(sessionId)),
        ),
      );

      const created = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);
      assert.strictEqual(created.length, 1, JSON.stringify(results.map((r) => r.status)));
      assert.strictEqual(conflicts.length, CONCURRENT_REQUESTS - 1);
      assert.ok(conflicts.every((r) => r.body.error.code === 'PAYMENT_ALREADY_EXISTS'));
      assert.strictEqual(provider.authorizations.length, 1, 'authorizations at the provider');
      assert.deepStrictEqual(await activePaymentsOf(stores, sessionId), [created[0].body.id]);
    });

    test('same and different keys mixed: still one authorization and one payment', async () => {
      const sessionId = randomUUID();
      const sharedKey = randomUUID();

      const results = await settle(
        await Promise.all([
          ...Array.from({ length: 5 }, () => createPayment(sessionId, { key: sharedKey })),
          ...Array.from({ length: 5 }, () => createPayment(sessionId)),
        ]),
      );

      const ids = new Set(results.filter((r) => r.status === 201).map((r) => r.body.id));
      assert.strictEqual(ids.size, 1);
      assert.ok(results.every((r) => r.status === 201 || r.status === 409));
      assert.strictEqual(provider.authorizations.length, 1);
      assert.deepStrictEqual(await activePaymentsOf(stores, sessionId), [...ids]);
    });

    test('after a declined payment, concurrent retries create a single new payment', async () => {
      const sessionId = randomUUID();
      const declined = await createPayment(sessionId, { paymentMethodToken: 'tok_decline' });
      assert.strictEqual(declined.status, 422);

      const results = await settle(
        await Promise.all(
          Array.from({ length: CONCURRENT_REQUESTS }, () => createPayment(sessionId)),
        ),
      );

      assert.strictEqual(results.filter((r) => r.status === 201).length, 1);
      assert.strictEqual(provider.authorizations.length, 1);
      assert.strictEqual((await activePaymentsOf(stores, sessionId)).length, 1);
    });

    test('a provider outage leaves the Session free for the next attempt', async () => {
      const sessionId = randomUUID();

      const outage = await createPayment(sessionId, { paymentMethodToken: 'tok_provider_error' });
      assert.strictEqual(outage.status, 502);
      assert.deepStrictEqual(await activePaymentsOf(stores, sessionId), []);

      const retry = await createPayment(sessionId);
      assert.strictEqual(retry.status, 201);
    });

    test('different Sessions at the same time never block each other', async () => {
      const sessions = Array.from({ length: CONCURRENT_REQUESTS }, () => randomUUID());

      const results = await settle(
        await Promise.all(sessions.map((sessionId) => createPayment(sessionId))),
      );

      assert.ok(results.every((r) => r.status === 201));
      assert.strictEqual(provider.authorizations.length, CONCURRENT_REQUESTS);
    });
  });
}

// The in-memory repository, remembering the last saved status of every stored payment.
class TrackingPaymentRepository extends InMemoryPaymentRepository {
  statusById = new Map();
  sessionById = new Map();

  async save(payment) {
    const saved = await super.save(payment);
    this.statusById.set(saved.id, saved.status);
    this.sessionById.set(saved.id, saved.sessionId);
    return saved;
  }

  async discardPending(payment) {
    const discarded = await super.discardPending(payment);
    if (discarded) this.statusById.delete(payment.id);
    return discarded;
  }
}

describeConcurrency('in memory', {
  setup: () => ({
    paymentRepository: new TrackingPaymentRepository(),
    idempotencyStore: new InMemoryIdempotencyStore(),
  }),
  activePaymentsOf: async ({ paymentRepository }, sessionId) =>
    [...paymentRepository.statusById]
      .filter(([id]) => paymentRepository.sessionById.get(id) === sessionId)
      .filter(([, status]) => status !== 'FAILED')
      .map(([id]) => id),
});

let knex;
describe('Postgres', { skip: postgresSkip }, () => {
  before(async () => {
    knex = await connect({ pool: { min: 0, max: CONCURRENT_REQUESTS + 5 } });
  });

  after(async () => {
    await knex?.destroy();
  });

  describeConcurrency('Postgres', {
    setup: async () => {
      await wipe(knex);
      return {
        paymentRepository: new PostgresPaymentRepository(knex),
        idempotencyStore: new PostgresIdempotencyStore(knex),
      };
    },
    activePaymentsOf: (_, sessionId) =>
      knex('payments').where({ session_id: sessionId }).whereNot({ status: 'FAILED' }).pluck('id'),
  });
});
