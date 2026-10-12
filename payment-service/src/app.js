const express = require('express');
const config = require('./config');
const healthRoutes = require('./routes/health.routes');

const app = express();

app.use(express.json());
app.use(healthRoutes);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Payment Service listening on port ${config.port}`);
  });
}

module.exports = app;
