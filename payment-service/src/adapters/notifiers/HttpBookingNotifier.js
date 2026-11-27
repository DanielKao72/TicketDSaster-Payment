const { BookingNotifier } = require('../../ports/outbound/BookingNotifier');
const {
  BOOKING_NOTIFY_PATH,
  BOOKING_NOTIFY_METHOD,
  NOTIFY_STATUSES,
  buildNotifyPayload,
} = require('../../ports/outbound/BookingNotifierContract');

const MAX_RETRIES = 2;

// Delays for each retry attempt (index 0 = first retry, index 1 = second retry).
const RETRY_DELAYS_MS = [500, 1500];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP adapter for the BookingNotifier port.
 *
 * POSTs JSON to BOOKING_NOTIFY_URL with an Authorization header.
 * - Retries up to MAX_RETRIES times on network errors or 5xx; waits RETRY_DELAYS_MS between them.
 * - Does NOT retry on 4xx (client error on our end, retrying won't help).
 * - Swallows the final error and logs it; never throws.
 * - Only notifies when payment.status is in NOTIFY_STATUSES.
 */
class HttpBookingNotifier extends BookingNotifier {
  #notifyUrl;
  #serviceToken;
  #timeoutMs;

  constructor({ notifyUrl, serviceToken = null, timeoutMs = 3000 }) {
    super();
    this.#notifyUrl = notifyUrl;
    this.#serviceToken = serviceToken;
    this.#timeoutMs = timeoutMs;
  }

  async notifyPaymentResult(payment) {
    if (!NOTIFY_STATUSES.includes(payment.status)) return;

    const url = `${this.#notifyUrl}${BOOKING_NOTIFY_PATH}`;
    const payload = buildNotifyPayload(payment);
    const headers = {
      'Content-Type': 'application/json',
      ...(this.#serviceToken ? { Authorization: `Bearer ${this.#serviceToken}` } : {}),
    };

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
        let response;
        try {
          response = await fetch(url, {
            method: BOOKING_NOTIFY_METHOD,
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        // 4xx: do not retry, log and bail out.
        if (response.status >= 400 && response.status < 500) {
          console.error(
            `[BookingNotifier] Booking rejected the notification with ${response.status} ` +
              `for payment ${payment.id}; not retrying.`,
          );
          return;
        }

        // 5xx or other non-2xx: retry.
        if (!response.ok) {
          lastError = new Error(`Booking responded with ${response.status}`);
          continue;
        }

        // Success.
        return;
      } catch (err) {
        // Network error, timeout (AbortError), etc. — retry.
        lastError = err;
      }
    }

    console.error(
      `[BookingNotifier] Failed to notify Booking for payment ${payment.id} ` +
        `after ${MAX_RETRIES + 1} attempt(s): ${lastError?.message ?? lastError}`,
    );
  }
}

module.exports = { HttpBookingNotifier };
