const crypto = require('node:crypto');

/**
 * In-memory provider for local development and tests. It implements the
 * PaymentProvider port (src/ports/outbound/payment-provider.port.js).
 *
 * It mimics a real provider with its own vocabulary (`requires_capture`,
 * `succeeded`, `declined`), which is translated to ProviderResult in `toProviderResult`.
 * Those statuses never leave this file.
 */

const DECLINE_TOKEN = 'tok_decline';

function toProviderResult(providerOperation, chargeStatus, providerReference, declineCode) {
  if (chargeStatus === 'declined') {
    return { status: 'FAILED', providerReference, declineReason: declineCode };
  }
  if (chargeStatus === 'requires_capture') {
    return { status: 'AUTHORIZED', providerReference };
  }
  if (chargeStatus === 'succeeded') {
    return { status: providerOperation === 'refund' ? 'REFUNDED' : 'CAPTURED', providerReference };
  }
  return { status: 'PENDING', providerReference };
}

function createFakePaymentProvider({ webhookSecret = 'fake-webhook-secret' } = {}) {
  // idempotencyKey -> ProviderResult, so retries with the same key never charge twice.
  const operations = new Map();

  function once(idempotencyKey, run) {
    if (!operations.has(idempotencyKey)) {
      operations.set(idempotencyKey, run());
    }
    return operations.get(idempotencyKey);
  }

  function newReference(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return {
    async authorize({ paymentMethodToken, idempotencyKey }) {
      return once(idempotencyKey, () => {
        const reference = newReference('ch');
        if (paymentMethodToken === DECLINE_TOKEN) {
          return toProviderResult('charge', 'declined', reference, 'card_declined');
        }
        return toProviderResult('charge', 'requires_capture', reference);
      });
    },

    async capture({ providerReference, idempotencyKey }) {
      return once(idempotencyKey, () =>
        toProviderResult('capture', 'succeeded', providerReference),
      );
    },

    async refund({ idempotencyKey }) {
      return once(idempotencyKey, () =>
        toProviderResult('refund', 'succeeded', newReference('re')),
      );
    },

    verifyWebhookSignature(rawBody, signature) {
      const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      const received = Buffer.from(String(signature ?? ''));
      return (
        received.length === expected.length &&
        crypto.timingSafeEqual(received, Buffer.from(expected))
      );
    },
  };
}

module.exports = { createFakePaymentProvider, DECLINE_TOKEN };
