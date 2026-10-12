const { test } = require('node:test');
const assert = require('node:assert');
const { PaymentRepository } = require('../../src/ports/outbound/PaymentRepository');
const { PaymentProvider } = require('../../src/ports/outbound/PaymentProvider');
const { IdempotencyStore } = require('../../src/ports/outbound/IdempotencyStore');

const PORTS = [PaymentRepository, PaymentProvider, IdempotencyStore];

test('ports are abstract and cannot be instantiated', () => {
  for (const Port of PORTS) {
    assert.throws(() => new Port(), { name: 'TypeError', message: /is abstract/ });
  }
});

test('an adapter missing port methods fails when it is created', () => {
  class IncompletePaymentRepository extends PaymentRepository {
    async save(payment) {
      return payment;
    }
  }

  assert.throws(() => new IncompletePaymentRepository(), {
    name: 'TypeError',
    message:
      'IncompletePaymentRepository must implement PaymentRepository: findById, findBySessionId',
  });
});

test('a complete adapter can be created and is an instance of its port', () => {
  class InMemoryIdempotencyStore extends IdempotencyStore {
    #records = new Map();

    async find(key) {
      return this.#records.get(key) ?? null;
    }

    async save(record) {
      this.#records.set(record.key, record);
    }
  }

  const store = new InMemoryIdempotencyStore();

  assert.ok(store instanceof IdempotencyStore);
});
