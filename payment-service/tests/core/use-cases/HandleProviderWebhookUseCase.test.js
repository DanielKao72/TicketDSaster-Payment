const { test } = require('node:test');
const assert = require('node:assert');
const {
  HandleProviderWebhookUseCase,
} = require('../../../src/core/use-cases/HandleProviderWebhookUseCase');
const { CreatePaymentUseCase } = require('../../../src/core/use-cases/CreatePaymentUseCase');
const {
  InMemoryPaymentRepository,
} = require('../../../src/adapters/repositories/InMemoryPaymentRepository');
const {
  InMemoryProcessedEventStore,
} = require('../../../src/adapters/repositories/InMemoryProcessedEventStore');
const { PAYMENT_REQUEST } = require('./Fixtures');

async function pendingPayment(providerReference = 'ch_pending_1') {
  const paymentRepository = new InMemoryPaymentRepository();
  const processedEventStore = new InMemoryProcessedEventStore();
  const createPayment = new CreatePaymentUseCase({
    paymentRepository,
    paymentProvider: { authorize: async () => ({ status: 'PENDING', providerReference }) },
  });
  const payment = await createPayment.execute(PAYMENT_REQUEST);

  return {
    payment,
    paymentRepository,
    processedEventStore,
    webhook: new HandleProviderWebhookUseCase({ paymentRepository, processedEventStore }),
    providerReference,
  };
}

function event(providerReference, status, overrides = {}) {
  return {
    eventId: `evt_${status}_${Math.random().toString(36).slice(2)}`,
    type: `test.${status}`,
    providerReference,
    status,
    ...overrides,
  };
}

test('resolves a PENDING payment to AUTHORIZED', async () => {
  const { payment, paymentRepository, webhook, providerReference } = await pendingPayment();

  const result = await webhook.execute(event(providerReference, 'AUTHORIZED'));

  assert.strictEqual(result.outcome, 'applied');
  const stored = await paymentRepository.findById(payment.id);
  assert.strictEqual(stored.status, 'AUTHORIZED');
  assert.strictEqual(stored.transactions.at(-1).type, 'CHARGE');
  assert.strictEqual(stored.transactions.at(-1).status, 'SUCCEEDED');
});

test('resolves a PENDING payment directly to CAPTURED', async () => {
  const { payment, paymentRepository, webhook, providerReference } = await pendingPayment();

  await webhook.execute(event(providerReference, 'CAPTURED'));

  assert.strictEqual((await paymentRepository.findById(payment.id)).status, 'CAPTURED');
});

test('resolves a PENDING payment to FAILED with the decline reason', async () => {
  const { payment, paymentRepository, webhook, providerReference } = await pendingPayment();

  await webhook.execute(event(providerReference, 'FAILED', { declineReason: 'card_declined' }));

  const stored = await paymentRepository.findById(payment.id);
  assert.strictEqual(stored.status, 'FAILED');
  assert.strictEqual(stored.declineReason, 'card_declined');
});

test('ignores an event with the same id (provider retry)', async () => {
  const { payment, paymentRepository, webhook, providerReference } = await pendingPayment();
  const sameEvent = event(providerReference, 'AUTHORIZED');

  await webhook.execute(sameEvent);
  const transactionsAfterFirst = (await paymentRepository.findById(payment.id)).transactions.length;
  const duplicate = await webhook.execute(sameEvent);

  assert.strictEqual(duplicate.outcome, 'duplicate');
  assert.strictEqual(
    (await paymentRepository.findById(payment.id)).transactions.length,
    transactionsAfterFirst,
  );
});

test('ignores an event whose provider reference matches no payment', async () => {
  const { webhook } = await pendingPayment();

  const result = await webhook.execute(event('ch_unknown', 'CAPTURED'));

  assert.strictEqual(result.outcome, 'ignored');
  assert.strictEqual(result.reason, 'payment_not_found');
});

test('a late event never rolls back a captured payment', async () => {
  const { payment, paymentRepository, webhook, providerReference } = await pendingPayment();
  await webhook.execute(event(providerReference, 'CAPTURED'));

  const late = await webhook.execute(event(providerReference, 'AUTHORIZED'));

  assert.strictEqual(late.outcome, 'ignored');
  assert.strictEqual(late.reason, 'invalid_transition');
  assert.strictEqual((await paymentRepository.findById(payment.id)).status, 'CAPTURED');
});

test('a late event never moves a refunded payment out of its terminal state', async () => {
  const { payment, paymentRepository, webhook, providerReference } = await pendingPayment();
  await webhook.execute(event(providerReference, 'CAPTURED'));
  await webhook.execute(event(providerReference, 'REFUNDED'));

  const late = await webhook.execute(event(providerReference, 'CAPTURED'));

  assert.strictEqual(late.outcome, 'ignored');
  assert.strictEqual(late.reason, 'terminal_status');
  assert.strictEqual((await paymentRepository.findById(payment.id)).status, 'REFUNDED');
});

test('ignores an invalid transition without throwing', async () => {
  const { payment, paymentRepository, webhook, providerReference } = await pendingPayment();

  const result = await webhook.execute(event(providerReference, 'REFUNDED'));

  assert.strictEqual(result.outcome, 'ignored');
  assert.strictEqual(result.reason, 'invalid_transition');
  assert.strictEqual((await paymentRepository.findById(payment.id)).status, 'PENDING');
});

test('an event with no mapped status is acknowledged without changes', async () => {
  const { payment, paymentRepository, webhook, providerReference } = await pendingPayment();

  const result = await webhook.execute(event(providerReference, null));

  assert.strictEqual(result.outcome, 'ignored');
  assert.strictEqual((await paymentRepository.findById(payment.id)).status, 'PENDING');
});
