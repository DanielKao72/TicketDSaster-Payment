const knex = require('knex');

// Builds the knex instance; it does not connect until the first query.
function createKnex(config) {
  return knex({
    client: 'pg',
    connection: config.database.url,
  });
}

module.exports = { createKnex };
