const { PaymentStatus } = require('../domain/PaymentStatus');
const { TransactionType } = require('../domain/Transaction');
const { ProviderUnavailableError } = require('../domain/DomainErrors');
const { loadOwnedPayment } = require('./LoadOwnedPayment');

// Refunds the full amount of a CAPTURED payment.
class RefundPaymentUseCase {
  #paymentRepository;
  #paymentProvider;

  constructor({ paymentRepository, paymentProvider }) {
    this.#paymentRepository = paymentRepository;
    this.#paymentProvider = paymentProvider;
  }

  async execute({ userId, paymentId, idempotencyKey }) {
    const payment = await loadOwnedPayment(this.#paymentRepository, { paymentId, userId });
    payment.assertCanTransitionTo(PaymentStatus.REFUNDED);

    const result = await this.#paymentProvider.refund({
      paymentId: payment.id,
      providerReference: payment.chargeReference,
      amount: payment.amount,
      idempotencyKey,
    });

    switch (result.status) {
      case PaymentStatus.REFUNDED:
        payment.refund(result.providerReference);
        break;
      case PaymentStatus.FAILED:
        payment.declineRefund(result.declineReason, result.providerReference);
        break;
      case PaymentStatus.PENDING:
        payment.awaitProviderResult(TransactionType.REFUND, result.providerReference);
        break;
      default:
        throw new ProviderUnavailableError(`Unexpected provider status: ${result.status}`);
    }

    return this.#paymentRepository.save(payment);
  }
}

module.exports = { RefundPaymentUseCase };
