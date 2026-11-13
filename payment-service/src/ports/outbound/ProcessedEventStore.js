const { NotImplementedError, ensurePortImplementation } = require('../Port');

// Outbound port: deduplication of provider webhook events (table
// `processed_provider_events`). Providers retry webhooks, so the same event id may
// arrive more than once and must be processed only once.
class ProcessedEventStore {
  constructor() {
    ensurePortImplementation(this, ProcessedEventStore);
  }

  // Atomically records the event. Resolves to true when this call recorded it (first
  // time it is seen) and false when it had already been processed.
  async register(eventId, { type = null } = {}) {
    throw new NotImplementedError('ProcessedEventStore.register');
  }
}

module.exports = { ProcessedEventStore };
