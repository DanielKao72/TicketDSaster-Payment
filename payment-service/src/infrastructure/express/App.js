const express = require('express');
const healthRoutes = require('./routes/HealthRoutes');
const { errorHandler } = require('./middlewares/ErrorHandler');

// The composition root (src/index.js) passes the adapters here; payment routes will
// receive them as `buildApp({ paymentProvider, ... })` once the use cases exist.
function buildApp() {
  const app = express();

  app.use(express.json());
  app.use(healthRoutes);
  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
