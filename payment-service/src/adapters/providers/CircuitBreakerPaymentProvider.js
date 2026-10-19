const { PaymentProvider } = require('../../ports/outbound/PaymentProvider');
const { ProviderUnavailableError } = require('../../core/domain/DomainErrors');

const CLOSED = 'CLOSED'; // normal: calls go through
const OPEN = 'OPEN'; // outage detected: fail fast, do not call the provider
const HALF_OPEN = 'HALF_OPEN'; // cool-down over: let ONE trial call through

class CircuitOpenError extends ProviderUnavailableError {
  constructor() {
    super('The payment provider is temporarily unavailable (circuit open)');
  }
}

/**
 * Decorator that stops calling the provider after repeated outages so a Stripe
 * failure fails fast instead of piling up slow, retried requests.
 *
 * Only ProviderUnavailableError counts as a failure. A declined payment (a result) or a
 * configuration error means the provider answered, so it does not trip the breaker.
 */
class CircuitBreakerPaymentProvider extends PaymentProvider {
  #provider;
  #failureThreshold;
  #resetTimeoutMs;
  #now;
  #state = CLOSED;
  #failures = 0;
  #openedAt = 0;
  #probeInFlight = false;

  constructor({ provider, failureThreshold = 5, resetTimeoutMs = 30_000, now = Date.now }) {
    super();
    this.#provider = provider;
    this.#failureThreshold = failureThreshold;
    this.#resetTimeoutMs = resetTimeoutMs;
    this.#now = now;
  }

  get state() {
    return this.#state;
  }

  async authorize(request) {
    return this.#execute(() => this.#provider.authorize(request));
  }

  async capture(request) {
    return this.#execute(() => this.#provider.capture(request));
  }

  async refund(request) {
    return this.#execute(() => this.#provider.refund(request));
  }

  verifyWebhookSignature(rawBody, signature) {
    return this.#provider.verifyWebhookSignature(rawBody, signature);
  }

  async #execute(operation) {
    this.#beforeCall();
    try {
      const result = await operation();
      this.#onProviderReachable();
      return result;
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        this.#onOutage();
      } else {
        this.#onProviderReachable();
      }
      throw err;
    }
  }

  #beforeCall() {
    if (this.#state === OPEN) {
      if (this.#now() - this.#openedAt < this.#resetTimeoutMs) throw new CircuitOpenError();
      this.#state = HALF_OPEN;
      this.#probeInFlight = false;
    }
    if (this.#state === HALF_OPEN) {
      if (this.#probeInFlight) throw new CircuitOpenError(); // only one trial call at a time
      this.#probeInFlight = true;
    }
  }

  #onProviderReachable() {
    this.#state = CLOSED;
    this.#failures = 0;
    this.#probeInFlight = false;
  }

  #onOutage() {
    this.#probeInFlight = false;
    this.#failures += 1;
    if (this.#state === HALF_OPEN || this.#failures >= this.#failureThreshold) {
      this.#state = OPEN;
      this.#openedAt = this.#now();
    }
  }
}

module.exports = { CircuitBreakerPaymentProvider, CircuitOpenError };
