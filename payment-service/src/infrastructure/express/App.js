const express = require('express');
const healthRoutes = require('./routes/HealthRoutes');
const { buildPaymentRoutes } = require('./routes/PaymentRoutes');
const { buildWebhookRoutes } = require('./routes/WebhookRoutes');
const { errorHandler } = require('./middlewares/ErrorHandler');
const { PaymentController } = require('../../adapters/controllers/PaymentController');
const { WebhookController } = require('../../adapters/controllers/WebhookController');
const { CreatePaymentUseCase } = require('../../core/use-cases/CreatePaymentUseCase');
const { GetPaymentUseCase } = require('../../core/use-cases/GetPaymentUseCase');
const { CapturePaymentUseCase } = require('../../core/use-cases/CapturePaymentUseCase');
const { RefundPaymentUseCase } = require('../../core/use-cases/RefundPaymentUseCase');
const {
  HandleProviderWebhookUseCase,
} = require('../../core/use-cases/HandleProviderWebhookUseCase');

// The composition root (src/index.js) passes the adapters here. Without them (e.g. in
// the health test) only /health is mounted.
function buildApp({
  paymentRepository,
  paymentProvider,
  idempotencyStore,
  jwtSecret,
  webhookAdapter,
} = {}) {
  const app = express();

  app.use(express.json({ verify: (req, res, buf) => (req.rawBody = buf) }));
  app.use(healthRoutes);

  if (paymentRepository) {
    const ports = { paymentRepository, paymentProvider };
    const paymentController = new PaymentController({
      createPayment: new CreatePaymentUseCase(ports),
      getPayment: new GetPaymentUseCase(ports),
      capturePayment: new CapturePaymentUseCase(ports),
      refundPayment: new RefundPaymentUseCase(ports),
    });
    app.use(buildPaymentRoutes({ paymentController, idempotencyStore, jwtSecret }));
  }

  if (paymentRepository && webhookAdapter) {
    const webhookController = new WebhookController({
      handleProviderWebhook: new HandleProviderWebhookUseCase({ paymentRepository }),
    });
    app.use(buildWebhookRoutes({ webhookController, webhookAdapter }));
  }

  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
