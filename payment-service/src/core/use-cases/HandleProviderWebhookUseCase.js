const { PaymentStatus, canTransition } = require('../domain/PaymentStatus');
const { notifyBookingSafely } = require('./NotifyBookingSafely');

// FAILED and REFUNDED are terminal: a late webhook must never move a payment out of them.
const TERMINAL_STATUSES = new Set([PaymentStatus.FAILED, PaymentStatus.REFUNDED]);

/**
 * Applies a provider webhook to the Payment it refers to.
 *
 * - Events are deduplicated by provider event id, so a retried delivery is a no-op.
 * - The payment is resolved through the provider reference recorded in its transactions.
 * - Out-of-order events never roll back a terminal state nor apply an invalid
 *   transition: they are acknowledged (2xx) and ignored.
 * - When the transition is applied and the resulting status is in NOTIFY_STATUSES,
 *   Booking is notified fire-and-forget (a notification failure never causes Stripe to
 *   retry the webhook, which would re-process a deduplicated event and lose the notification).
 */
class HandleProviderWebhookUseCase {
  #paymentRepository;
  #processedEventStore;
  #bookingNotifier;

  constructor({ paymentRepository, processedEventStore, bookingNotifier }) {
    this.#paymentRepository = paymentRepository;
    this.#processedEventStore = processedEventStore;
    this.#bookingNotifier = bookingNotifier;
  }

  async execute({ eventId, type, providerReference, status, declineReason }) {
    const payment = await this.#paymentRepository.findByProviderReference(providerReference);
    if (!payment) return { outcome: 'ignored', reason: 'payment_not_found' };

    const firstDelivery = await this.#processedEventStore.register(eventId, { type });
    if (!firstDelivery) return { outcome: 'duplicate' };

    if (TERMINAL_STATUSES.has(payment.status)) {
      return { outcome: 'ignored', reason: 'terminal_status' };
    }
    if (!status || payment.status === status) {
      return { outcome: 'ignored', reason: 'no_transition' };
    }
    if (!canTransition(payment.status, status)) {
      return { outcome: 'ignored', reason: 'invalid_transition' };
    }

    switch (status) {
      case PaymentStatus.AUTHORIZED:
        payment.authorize(providerReference);
        break;
      case PaymentStatus.CAPTURED:
        payment.capture(providerReference);
        break;
      case PaymentStatus.FAILED:
        payment.fail(declineReason, providerReference);
        break;
      case PaymentStatus.REFUNDED:
        payment.refund(providerReference);
        break;
      default:
        return { outcome: 'ignored', reason: 'unsupported_status' };
    }

    const saved = await this.#paymentRepository.save(payment);

    // Notify Booking only when the transition was actually applied and the new status
    // is in NOTIFY_STATUSES. Never notify for duplicates or ignored events.
    // Deliberately not awaited: the Stripe webhook must answer fast, and a notification
    // failure must never make Stripe retry an event that dedupe would then ignore.
    notifyBookingSafely(this.#bookingNotifier, saved, 'HandleProviderWebhookUseCase');

    return { outcome: 'applied', payment: saved };
  }
}

module.exports = { HandleProviderWebhookUseCase, TERMINAL_STATUSES };
