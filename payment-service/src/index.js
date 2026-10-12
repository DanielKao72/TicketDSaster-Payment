// Composition root: the only place that wires adapters into the app and starts the server.
const config = require('./infrastructure/config');
const { buildApp } = require('./infrastructure/express/app');
const { FakePaymentProvider } = require('./adapters/providers/fake-payment-provider');

const paymentProvider = new FakePaymentProvider();
const app = buildApp({ paymentProvider });

app.listen(config.port, () => {
  console.log(`Payment Service listening on port ${config.port}`);
});
