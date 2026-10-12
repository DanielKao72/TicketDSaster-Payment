const crypto = require('node:crypto');
const { PaymentProvider } = require('../../ports/outbound/PaymentProvider');

const DECLINE_TOKEN = 'tok_decline';

/**
 * In-memory provider for local development and tests.
 *
 * It mimics a real provider with its own vocabulary (`requires_capture`,
 * `succeeded`, `declined`), which `#toProviderResult` translates into the
 * domain's ProviderResult. Those statuses never leave this file.
 */
class FakePaymentProvider extends PaymentProvider {
  // idempotencyKey -> ProviderResult, so retries with the same key never charge twice.
  #operations = new Map();
  #webhookSecret;

  constructor({ webhookSecret = 'fake-webhook-secret' } = {}) {
    super();
    this.#webhookSecret = webhookSecret;
  }

  async authorize({ paymentMethodToken, idempotencyKey }) {
    return this.#once(idempotencyKey, () => {
      const reference = this.#newReference('ch');
      if (paymentMethodToken === DECLINE_TOKEN) {
        return this.#toProviderResult('charge', 'declined', reference, 'card_declined');
      }
      return this.#toProviderResult('charge', 'requires_capture', reference);
    });
  }

  async capture({ providerReference, idempotencyKey }) {
    return this.#once(idempotencyKey, () =>
      this.#toProviderResult('capture', 'succeeded', providerReference),
    );
  }

  async refund({ idempotencyKey }) {
    return this.#once(idempotencyKey, () =>
      this.#toProviderResult('refund', 'succeeded', this.#newReference('re')),
    );
  }

  verifyWebhookSignature(rawBody, signature) {
    const expected = crypto.createHmac('sha256', this.#webhookSecret).update(rawBody).digest('hex');
    const received = Buffer.from(String(signature ?? ''));
    return (
      received.length === expected.length && crypto.timingSafeEqual(received, Buffer.from(expected))
    );
  }

  #once(idempotencyKey, run) {
    if (!this.#operations.has(idempotencyKey)) {
      this.#operations.set(idempotencyKey, run());
    }
    return this.#operations.get(idempotencyKey);
  }

  #newReference(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  #toProviderResult(operation, chargeStatus, providerReference, declineCode) {
    if (chargeStatus === 'declined') {
      return { status: 'FAILED', providerReference, declineReason: declineCode };
    }
    if (chargeStatus === 'requires_capture') {
      return { status: 'AUTHORIZED', providerReference };
    }
    if (chargeStatus === 'succeeded') {
      return { status: operation === 'refund' ? 'REFUNDED' : 'CAPTURED', providerReference };
    }
    return { status: 'PENDING', providerReference };
  }
}

module.exports = { FakePaymentProvider, DECLINE_TOKEN };
