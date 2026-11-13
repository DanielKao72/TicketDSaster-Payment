const { NOTIFY_STATUSES } = require('../../ports/outbound/BookingNotifierContract');

/**
 * Notifies Booking of a payment result without ever letting a notification failure
 * change the caller's outcome (the HTTP response or the provider webhook result).
 *
 * Only statuses listed in NOTIFY_STATUSES are sent; the notifier is responsible for
 * the transport and must not throw either, but this guard protects the use cases.
 */
async function notifyBookingSafely(bookingNotifier, payment, context) {
  if (!NOTIFY_STATUSES.includes(payment.status)) return;

  try {
    await bookingNotifier.notifyPaymentResult(payment);
  } catch (err) {
    console.error(`[${context}] BookingNotifier error: ${err?.message ?? err}`);
  }
}

module.exports = { notifyBookingSafely };
