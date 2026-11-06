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

    let result;
    try {
      result = await this.#paymentProvider.authorize({
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethodToken,
        idempotencyKey,
      });
      this.#apply(payment, result);
    } catch (err) {
      // The provider is unavailable (or answered something unknown): release the
      // Session so the retry starts clean. The retry reuses the idempotencyKey, so the
      // provider never charges twice.
      await this.#paymentRepository.discardPending(payment);
      throw err;
    }

    return this.#paymentRepository.save(payment);
  }

  #apply(payment, result) {
    switch (result.status) {
      case PaymentStatus.AUTHORIZED:
        payment.authorize(result.providerReference);
        break;
      case PaymentStatus.CAPTURED:
        payment.capture(result.providerReference);
        break;
      case PaymentStatus.FAILED:
        payment.fail(result.declineReason, result.providerReference);
        break;
      case PaymentStatus.PENDING:
        payment.awaitProviderResult(TransactionType.CHARGE, result.providerReference);
        break;
      default:
        throw new ProviderUnavailableError(`Unexpected provider status: ${result.status}`);
    }
  }
}

module.exports = { CreatePaymentUseCase };
