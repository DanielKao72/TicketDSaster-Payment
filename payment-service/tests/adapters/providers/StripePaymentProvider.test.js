const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { StripePaymentProvider } = require('../../../src/adapters/providers/StripePaymentProvider');
const { ProviderUnavailableError } = require('../../../src/core/domain/DomainErrors');

function stripeError(type, extra = {}) {
  return Object.assign(new Error(type), { type, ...extra });
}

// Fake Stripe SDK client: records every call, so no network is needed.
function buildProvider({ create, capture, constructEvent } = {}) {
  const calls = { create: [], capture: [] };
  const client = {
    paymentIntents: {
      create: async (params, options) => {
        calls.create.push({ params, options });
        return create ? create() : { id: 'pi_1', status: 'requires_capture' };
      },
      capture: async (id, params, options) => {
        calls.capture.push({ id, params, options });
        return capture ? capture() : { id, status: 'succeeded' };
      },
    },
    webhooks: { constructEvent: constructEvent ?? (() => ({})) },
  };
  return { provider: new StripePaymentProvider({ client, webhookSecret: 'whsec_test' }), calls };
}

const request = {
  paymentId: 'pay_1',
  amount: 5000,
  currency: 'MXN',
  paymentMethodToken: 'pm_card_visa',
  idempotencyKey: 'key-1',
};

describe('StripePaymentProvider.authorize', () => {
  test('creates a manual-capture PaymentIntent and returns AUTHORIZED', async () => {
    const { provider, calls } = buildProvider();
    const result = await provider.authorize(request);

    assert.deepEqual(result, { status: 'AUTHORIZED', providerReference: 'pi_1' });
    const { params } = calls.create[0];
    assert.equal(params.amount, 5000);
    assert.equal(params.currency, 'mxn');
    assert.equal(params.payment_method, 'pm_card_visa');
    assert.equal(params.capture_method, 'manual');
  });

  test('a declined card is a FAILED result, not an error', async () => {
    const { provider } = buildProvider({
      create: () => {
        throw stripeError('StripeCardError', {
          decline_code: 'insufficient_funds',
          payment_intent: { id: 'pi_declined' },
        });
      },
    });
    const result = await provider.authorize(request);

    assert.deepEqual(result, {
      status: 'FAILED',
      providerReference: 'pi_declined',
      declineReason: 'insufficient_funds',
    });
  });

  test('a Stripe outage becomes ProviderUnavailableError', async () => {
    const { provider } = buildProvider({
      create: () => {
        throw stripeError('StripeConnectionError');
      },
    });
    await assert.rejects(() => provider.authorize(request), ProviderUnavailableError);
  });

  test('a configuration error is not disguised as an outage', async () => {
    const { provider } = buildProvider({
      create: () => {
        throw stripeError('StripeAuthenticationError');
      },
    });
    await assert.rejects(
      () => provider.authorize(request),
      (err) => err.type === 'StripeAuthenticationError',
    );
  });

  test('an unexpected status is an error', async () => {
    const { provider } = buildProvider({ create: () => ({ id: 'pi_x', status: 'canceled' }) });
    await assert.rejects(() => provider.authorize(request), /Unexpected Stripe/);
  });

  test('sends the idempotency key to Stripe, identical on every retry', async () => {
    const { provider, calls } = buildProvider();
    await provider.authorize(request);
    await provider.authorize(request);

    assert.equal(calls.create[0].options.idempotencyKey, 'key-1:authorize');
    assert.equal(calls.create[1].options.idempotencyKey, 'key-1:authorize');
  });

  test('returns PENDING with nextAction when the customer must act', async () => {
    const { provider } = buildProvider({
      create: () => ({
        id: 'pi_3ds',
        status: 'requires_action',
        client_secret: 'pi_3ds_secret_abc',
        next_action: { type: 'use_stripe_sdk' },
      }),
    });
    const result = await provider.authorize(request);

    assert.deepEqual(result, {
      status: 'PENDING',
      providerReference: 'pi_3ds',
      nextAction: { type: 'use_stripe_sdk', clientSecret: 'pi_3ds_secret_abc' },
    });
  });
});

describe('StripePaymentProvider.capture', () => {
  test('captures the PaymentIntent and returns CAPTURED', async () => {
    const { provider, calls } = buildProvider();
    const result = await provider.capture({
      paymentId: 'pay_1',
      providerReference: 'pi_1',
      amount: 5000,
      idempotencyKey: 'key-2',
    });

    assert.deepEqual(result, { status: 'CAPTURED', providerReference: 'pi_1' });
    assert.equal(calls.capture[0].id, 'pi_1');
    assert.equal(calls.capture[0].params.amount_to_capture, 5000);
  });

  test('sends the idempotency key on capture', async () => {
    const { provider, calls } = buildProvider();
    await provider.capture({ providerReference: 'pi_1', amount: 5000, idempotencyKey: 'key-2' });
    assert.equal(calls.capture[0].options.idempotencyKey, 'key-2:capture');
  });
});

describe('StripePaymentProvider other methods', () => {
  test('refund is out of scope', async () => {
    const { provider } = buildProvider();
    await assert.rejects(() => provider.refund({}), /not implemented/i);
  });

  test('verifyWebhookSignature returns true for a valid signature', () => {
    const { provider } = buildProvider();
    assert.equal(provider.verifyWebhookSignature('{}', 't=1,v1=abc'), true);
  });

  test('verifyWebhookSignature returns false when Stripe rejects the signature', () => {
    const { provider } = buildProvider({
      constructEvent: () => {
        throw new Error('bad signature');
      },
    });
    assert.equal(provider.verifyWebhookSignature('{}', 'bad'), false);
  });
});
