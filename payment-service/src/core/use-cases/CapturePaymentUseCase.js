const { PaymentStatus } = require('../domain/PaymentStatus');
const { TransactionType } = require('../domain/Transaction');
const {
  InvalidPaymentTransitionError,
  ProviderUnavailableError,
} = require('../domain/DomainErrors');
const { loadOwnedPayment } = require('./LoadOwnedPayment');
const { notifyBookingSafely } = require('./NotifyBookingSafely');

// Captures an AUTHORIZED payment (Booking calls it once the seats are confirmed).
class CapturePaymentUseCase {
  #paymentRepository;
  #paymentProvider;
  #bookingNotifier;

  constructor({ paymentRepository, paymentProvider, bookingNotifier }) {
    this.#paymentRepository = paymentRepository;
    this.#paymentProvider = paymentProvider;
    this.#bookingNotifier = bookingNotifier;
  }

  async execute({ userId, paymentId, idempotencyKey }) {
    const payment = await loadOwnedPayment(this.#paymentRepository, { paymentId, userId });

    // PENDING → CAPTURED is a valid transition for one-step providers, but there is
    // no authorization to capture yet.
    if (payment.status !== PaymentStatus.AUTHORIZED) {
      throw new InvalidPaymentTransitionError(payment.status, PaymentStatus.CAPTURED);
    }

    const result = await this.#paymentProvider.capture({
      paymentId: payment.id,
      providerReference: payment.chargeReference,
      amount: payment.amount,
      idempotencyKey,
    });

    switch (result.status) {
      case PaymentStatus.CAPTURED:
        payment.capture(result.providerReference);
        break;
      case PaymentStatus.FAILED:
        payment.fail(result.declineReason, result.providerReference);
        break;
      case PaymentStatus.PENDING:
        payment.awaitProviderResult(TransactionType.CAPTURE, result.providerReference);
        break;
      default:
        throw new ProviderUnavailableError(`Unexpected provider status: ${result.status}`);
    }

    const saved = await this.#paymentRepository.save(payment);

    // Notify Booking before returning (e.g. FAILED so it can count declined attempts).
    // A notification failure is logged only: it must never change this response.
    await notifyBookingSafely(this.#bookingNotifier, saved, 'CapturePaymentUseCase');

    return saved;
  }
}

module.exports = { CapturePaymentUseCase };
