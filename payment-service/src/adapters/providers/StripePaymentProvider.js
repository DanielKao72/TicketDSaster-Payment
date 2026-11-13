const { PaymentProvider } = require('../../ports/outbound/PaymentProvider');
const { NotImplementedError } = require('../../ports/Port');
const { ProviderUnavailableError } = require('../../core/domain/DomainErrors');

const OUTAGE_ERROR_TYPES = new Set([
  'StripeConnectionError',
  'StripeAPIError',
  'StripeRateLimitError',
]);

class StripePaymentProvider extends PaymentProvider {
  #client;
  #webhookSecret;

  constructor({ client, webhookSecret }) {
    super();
    this.#client = client;
    this.#webhookSecret = webhookSecret;
  }

  async authorize({ paymentId, amount, currency, paymentMethodToken, idempotencyKey }) {
    return this.#run(() =>
      this.#client.paymentIntents.create(
        {
          amount,
          currency: currency.toLowerCase(),
          payment_method: paymentMethodToken,
          capture_method: 'manual',
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          metadata: { paymentId },
        },
        { idempotencyKey: `${idempotencyKey}:authorize` },
      ),
    );
  }

  async capture({ providerReference, amount, idempotencyKey }) {
    return this.#run(() =>
      this.#client.paymentIntents.capture(
        providerReference,
        { amount_to_capture: amount },
        { idempotencyKey: `${idempotencyKey}:capture` }, // [Tarea 2]
      ),
    );
  }

  async refund() {
    throw new NotImplementedError('StripePaymentProvider.refund');
  }

  verifyWebhookSignature(rawBody, signature) {
    if (!this.#webhookSecret || !signature) return false;
    try {
      this.#client.webhooks.constructEvent(rawBody, signature, this.#webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  async #run(operation) {
    let intent;
    try {
      intent = await operation();
    } catch (err) {
      return this.#fromError(err);
    }
    return this.#toProviderResult(intent);
  }

  #toProviderResult(intent) {
    switch (intent.status) {
      case 'requires_capture': // authorized, waiting for capture
        return { status: 'AUTHORIZED', providerReference: intent.id };
      case 'succeeded': // captured
        return { status: 'CAPTURED', providerReference: intent.id };
      case 'requires_action':
        return {
          status: 'PENDING',
          providerReference: intent.id,
          nextAction: {
            type: intent.next_action?.type ?? null,
            clientSecret: intent.client_secret,
          },
        };
      case 'processing': // Stripe is still working; the result arrives by webhook
        return { status: 'PENDING', providerReference: intent.id };
      default:
        throw new Error(`Unexpected Stripe PaymentIntent status: ${intent.status}`);
    }
  }

  #fromError(err) {
    if (err?.type === 'StripeCardError') {
      return {
        status: 'FAILED',
        providerReference: err.payment_intent?.id ?? null,
        declineReason: err.decline_code ?? err.code,
      };
    }
    if (OUTAGE_ERROR_TYPES.has(err?.type) || err?.statusCode >= 500) {
      const unavailable = new ProviderUnavailableError();
      unavailable.cause = err;
      throw unavailable;
    }
    throw err;
  }
}

module.exports = { StripePaymentProvider };
