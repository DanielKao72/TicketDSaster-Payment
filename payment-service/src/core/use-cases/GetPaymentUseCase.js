const { PaymentNotFoundError, PaymentAccessDeniedError } = require('../domain/DomainErrors');
const { loadOwnedPayment } = require('./LoadOwnedPayment');

// Looks up a payment by its id or by its Session (the most recent one).
class GetPaymentUseCase {
  #paymentRepository;

  constructor({ paymentRepository }) {
    this.#paymentRepository = paymentRepository;
  }

  async execute({ userId, paymentId, sessionId }) {
    if (paymentId) {
      return loadOwnedPayment(this.#paymentRepository, { paymentId, userId });
    }

    const payment = await this.#paymentRepository.findBySessionId(sessionId);
    if (!payment) throw new PaymentNotFoundError();
    if (payment.userId !== userId) throw new PaymentAccessDeniedError();
    return payment;
  }
}

module.exports = { GetPaymentUseCase };
