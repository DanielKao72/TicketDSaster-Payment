# Operations Runbook — Payment Service

Short, actionable playbooks for the incidents that need a human. Every reference below
is a **provider reference** stored in `transactions.provider_reference` (for Stripe, the
PaymentIntent or Charge id such as `pi_...` or `ch_...`).

Start by finding the payment in the Payment Store:

```sql
SELECT p.id, p.status, p.decline_reason, p.updated_at, t.type, t.status, t.provider_reference
FROM payments p
JOIN transactions t ON t.payment_id = p.id
WHERE p.id = '<paymentId>'
ORDER BY t.created_at;
```

## 1. PENDING payments that are too old

**Symptom:** a payment stays `PENDING` after the provider already decided.

1. Copy its `provider_reference` and open it in the Stripe Dashboard (`Payments` →
   search the `pi_...`).
2. If Stripe shows `succeeded` / `canceled` / a decline, open **Developers → Events**,
   find the matching `payment_intent.*` event and use **Resend**. The webhook is
   idempotent: a duplicate delivery is acknowledged and ignored.
3. If there is no event in Stripe either, the intent never completed: cancel it in the
   dashboard and let Booking create a new payment for the Session.

Do **not** update `payments.status` by hand while the intent is still open: the next
webhook would then be an invalid transition.

## 2. AUTHORIZED payments without capture

**Symptom:** `status = AUTHORIZED` and `updated_at` older than the agreed capture window.

```sql
SELECT p.id, p.session_id, p.updated_at, t.provider_reference
FROM payments p
JOIN transactions t ON t.payment_id = p.id AND t.type = 'CHARGE'
WHERE p.status = 'AUTHORIZED'
ORDER BY p.updated_at;
```

1. If Booking confirmed the seats, capture with
   `POST /payments/{paymentId}/capture` (requires an `Idempotency-Key`).
2. If Booking did not confirm, let the authorization expire at the provider and do not
   capture. Stripe releases the hold automatically; the payment stays `AUTHORIZED` in
   this service until a `payment_intent.canceled` webhook marks it `FAILED`.
3. Never capture from the Stripe Dashboard without recording it here: the service would
   not know the money moved.

## 3. Stripe outage or degradation

1. Confirm at <https://status.stripe.com>. The provider adapter already retries with
   backoff and maps timeouts to **502**; Booking sees the 502 and owns the user-facing
   message.
2. No payment is persisted when authorization fails with a provider error, so the retry
   is clean and reuses the same idempotency key (no double charge).
3. If the outage is long, pause Booking's purchase flow rather than retrying from here.
   Re-drive stuck payments with the PENDING playbook once Stripe is healthy.

## 4. Stuck Idempotency Keys

**Symptom:** `409 IDEMPOTENCY_IN_PROGRESS` for a key whose first request never finished
(process crash or deploy mid-request).

```sql
SELECT key, request_hash, payment_id, response_status, created_at
FROM idempotency_keys
WHERE response_status IS NULL
ORDER BY created_at;
```

1. First confirm in the provider dashboard that the charge for `payment_id` did not
   happen (or already happened and is recorded). The key only blocks the retry.
2. Delete the stale row only after that check: `DELETE FROM idempotency_keys WHERE key = '<key>';`
3. The client retries with the same `Idempotency-Key`; the provider idempotency key makes
   the retry safe.

Rows with a `response_status` are completed and can stay; they are what makes retries
replay the original response.

## 5. Webhooks rejected (400)

- `INVALID_WEBHOOK_SIGNATURE`: the endpoint secret does not match
  `PAYMENT_PROVIDER_WEBHOOK_SECRET`, or the request sat longer than 5 minutes. Compare
  the signing secret in **Developers → Webhooks** with the deployment's env var, then
  resend the event from the dashboard.
- `INVALID_WEBHOOK_PAYLOAD`: the body is not a Stripe event. Check that no proxy is
  rewriting it; the signature is computed over the exact raw bytes.
