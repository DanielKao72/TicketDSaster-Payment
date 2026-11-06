const { version } = require('../../../package.json');

// Deployment environment. It decides the database defaults and whether seeds may run
// (never in production). The Docker image defaults to production.
const APP_ENVS = ['development', 'test', 'production'];
const appEnv = process.env.APP_ENV || 'development';
if (!APP_ENVS.includes(appEnv)) {
  throw new Error(`APP_ENV must be one of ${APP_ENVS.join(', ')}, got '${appEnv}'`);
}

const config = {
  appEnv,
  port: Number(process.env.PORT) || 3000,
  appVersion: process.env.APP_VERSION || version,
  database: {
    url: process.env.DATABASE_URL,
  },
  // 'postgres' uses the Payment Store; 'memory' runs without a database (data is lost on restart).
  paymentStore: process.env.PAYMENT_STORE || 'memory',
  jwt: {
    // Shared HS256 secret with the Auth Service, which issues the tokens.
    secret: process.env.JWT_SECRET,
  },
};

module.exports = config;
