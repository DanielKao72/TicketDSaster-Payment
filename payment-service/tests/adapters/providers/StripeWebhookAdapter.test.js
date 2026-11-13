const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { StripeWebhookAdapter } = require('../../../src/adapters/providers/StripeWebhookAdapter');

const SECRET = 'whsec_test_secret';

function sign(body, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function stripeEvent(type, object) {
  return JSON.stringify({ id: 'evt_123', type, data: { object } });
}

test('accepts a valid Stripe-Signature', () => {
  const adapter = new StripeWebhookAdapter({ webhookSecret: SECRET });
  const body = stripeEvent('payment_intent.succeeded', { id: 'pi_123' });

  assert.strictEqual(adapter.verifySignature(body, sign(body)), true);
});

test('rejects a tampered body, a wrong secret, and an expired timestamp', () => {
  const adapter = new StripeWebhookAdapter({ webhookSecret: SECRET });
  const body = stripeEvent('payment_intent.succeeded', { id: 'pi_123' });
  const signature = sign(body);
  const expired = sign(body, { timestamp: Math.floor(Date.now() / 1000) - 3600 });

  assert.strictEqual(adapter.verifySignature(`${body} `, signature), false);
  assert.strictEqual(adapter.verifySignature(body, sign(body, { secret: 'other' })), false);
  assert.strictEqual(adapter.verifySignature(body, expired), false);
  assert.strictEqual(adapter.verifySignature(body, undefined), false);
});

test('rejects every request when no webhook secret is configured', () => {
  const adapter = new StripeWebhookAdapter({ webhookSecret: undefined });
  const body = stripeEvent('payment_intent.succeeded', { id: 'pi_123' });

  assert.strictEqual(adapter.verifySignature(body, sign(body)), false);
});

test('parses intent events into domain statuses and the provider reference', () => {
  const adapter = new StripeWebhookAdapter({ webhookSecret: SECRET });

  assert.deepStrictEqual(
    adapter.parseEvent(stripeEvent('payment_intent.amount_capturable_updated', { id: 'pi_1' })),
    {
      eventId: 'evt_123',
      type: 'payment_intent.amount_capturable_updated',
      providerReference: 'pi_1',
      status: 'AUTHORIZED',
      declineReason: null,
    },
  );
  assert.strictEqual(
    adapter.parseEvent(stripeEvent('payment_intent.succeeded', { id: 'pi_1' })).status,
    'CAPTURED',
  );
  assert.strictEqual(
    adapter.parseEvent(stripeEvent('charge.refunded', { id: 'ch_1' })).status,
    'REFUNDED',
  );
});

test('carries the decline reason on a failed payment intent', () => {
  const adapter = new StripeWebhookAdapter({ webhookSecret: SECRET });
  const body = stripeEvent('payment_intent.payment_failed', {
    id: 'pi_1',
    last_payment_error: { code: 'card_declined' },
  });

  const event = adapter.parseEvent(body);

  assert.strictEqual(event.status, 'FAILED');
  assert.strictEqual(event.declineReason, 'card_declined');
});

test('leaves the status empty for an event that does not change a payment', () => {
  const adapter = new StripeWebhookAdapter({ webhookSecret: SECRET });

  assert.strictEqual(
    adapter.parseEvent(stripeEvent('customer.created', { id: 'cus_1' })).status,
    null,
  );
});

test('rejects a payload without an event id', () => {
  const adapter = new StripeWebhookAdapter({ webhookSecret: SECRET });

  assert.throws(() => adapter.parseEvent(JSON.stringify({ type: 'payment_intent.succeeded' })), {
    name: 'TypeError',
  });
});
