const fs = require('node:fs');
const path = require('node:path');
const { buildOpenApiSpec } = require('../src/infrastructure/express/OpenApi');

const outputFile = path.resolve(process.argv[2] || 'openapi.json');

fs.writeFileSync(outputFile, `${JSON.stringify(buildOpenApiSpec(), null, 2)}\n`);
console.log(`OpenAPI definition written to ${outputFile}`);
