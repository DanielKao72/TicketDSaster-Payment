const { Payment } = require('../domain/Payment');
const { PaymentStatus } = require('../domain/PaymentStatus');
const { TransactionType } = require('../domain/Transaction');
const { PaymentAlreadyExistsError, ProviderUnavailableError } = require('../domain/DomainErrors');

// Creates the Payment of a Session and asks the provider to authorize it. A declined
// authorization is not an error: the payment is persisted as FAILED.
//
// The Session is reserved before calling the provider: the payment is saved as PENDING
// first, and the repository allows one active payment per Session atomically. Of
// several concurrent requests for the same Session (even with different
// Idempotency-Keys), only one gets past that save, so the provider authorizes once.
//
// The returned payment carries nextAction: it is only set while the customer still has
// to act (e.g. 3-D Secure) and is never persisted.
class CreatePaymentUseCase {
  #paymentRepository;
  #paymentProvider;

  constructor({ paymentRepository, paymentProvider }) {
    this.#paymentRepository = paymentRepository;
    this.#paymentProvider = paymentProvider;
  }

  async execute({ userId, sessionId, amount, currency, paymentMethodToken, idempotencyKey }) {
    const existing = await this.#paymentRepository.findBySessionId(sessionId);
    if (existing && existing.status !== PaymentStatus.FAILED) {
      throw new PaymentAlreadyExistsError(sessionId);
    }

    // Throws PaymentAlreadyExistsError if another request reserved the Session meanwhile.
    const payment = await this.#paymentRepository.save(
      Payment.create({ sessionId, userId, amount, currency }),
    );

    let nextAction;
    try {
      const result = await this.#paymentProvider.authorize({
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethodToken,
        idempotencyKey,
      });
      nextAction = this.#apply(payment, result);
    } catch (err) {
      // The provider is unavailable (or answered something unknown): release the
      // Session so the retry starts clean. The retry reuses the idempotencyKey, so the
      // provider never charges twice.
      await this.#paymentRepository.discardPending(payment);
      throw err;
    }

    const saved = await this.#paymentRepository.save(payment);
    saved.nextAction = nextAction;
    return saved;
  }

  // Applies the provider's result to the payment and returns its nextAction (or null).
  #apply(payment, result) {
    switch (result.status) {
      case PaymentStatus.AUTHORIZED:
        payment.authorize(result.providerReference);
        return null;
      case PaymentStatus.CAPTURED:
        payment.capture(result.providerReference);
        return null;
      case PaymentStatus.FAILED:
        payment.fail(result.declineReason, result.providerReference);
        return null;
      case PaymentStatus.PENDING:
        payment.awaitProviderResult(TransactionType.CHARGE, result.providerReference);
        return result.nextAction ?? null;
      default:
        throw new ProviderUnavailableError(`Unexpected provider status: ${result.status}`);
    }
  }
}

module.exports = { CreatePaymentUseCase };
