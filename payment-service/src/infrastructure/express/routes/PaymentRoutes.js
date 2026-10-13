const { Router } = require('express');
const { z } = require('zod');
const { jwtAuth } = require('../middlewares/JwtAuth');
const { requireRole } = require('../middlewares/RequireRole');
const { validate } = require('../middlewares/Validate');
const { idempotency } = require('../middlewares/Idempotency');
const { asyncHandler } = require('../middlewares/AsyncHandler');

const paymentIdParams = z.object({ paymentId: z.string().uuid() });

// strict(): unknown fields are rejected, so card data can never slip into the body.
const createPaymentBody = z
  .object({
    sessionId: z.string().uuid(),
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code (e.g. MXN)'),
    paymentMethodToken: z.string().min(1).max(255),
  })
  .strict();

const sessionQuery = z.object({ sessionId: z.string().uuid() });

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: JWT issued by the Auth Service, forwarded by the Booking Service.
 *   parameters:
 *     IdempotencyKey:
 *       name: Idempotency-Key
 *       in: header
 *       required: true
 *       description: >
 *         Unique key per operation (up to 255 characters). Retrying with the same key and
 *         body replays the original response (header `Idempotent-Replayed: true`) and never
 *         charges twice; the same key with a different body is a 409.
 *       schema:
 *         type: string
 *     PaymentId:
 *       name: paymentId
 *       in: path
 *       required: true
 *       schema:
 *         type: string
 *         format: uuid
 *   schemas:
 *     Payment:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         sessionId: { type: string, format: uuid }
 *         userId: { type: string, format: uuid }
 *         amount:
 *           type: integer
 *           description: Minor units (cents)
 *           example: 150000
 *         currency: { type: string, example: MXN }
 *         status:
 *           type: string
 *           enum: [PENDING, AUTHORIZED, CAPTURED, FAILED, REFUNDED]
 *         declineReason:
 *           type: string
 *           description: Only when the provider declined the last operation
 *           example: card_declined
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: object
 *           properties:
 *             code: { type: string, example: INVALID_PAYMENT_TRANSITION }
 *             message: { type: string }
 *   responses:
 *     Payment:
 *       description: The payment
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Payment' }
 *     Declined:
 *       description: The provider declined the operation (see `declineReason`)
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Payment' }
 *     Pending:
 *       description: Accepted; the provider will report the result later
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Payment' }
 *     Error:
 *       description: Error
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Error' }
 */
function buildPaymentRoutes({ paymentController, idempotencyStore, jwtSecret }) {
  const router = Router();
  const fanOnly = [jwtAuth(jwtSecret), requireRole('Fan')];
  const once = idempotency(idempotencyStore);

  /**
   * @openapi
   * /payments:
   *   post:
   *     summary: Create a payment for a Session and authorize it with the provider
   *     description: >
   *       Mock provider test tokens for `paymentMethodToken`: `tok_decline` is declined
   *       (422) and `tok_provider_error` simulates a provider outage (502); any other
   *       value is authorized.
   *     tags: [Payments]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - $ref: '#/components/parameters/IdempotencyKey'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             additionalProperties: false
   *             required: [sessionId, amount, currency, paymentMethodToken]
   *             properties:
   *               sessionId: { type: string, format: uuid }
   *               amount: { type: integer, minimum: 1, example: 150000 }
   *               currency: { type: string, example: MXN }
   *               paymentMethodToken: { type: string, example: tok_visa }
   *     responses:
   *       201: { $ref: '#/components/responses/Payment' }
   *       202: { $ref: '#/components/responses/Pending' }
   *       400: { $ref: '#/components/responses/Error' }
   *       401: { $ref: '#/components/responses/Error' }
   *       403: { $ref: '#/components/responses/Error' }
   *       409:
   *         description: The Session already has an active payment, or Idempotency-Key conflict
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   *       422: { $ref: '#/components/responses/Declined' }
   *       502: { $ref: '#/components/responses/Error' }
   *   get:
   *     summary: Get the most recent payment of a Session
   *     tags: [Payments]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - name: sessionId
   *         in: query
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { $ref: '#/components/responses/Payment' }
   *       400: { $ref: '#/components/responses/Error' }
   *       401: { $ref: '#/components/responses/Error' }
   *       403: { $ref: '#/components/responses/Error' }
   *       404: { $ref: '#/components/responses/Error' }
   */
  router.post(
    '/payments',
    ...fanOnly,
    validate({ body: createPaymentBody }),
    once,
    asyncHandler(paymentController.create),
  );
  router.get(
    '/payments',
    ...fanOnly,
    validate({ query: sessionQuery }),
    asyncHandler(paymentController.getBySession),
  );

  /**
   * @openapi
   * /payments/{paymentId}:
   *   get:
   *     summary: Get a payment
   *     tags: [Payments]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - $ref: '#/components/parameters/PaymentId'
   *     responses:
   *       200: { $ref: '#/components/responses/Payment' }
   *       400: { $ref: '#/components/responses/Error' }
   *       401: { $ref: '#/components/responses/Error' }
   *       403: { $ref: '#/components/responses/Error' }
   *       404: { $ref: '#/components/responses/Error' }
   */
  router.get(
    '/payments/:paymentId',
    ...fanOnly,
    validate({ params: paymentIdParams }),
    asyncHandler(paymentController.getById),
  );

  /**
   * @openapi
   * /payments/{paymentId}/capture:
   *   post:
   *     summary: Capture an AUTHORIZED payment
   *     description: Booking calls it once the seats are confirmed.
   *     tags: [Payments]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - $ref: '#/components/parameters/PaymentId'
   *       - $ref: '#/components/parameters/IdempotencyKey'
   *     responses:
   *       200: { $ref: '#/components/responses/Payment' }
   *       202: { $ref: '#/components/responses/Pending' }
   *       400: { $ref: '#/components/responses/Error' }
   *       401: { $ref: '#/components/responses/Error' }
   *       403: { $ref: '#/components/responses/Error' }
   *       404: { $ref: '#/components/responses/Error' }
   *       409:
   *         description: The payment is not AUTHORIZED, or Idempotency-Key conflict
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   *       422: { $ref: '#/components/responses/Declined' }
   *       502: { $ref: '#/components/responses/Error' }
   */
  router.post(
    '/payments/:paymentId/capture',
    ...fanOnly,
    validate({ params: paymentIdParams }),
    once,
    asyncHandler(paymentController.capture),
  );

  /**
   * @openapi
   * /payments/{paymentId}/refund:
   *   post:
   *     summary: Refund the full amount of a CAPTURED payment
   *     tags: [Payments]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - $ref: '#/components/parameters/PaymentId'
   *       - $ref: '#/components/parameters/IdempotencyKey'
   *     responses:
   *       200: { $ref: '#/components/responses/Payment' }
   *       202: { $ref: '#/components/responses/Pending' }
   *       400: { $ref: '#/components/responses/Error' }
   *       401: { $ref: '#/components/responses/Error' }
   *       403: { $ref: '#/components/responses/Error' }
   *       404: { $ref: '#/components/responses/Error' }
   *       409:
   *         description: The payment is not CAPTURED, or Idempotency-Key conflict
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   *       422:
   *         description: The provider declined the refund; the payment stays CAPTURED
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Payment' }
   *       502: { $ref: '#/components/responses/Error' }
   */
  router.post(
    '/payments/:paymentId/refund',
    ...fanOnly,
    validate({ params: paymentIdParams }),
    once,
    asyncHandler(paymentController.refund),
  );

  return router;
}

module.exports = { buildPaymentRoutes };
