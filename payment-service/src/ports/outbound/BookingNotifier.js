const { NotImplementedError, ensurePortImplementation } = require('../Port');

// Outbound port: notifies Booking Service of payment results that require its attention.
// Adapters live in src/adapters/notifiers/ and extend this class.
//
// PROVISIONAL: pendiente de confirmar con Booking (reunión 7 nov).
// Lo que se notifica y el contrato exacto están centralizados en
// src/ports/outbound/BookingNotifierContract.js.
class BookingNotifier {
  constructor() {
    ensurePortImplementation(this, BookingNotifier);
  }

  // Sends the final result of a payment to the Booking Service.
  // payment is the Payment aggregate. Must never throw: a failed notification
  // must only be logged, never propagated to the caller.
  async notifyPaymentResult(payment) {
    throw new NotImplementedError('BookingNotifier.notifyPaymentResult');
  }
}

module.exports = { BookingNotifier };
