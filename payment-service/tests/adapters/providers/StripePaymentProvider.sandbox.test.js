const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Stripe = require('stripe');
const { StripePaymentProvider } = require('../../../src/adapters/providers/StripePaymentProvider');

const secretKey = process.env.STRIPE_SECRET_KEY;
const skip = secretKey?.startsWith('sk_test_')
  ? false
  : 'Set STRIPE_SECRET_KEY=sk_test_... to run the Stripe sandbox tests';

const VISA_OK = 'pm_card_visa';
const CARD_DECLINED = 'pm_card_chargeDeclined';
const NEEDS_3DS = 'pm_card_threeDSecureRequired';

function buildProvider() {
  const client = new Stripe(secretKey, { maxNetworkRetries: 0 });
  return new StripePaymentProvider({ client, webhookSecret: 'whsec_unused' });
}

function authorizeRequest(paymentMethodToken, idempotencyKey = crypto.randomUUID()) {
  return {
    paymentId: crypto.randomUUID(),
    amount: 5000,
    currency: 'MXN',
    paymentMethodToken,
    idempotencyKey,
  };
}

describe('Stripe sandbox contract', { skip }, () => {
  test('authorize reserves the money: AUTHORIZED with a PaymentIntent id', async () => {
    const result = await buildProvider().authorize(authorizeRequest(VISA_OK));

    assert.equal(result.status, 'AUTHORIZED');
    assert.match(result.providerReference, /^pi_/);
  });

  test('capture takes the reserved money: CAPTURED', async () => {
    const provider = buildProvider();
    const auth = await provider.authorize(authorizeRequest(VISA_OK));

    const result = await provider.capture({
      paymentId: crypto.randomUUID(),
      providerReference: auth.providerReference,
      amount: 5000,
      idempotencyKey: crypto.randomUUID(),
    });

    assert.equal(result.status, 'CAPTURED');
    assert.equal(result.providerReference, auth.providerReference);
  });

  test('a declined card is FAILED with a decline reason', async () => {
    const result = await buildProvider().authorize(authorizeRequest(CARD_DECLINED));

    assert.equal(result.status, 'FAILED');
    assert.equal(typeof result.declineReason, 'string');
  });

  test('a card that needs 3-D Secure is PENDING with a nextAction', async () => {
    const result = await buildProvider().authorize(authorizeRequest(NEEDS_3DS));

    assert.equal(result.status, 'PENDING');
    assert.ok(result.nextAction.clientSecret);
  });

  test('retrying authorize with the same key never creates a second charge', async () => {
    const provider = buildProvider();
    const request = authorizeRequest(VISA_OK);

    const first = await provider.authorize(request);
    const retry = await provider.authorize(request);

    assert.equal(retry.providerReference, first.providerReference);
  });

  test('retrying capture with the same key never captures twice', async () => {
    const provider = buildProvider();
    const auth = await provider.authorize(authorizeRequest(VISA_OK));
    const captureRequest = {
      paymentId: crypto.randomUUID(),
      providerReference: auth.providerReference,
      amount: 5000,
      idempotencyKey: crypto.randomUUID(),
    };

    const first = await provider.capture(captureRequest);
    const retry = await provider.capture(captureRequest);

    assert.equal(first.status, 'CAPTURED');
    assert.equal(retry.status, 'CAPTURED');
    assert.equal(retry.providerReference, first.providerReference);
  });
});
