const { BookingNotifier } = require('../../ports/outbound/BookingNotifier');

/**
 * No-op adapter used when BOOKING_NOTIFY_URL is not set (dev, tests).
 * Satisfies the port without sending any HTTP request.
 */
class NoopBookingNotifier extends BookingNotifier {
  async notifyPaymentResult() {
    // Intentionally empty: dev and test environments don't notify Booking.
  }
}

module.exports = { NoopBookingNotifier };
