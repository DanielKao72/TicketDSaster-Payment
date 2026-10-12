const { NotImplementedError, ensurePortImplementation } = require('../port');

// Outbound port: the external payment provider (Anti-Corruption Layer).
// Adapters live in src/adapters/providers/, one per provider, and extend this class.
// They translate the provider's statuses and errors into a ProviderResult; nothing
// provider-specific may cross this boundary.
//
// ProviderResult: { status, providerReference, declineReason? }
//   status: 'AUTHORIZED' | 'CAPTURED' | 'REFUNDED' | 'FAILED' | 'PENDING'
//           (PENDING means the result arrives later by webhook)
//   declineReason: only when status is FAILED
//
// Amounts are integers in minor units. The idempotencyKey is reused on every retry of
// the same request. paymentMethodToken comes from the provider; never raw card data.
class PaymentProvider {
  constructor() {
    ensurePortImplementation(this, PaymentProvider);
  }

  // ({ paymentId, amount, currency, paymentMethodToken, idempotencyKey }) => ProviderResult
  async authorize(request) {
    throw new NotImplementedError('PaymentProvider.authorize');
  }

  // ({ paymentId, providerReference, amount, idempotencyKey }) => ProviderResult
  async capture(request) {
    throw new NotImplementedError('PaymentProvider.capture');
  }

  // ({ paymentId, providerReference, amount, idempotencyKey }) => ProviderResult
  async refund(request) {
    throw new NotImplementedError('PaymentProvider.refund');
  }

  // (rawBody: string | Buffer, signature: string) => boolean
  verifyWebhookSignature(rawBody, signature) {
    throw new NotImplementedError('PaymentProvider.verifyWebhookSignature');
  }
}

module.exports = { PaymentProvider };
