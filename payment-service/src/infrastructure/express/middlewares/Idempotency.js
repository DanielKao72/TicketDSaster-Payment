const crypto = require('node:crypto');
const { HttpError } = require('../HttpError');

// Same JSON for the same data, whatever the key order the client used.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// The user is part of the hash, so another user's key never replays someone else's payment.
function hashRequest(req) {
  const fingerprint = canonicalJson({
    method: req.method,
    path: req.originalUrl.split('?')[0],
    userId: req.user?.id ?? null,
    body: req.body ?? null,
  });
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}

// Whole seconds (at least 1) until the lease expires, or null without a lease.
function secondsUntil(leaseExpiresAt) {
  if (!leaseExpiresAt) return null;
  const ms = new Date(leaseExpiresAt).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Requires an Idempotency-Key header on POSTs that create payments or refunds.
 *
 * - New key: it is claimed, the request runs, and its response is stored (4xx included,
 *   so a retry gets the same answer). On a 5xx the key is released so a retry runs again.
 * - Same key and same request: the stored response is replayed and nothing runs.
 * - Same key, different request: 409 IDEMPOTENCY_KEY_MISMATCH.
 * - Same key while the first request is still running: 409 IDEMPOTENCY_IN_PROGRESS, with a
 *   Retry-After header until its lease expires.
 * - Same key and same request after the first one was abandoned (its process died before
 *   storing a response and the lease expired): the key is claimed again and the request runs.
 *
 * Each claim gets its own lease token, so a request that outlived its lease cannot store
 * or release the response of the request that claimed the key after it.
 */
function idempotency(idempotencyStore) {
  return async (req, res, next) => {
    try {
      const key = req.get('Idempotency-Key');
      if (!key || key.length > 255) {
        throw new HttpError(
          400,
          'IDEMPOTENCY_KEY_REQUIRED',
          'An Idempotency-Key header (up to 255 characters) is required',
        );
      }

      const requestHash = hashRequest(req);
      const leaseToken = crypto.randomUUID();
      const existing = await idempotencyStore.claim({ key, requestHash, leaseToken });

      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new HttpError(
            409,
            'IDEMPOTENCY_KEY_MISMATCH',
            'This Idempotency-Key was used with a different request',
          );
        }
        if (existing.responseStatus === null || existing.responseStatus === undefined) {
          const retryAfter = secondsUntil(existing.leaseExpiresAt);
          if (retryAfter !== null) res.set('Retry-After', String(retryAfter));
          throw new HttpError(
            409,
            'IDEMPOTENCY_IN_PROGRESS',
            'A request with this Idempotency-Key is still being processed',
          );
        }
        res.set('Idempotent-Replayed', 'true');
        res.status(existing.responseStatus).json(existing.responseBody);
        return;
      }

      // Store the outcome before the response leaves, so a retry that arrives right
      // after it already finds it.
      const sendJson = res.json.bind(res);
      res.json = (body) => {
        const status = res.statusCode;
        const settled =
          status >= 500
            ? idempotencyStore.release(key, leaseToken)
            : idempotencyStore.complete(key, leaseToken, {
                paymentId: body?.id ?? null,
                responseStatus: status,
                responseBody: body,
              });
        settled
          .then((applied) => {
            if (!applied) {
              console.warn(
                'The Idempotency-Key lease expired before the response was stored; it was not stored',
              );
            }
          })
          .catch((err) => console.error('Could not store the idempotent response', err))
          .finally(() => sendJson(body));
        return res;
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { idempotency, hashRequest };
