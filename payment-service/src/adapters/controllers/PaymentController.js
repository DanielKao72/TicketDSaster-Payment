// HTTP → use case. The HTTP status of a provider operation comes from the Transaction
// it recorded: SUCCEEDED is a success, PENDING is 202 (result arrives later) and
// FAILED is 422 (the provider declined it).
const STATUS_BY_TRANSACTION = { PENDING: 202, FAILED: 422 };

function toResponse(payment) {
  return {
    id: payment.id,
    sessionId: payment.sessionId,
    userId: payment.userId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    ...(payment.declineReason ? { declineReason: payment.declineReason } : {}),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function statusAfterProviderCall(payment, successStatus) {
  const last = payment.transactions.at(-1);
  return STATUS_BY_TRANSACTION[last?.status] ?? successStatus;
}

class PaymentController {
  #createPayment;
  #getPayment;
  #capturePayment;
  #refundPayment;

  constructor({ createPayment, getPayment, capturePayment, refundPayment }) {
    this.#createPayment = createPayment;
    this.#getPayment = getPayment;
    this.#capturePayment = capturePayment;
    this.#refundPayment = refundPayment;
  }

  create = async (req, res) => {
    const payment = await this.#createPayment.execute({
      ...req.body,
      userId: req.user.id,
      idempotencyKey: req.get('Idempotency-Key'),
    });
    // nextAction only appears with a 202, while the customer still has to act.
    res.status(statusAfterProviderCall(payment, 201)).json({
      ...toResponse(payment),
      ...(payment.nextAction ? { nextAction: payment.nextAction } : {}),
    });
  };

  getById = async (req, res) => {
    const payment = await this.#getPayment.execute({
      userId: req.user.id,
      paymentId: req.params.paymentId,
    });
    res.status(200).json(toResponse(payment));
  };

  getBySession = async (req, res) => {
    const payment = await this.#getPayment.execute({
      userId: req.user.id,
      sessionId: req.query.sessionId,
    });
    res.status(200).json(toResponse(payment));
  };

  capture = async (req, res) => {
    const payment = await this.#capturePayment.execute({
      userId: req.user.id,
      paymentId: req.params.paymentId,
      idempotencyKey: req.get('Idempotency-Key'),
    });
    res.status(statusAfterProviderCall(payment, 200)).json(toResponse(payment));
  };

  refund = async (req, res) => {
    const payment = await this.#refundPayment.execute({
      userId: req.user.id,
      paymentId: req.params.paymentId,
      idempotencyKey: req.get('Idempotency-Key'),
    });
    res.status(statusAfterProviderCall(payment, 200)).json(toResponse(payment));
  };
}

module.exports = { PaymentController, toResponse };
