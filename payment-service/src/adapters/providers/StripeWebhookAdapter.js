const crypto = require('node:crypto');
const { WebhookAdapter } = require('../../ports/outbound/WebhookAdapter');
const { PaymentStatus } = require('../../core/domain/PaymentStatus');

// Stripe event types this service acts on, translated to domain statuses. Any other
// event is still recorded (for deduplication) but does not change a payment.
const STATUS_BY_EVENT = new Map([
  ['payment_intent.amount_capturable_updated', PaymentStatus.AUTHORIZED],
  ['payment_intent.succeeded', PaymentStatus.CAPTURED],
  ['payment_intent.payment_failed', PaymentStatus.FAILED],
  ['payment_intent.canceled', PaymentStatus.FAILED],
  ['charge.refunded', PaymentStatus.REFUNDED],
]);

const DEFAULT_TOLERANCE_SECONDS = 300;

function timingSafeEqualHex(received, expected) {
  const receivedBuffer = Buffer.from(String(received));
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

/**
 * Stripe webhook adapter (Anti-Corruption Layer).
 *
 * Stripe signs the raw body as `Stripe-Signature: t=<unix>,v1=<hmac>` where the HMAC
 * is SHA-256 over `<unix>.<raw body>` with the endpoint's signing secret. Nothing
 * Stripe-specific leaves this file.
 */
class StripeWebhookAdapter extends WebhookAdapter {
  #webhookSecret;
  #toleranceSeconds;

  constructor({ webhookSecret, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS }) {
    super();
    this.#webhookSecret = webhookSecret;
    this.#toleranceSeconds = toleranceSeconds;
  }

  verifySignature(rawBody, signature) {
    if (!this.#webhookSecret || !rawBody || !signature) return false;

    let timestamp;
    const signatures = [];
    for (const part of String(signature).split(',')) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = value;
      if (key === 'v1') signatures.push(value);
    }

    const timestampSeconds = Number(timestamp);
    if (!Number.isInteger(timestampSeconds) || signatures.length === 0) return false;

    const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
    if (ageSeconds > this.#toleranceSeconds) return false;

    const expected = crypto
      .createHmac('sha256', this.#webhookSecret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex');

    return signatures.some((candidate) => timingSafeEqualHex(candidate, expected));
  }

  parseEvent(rawBody) {
    const event = JSON.parse(rawBody.toString('utf8'));
    if (!event.id || !event.type) {
      throw new TypeError('Stripe event is missing an id or a type');
    }
    const object = event.data?.object ?? {};

    return {
      eventId: event.id,
      type: event.type,
      providerReference: object.id ?? null,
      status: STATUS_BY_EVENT.get(event.type) ?? null,
      declineReason: object.last_payment_error?.code ?? object.failure_message ?? null,
    };
  }
}

module.exports = { StripeWebhookAdapter };
