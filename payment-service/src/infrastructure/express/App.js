const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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
  jwtConfig,
  rateLimitOptions = {},
  processedEventStore,
  webhookAdapter,
} = {}) {
  const app = express();

  app.use(helmet());

  // Only the payment endpoints are rate limited: /health is polled by the orchestrator
  // and provider webhooks must never be dropped. src/index.js passes config.rateLimit.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' },
    },
    ...rateLimitOptions,
  });
  app.use('/payments', limiter);

  // rawBody keeps the exact bytes the provider signed, for webhook signature checks.
  app.use(express.json({ limit: '100kb', verify: (req, res, buf) => (req.rawBody = buf) }));

  app.use(healthRoutes);

  if (paymentRepository) {
    const ports = { paymentRepository, paymentProvider };
    const paymentController = new PaymentController({
      createPayment: new CreatePaymentUseCase(ports),
      getPayment: new GetPaymentUseCase(ports),
      capturePayment: new CapturePaymentUseCase(ports),
      refundPayment: new RefundPaymentUseCase(ports),
    });
    // Pass jwtConfig down to the routes
    app.use(buildPaymentRoutes({ paymentController, idempotencyStore, jwtConfig }));
  }

  if (paymentRepository && processedEventStore && webhookAdapter) {
    const webhookController = new WebhookController({
      handleProviderWebhook: new HandleProviderWebhookUseCase({
        paymentRepository,
        processedEventStore,
      }),
    });
    app.use(buildWebhookRoutes({ webhookController, webhookAdapter }));
  }

  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
