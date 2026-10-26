const { Payment } = require('../domain/Payment');
const { PaymentStatus } = require('../domain/PaymentStatus');
const { TransactionType } = require('../domain/Transaction');
const { PaymentAlreadyExistsError, ProviderUnavailableError } = require('../domain/DomainErrors');

// Creates the Payment of a Session and asks the provider to authorize it. A declined
// authorization is not an error: the payment is persisted as FAILED.
// Returns { payment, nextAction }: nextAction is only set while the customer still has
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

    const payment = Payment.create({ sessionId, userId, amount, currency });

    const result = await this.#paymentProvider.authorize({
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethodToken,
      idempotencyKey,
    });

    let nextAction = null;

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
        nextAction = result.nextAction ?? null;
        break;
      default:
        throw new ProviderUnavailableError(`Unexpected provider status: ${result.status}`);
    }

    const saved = await this.#paymentRepository.save(payment);
    saved.nextAction = nextAction;
    return saved;
  }
}

module.exports = { CreatePaymentUseCase };
