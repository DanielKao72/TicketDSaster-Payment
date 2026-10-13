const { Payment } = require('../domain/Payment');
const { PaymentStatus } = require('../domain/PaymentStatus');
const { TransactionType } = require('../domain/Transaction');
const { PaymentAlreadyExistsError, ProviderUnavailableError } = require('../domain/DomainErrors');

// Creates the Payment of a Session and asks the provider to authorize it. A declined
// authorization is not an error: the payment is persisted as FAILED.
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

    const payment = Payment.create({ sessionId, userId, amount, currency });

    // Nothing is persisted if the provider is unavailable, so the retry starts clean
    // (and reuses the idempotencyKey, so the provider never charges twice).
    const result = await this.#paymentProvider.authorize({
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethodToken,
      idempotencyKey,
    });

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

    return this.#paymentRepository.save(payment);
  }
}

module.exports = { CreatePaymentUseCase };
