const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CircuitBreakerPaymentProvider,
  CircuitOpenError,
} = require('../../../src/adapters/providers/CircuitBreakerPaymentProvider');
const { ProviderUnavailableError } = require('../../../src/core/domain/DomainErrors');

const success = async () => ({ status: 'AUTHORIZED', providerReference: 'pi_1' });
const outage = async () => {
  throw new ProviderUnavailableError();
};

function build() {
  let time = 0;
  const state = { calls: 0, behavior: success };
  const inner = {
    authorize: async () => {
      state.calls += 1;
      return state.behavior();
    },
    capture: async () => ({}),
    refund: async () => ({}),
    verifyWebhookSignature: () => true,
  };
  const breaker = new CircuitBreakerPaymentProvider({
    provider: inner,
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    now: () => time,
  });
  return { breaker, state, advance: (ms) => (time += ms) };
}

async function failTimes(breaker, n) {
  for (let i = 0; i < n; i += 1) {
    await assert.rejects(() => breaker.authorize({}), ProviderUnavailableError);
  }
}

describe('CircuitBreakerPaymentProvider', () => {
  test('passes results through while closed', async () => {
    const { breaker } = build();
    const result = await breaker.authorize({});
    assert.equal(result.status, 'AUTHORIZED');
    assert.equal(breaker.state, 'CLOSED');
  });

  test('opens after the failure threshold and then fails fast without calling the provider', async () => {
    const { breaker, state } = build();
    state.behavior = outage;
    await failTimes(breaker, 3);

    assert.equal(breaker.state, 'OPEN');
    await assert.rejects(() => breaker.authorize({}), CircuitOpenError);
    assert.equal(state.calls, 3); // the 4th call never reached the provider
  });

  test('a declined payment does not count as an outage', async () => {
    const { breaker, state } = build();
    state.behavior = async () => ({
      status: 'FAILED',
      providerReference: 'pi_x',
      declineReason: 'x',
    });
    for (let i = 0; i < 5; i += 1) await breaker.authorize({});
    assert.equal(breaker.state, 'CLOSED');
  });

  test('a non-outage error does not open the circuit', async () => {
    const { breaker, state } = build();
    state.behavior = async () => {
      throw new Error('bad api key');
    };
    for (let i = 0; i < 5; i += 1) await assert.rejects(() => breaker.authorize({}), /bad api key/);
    assert.equal(breaker.state, 'CLOSED');
  });

  test('a success resets the failure count', async () => {
    const { breaker, state } = build();
    state.behavior = outage;
    await failTimes(breaker, 2);
    state.behavior = success;
    await breaker.authorize({});
    state.behavior = outage;
    await failTimes(breaker, 2);
    assert.equal(breaker.state, 'CLOSED');
  });

  test('after the cool-down, a successful trial call closes the circuit', async () => {
    const { breaker, state, advance } = build();
    state.behavior = outage;
    await failTimes(breaker, 3);

    advance(1000);
    state.behavior = success;
    await breaker.authorize({});

    assert.equal(breaker.state, 'CLOSED');
  });

  test('after the cool-down, a failed trial call reopens the circuit', async () => {
    const { breaker, state, advance } = build();
    state.behavior = outage;
    await failTimes(breaker, 3);

    advance(1000);
    await assert.rejects(() => breaker.authorize({}), ProviderUnavailableError);

    assert.equal(breaker.state, 'OPEN');
    await assert.rejects(() => breaker.authorize({}), CircuitOpenError);
  });

  test('webhook signature verification is never blocked by an open circuit', async () => {
    const { breaker, state } = build();
    state.behavior = outage;
    await failTimes(breaker, 3);
    assert.equal(breaker.verifyWebhookSignature('{}', 'sig'), true);
  });
});
