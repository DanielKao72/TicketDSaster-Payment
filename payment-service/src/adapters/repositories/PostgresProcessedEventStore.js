const { ProcessedEventStore } = require('../../ports/outbound/ProcessedEventStore');

// knex implementation over the `processed_provider_events` table. The primary key on
// `event_id` makes the registration atomic: only the first delivery inserts a row.
class PostgresProcessedEventStore extends ProcessedEventStore {
  #knex;

  constructor(knex) {
    super();
    this.#knex = knex;
  }

  async register(eventId, { type = null } = {}) {
    const inserted = await this.#knex('processed_provider_events')
      .insert({ event_id: eventId, type })
      .onConflict('event_id')
      .ignore()
      .returning('event_id');
    return inserted.length > 0;
  }
}

module.exports = { PostgresProcessedEventStore };
