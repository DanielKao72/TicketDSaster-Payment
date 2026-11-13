const { test } = require('node:test');
const assert = require('node:assert');
const { errorHandler } = require('../../../src/infrastructure/express/middlewares/ErrorHandler');

function mockResponse() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

test('errorHandler: 500 sanitizes log output to comply with PCI DSS (only message, name, stack)', () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (arg) => {
    logged.push(arg);
  };

  try {
    const errorWithSensitiveData = new Error('Database connection explosion');
    errorWithSensitiveData.pan = '4111222233334444';
    errorWithSensitiveData.cvv = '123';
    errorWithSensitiveData.paymentMethodToken = 'tok_secret_card_token';
    errorWithSensitiveData.requestBody = { cardNumber: '4111222233334444' };

    const req = { body: { cardNumber: '4111222233334444' } };
    const res = mockResponse();

    errorHandler(errorWithSensitiveData, req, res, () => {});

    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.body, {
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });

    assert.strictEqual(logged.length, 1);
    const loggedEntry = logged[0];

    // Verify only safe error properties are logged
    assert.deepStrictEqual(Object.keys(loggedEntry).sort(), ['message', 'name', 'stack']);
    assert.strictEqual(loggedEntry.message, 'Database connection explosion');
    assert.strictEqual(loggedEntry.name, 'Error');
    assert.strictEqual(typeof loggedEntry.stack, 'string');
    assert.strictEqual(loggedEntry.pan, undefined);
    assert.strictEqual(loggedEntry.cvv, undefined);
    assert.strictEqual(loggedEntry.paymentMethodToken, undefined);
  } finally {
    console.error = originalConsoleError;
  }
});
