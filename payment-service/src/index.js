// Composition root: the only place that wires adapters into the app and starts the server.
const config = require('./infrastructure/config');
const { buildApp } = require('./infrastructure/express/App');
const { FakePaymentProvider } = require('./adapters/providers/FakePaymentProvider');

const paymentProvider = new FakePaymentProvider();
const app = buildApp({ paymentProvider });

app.listen(config.port, () => {
  console.log(`Payment Service listening on port ${config.port}`);
});
