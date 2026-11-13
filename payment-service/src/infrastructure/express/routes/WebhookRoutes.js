const { Router } = require('express');
const { asyncHandler } = require('../middlewares/AsyncHandler');
const { HttpError } = require('../HttpError');

// The provider calls this route directly: it has no JWT, the signature is its
// authentication. express.json() keeps the raw bytes in req.rawBody for it.
function buildWebhookRoutes({ webhookController, webhookAdapter }) {
  const router = Router();

  /**
   * @openapi
   * /webhooks/payments:
   *   post:
   *     summary: Receive a payment status event from the provider
   *     description: >
   *       Authenticated by the provider signature (`Stripe-Signature`), not by a JWT.
   *       Duplicate and out-of-order events are acknowledged with 200 and ignored.
   *     tags: [Webhooks]
   *     parameters:
   *       - name: Stripe-Signature
   *         in: header
   *         required: true
   *         schema: { type: string, example: 't=1720000000,v1=abcdef' }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [id, type]
   *             properties:
   *               id: { type: string, example: evt_123 }
   *               type: { type: string, example: payment_intent.succeeded }
   *               data:
   *                 type: object
   *                 description: Provider object the event refers to
   *     responses:
   *       200:
   *         description: Event acknowledged (applied, duplicate or ignored)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 received: { type: boolean, example: true }
   *                 outcome: { type: string, enum: [applied, duplicate, ignored] }
   *       400:
   *         description: Invalid signature or malformed payload
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   */
  router.post(
    '/webhooks/payments',
    asyncHandler(async (req, res) => {
      if (!webhookAdapter.verifySignature(req.rawBody, req.get('Stripe-Signature'))) {
        throw new HttpError(
          400,
          'INVALID_WEBHOOK_SIGNATURE',
          'Invalid or expired webhook signature',
        );
      }

      let event;
      try {
        event = webhookAdapter.parseEvent(req.rawBody);
      } catch {
        throw new HttpError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Malformed webhook event');
      }

      const result = await webhookController.receive(event);
      res.status(200).json({ received: true, outcome: result.outcome });
    }),
  );

  return router;
}

module.exports = { buildWebhookRoutes };
