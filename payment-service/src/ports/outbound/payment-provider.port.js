/**
 * Outbound port: the external payment provider (Anti-Corruption Layer).
 * Implemented in src/adapters/providers/, one adapter per provider. Adapters translate
 * the provider's statuses and errors into ProviderResult; nothing provider-specific
 * may cross this boundary.
 *
 * @typedef {'AUTHORIZED' | 'CAPTURED' | 'REFUNDED' | 'FAILED' | 'PENDING'} ProviderResultStatus
 *
 * @typedef {object} ProviderResult
 * @property {ProviderResultStatus} status PENDING means the result arrives later by webhook.
 * @property {string} providerReference The provider's id for the operation.
 * @property {string} [declineReason] Only when status is FAILED.
 *
 * @typedef {object} AuthorizeRequest
 * @property {string} paymentId
 * @property {number} amount Integer in minor units.
 * @property {string} currency ISO 4217 code.
 * @property {string} paymentMethodToken Token from the provider; never raw card data.
 * @property {string} idempotencyKey Reused on every retry of the same request.
 *
 * @typedef {object} CaptureRequest
 * @property {string} paymentId
 * @property {string} providerReference
 * @property {number} amount
 * @property {string} idempotencyKey
 *
 * @typedef {object} RefundRequest
 * @property {string} paymentId
 * @property {string} providerReference
 * @property {number} amount
 * @property {string} idempotencyKey
 *
 * @typedef {object} PaymentProvider
 * @property {(request: AuthorizeRequest) => Promise<ProviderResult>} authorize
 * @property {(request: CaptureRequest) => Promise<ProviderResult>} capture
 * @property {(request: RefundRequest) => Promise<ProviderResult>} refund
 * @property {(rawBody: string | Buffer, signature: string) => boolean} verifyWebhookSignature
 */

module.exports = {};
