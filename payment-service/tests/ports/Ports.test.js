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

test('an IdempotencyStore without purgeExpired fails when it is created', () => {
  class NoPurgeIdempotencyStore extends IdempotencyStore {
    async claim() {
      return null;
    }

    async complete() {
      return true;
    }

    async release() {
      return true;
    }
  }

  assert.throws(() => new NoPurgeIdempotencyStore(), {
    name: 'TypeError',
    message: 'NoPurgeIdempotencyStore must implement IdempotencyStore: purgeExpired',
  });
});

test('a complete adapter can be created and is an instance of its port', () => {
  class MapIdempotencyStore extends IdempotencyStore {
    #records = new Map();

    async claim({ key, requestHash, leaseToken }) {
      if (this.#records.has(key)) return this.#records.get(key);
      this.#records.set(key, { key, requestHash, leaseToken });
      return null;
    }

    async complete(key, leaseToken, response) {
      Object.assign(this.#records.get(key), response);
      return true;
    }

    async release(key) {
      return this.#records.delete(key);
    }

    async purgeExpired() {
      return 0;
    }
  }

  const store = new MapIdempotencyStore();

  assert.ok(store instanceof IdempotencyStore);
});
