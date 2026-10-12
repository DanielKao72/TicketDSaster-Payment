const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../src/infrastructure/express/App');

let server;
let baseUrl;

before(() => {
  server = buildApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
});

test('GET /health responds 200 with { status: "ok" }', async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(await response.json(), { status: 'ok' });
});
