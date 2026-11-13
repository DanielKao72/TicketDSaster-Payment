const { NotImplementedError, ensurePortImplementation } = require('../Port');

// Outbound port: translates a provider webhook into the domain's vocabulary.
// Adapters live in src/adapters/providers/, one per provider, and extend this class.
// Nothing provider-specific (header format, event names, payload shape) may cross
// this boundary.
//
// WebhookEvent: { eventId, type, providerReference, status, declineReason? }
//   status: 'AUTHORIZED' | 'CAPTURED' | 'REFUNDED' | 'FAILED' | null
//           (null means the event does not change a payment; it is still deduplicated)
class WebhookAdapter {
  constructor() {
    ensurePortImplementation(this, WebhookAdapter);
  }

  // (rawBody: string | Buffer, signature: string) => boolean
  // Verifies the provider's signature over the raw request body.
  verifySignature(rawBody, signature) {
    throw new NotImplementedError('WebhookAdapter.verifySignature');
  }

  // (rawBody: string | Buffer) => WebhookEvent
  parseEvent(rawBody) {
    throw new NotImplementedError('WebhookAdapter.parseEvent');
  }
}

module.exports = { WebhookAdapter };
