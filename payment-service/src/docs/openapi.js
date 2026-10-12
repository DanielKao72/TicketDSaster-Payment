const path = require('node:path');
const swaggerJsdoc = require('swagger-jsdoc');
const config = require('../config');

function buildOpenApiSpec() {
  return swaggerJsdoc({
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'Ticket D-Saster Payment Service',
        description: 'API to handle payment transactions for ticket purchases.',
        version: config.appVersion,
      },
    },
    // Globs need forward slashes, even on Windows.
    apis: [path.join(__dirname, '../routes/*.js').replaceAll('\\', '/')],
  });
}

module.exports = { buildOpenApiSpec };
