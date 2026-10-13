const { PaymentNotFoundError, PaymentAccessDeniedError } = require('../domain/DomainErrors');

// Loads a payment on behalf of a user: it must exist and belong to that user.
async function loadOwnedPayment(paymentRepository, { paymentId, userId }) {
  const payment = await paymentRepository.findById(paymentId);
  if (!payment) throw new PaymentNotFoundError();
  if (payment.userId !== userId) throw new PaymentAccessDeniedError();
  return payment;
}

module.exports = { loadOwnedPayment };
