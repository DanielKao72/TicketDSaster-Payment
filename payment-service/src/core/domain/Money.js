const { InvalidMoneyError } = require('./DomainErrors');

const CURRENCY_CODE = /^[A-Z]{3}$/;

// Amounts are integers in the currency's minor unit (e.g. cents), never floats.
function createMoney(amount, currency) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new InvalidMoneyError('amount must be a positive integer in minor units');
  }
  if (typeof currency !== 'string' || !CURRENCY_CODE.test(currency)) {
    throw new InvalidMoneyError('currency must be an ISO 4217 code (e.g. MXN)');
  }
  return Object.freeze({ amount, currency });
}

module.exports = { createMoney };
