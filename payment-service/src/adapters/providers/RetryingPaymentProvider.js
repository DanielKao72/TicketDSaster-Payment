const { PaymentProvider } = require('../../ports/outbound/PaymentProvider');
const { ProviderUnavailableError } = require('../../core/domain/DomainErrors');

/**
 * Decorator that adds a timeout and retries with exponential backoff to any provider
 * adapter. Only ProviderUnavailableError (and timeouts) are retried; a declined payment
 * is a result, not an error. Every retry sends the same request, so the same
 * idempotencyKey, and the provider never charges twice.
 */
class RetryingPaymentProvider extends PaymentProvider {
  #provider;
  #retries;
  #baseDelayMs;
  #timeoutMs;

  constructor({ provider, retries = 2, baseDelayMs = 200, timeoutMs = 5000 }) {
    super();
    this.#provider = provider;
    this.#retries = retries;
    this.#baseDelayMs = baseDelayMs;
    this.#timeoutMs = timeoutMs;
  }

  async authorize(request) {
    return this.#withRetries(() => this.#provider.authorize(request));
  }

  async capture(request) {
    return this.#withRetries(() => this.#provider.capture(request));
  }

  async refund(request) {
    return this.#withRetries(() => this.#provider.refund(request));
  }

  verifyWebhookSignature(rawBody, signature) {
    return this.#provider.verifyWebhookSignature(rawBody, signature);
  }

  async #withRetries(operation) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.#withTimeout(operation());
      } catch (err) {
        if (!(err instanceof ProviderUnavailableError) || attempt >= this.#retries) throw err;
        await new Promise((resolve) => setTimeout(resolve, this.#baseDelayMs * 2 ** attempt));
      }
    }
  }

  async #withTimeout(promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new ProviderUnavailableError('The payment provider timed out')),
        this.#timeoutMs,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { RetryingPaymentProvider };
