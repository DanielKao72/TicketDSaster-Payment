const config = require('./src/infrastructure/config');
const { buildMigrationKnexConfig } = require('./src/infrastructure/database/Knex');

// Used by the knex CLI (npm run db:migrate | db:rollback | db:seed).
module.exports = {
  ...buildMigrationKnexConfig(config),
  migrations: {
    directory: './db/migrations',
  },
  seeds: {
    directory: './db/seeds',
  },
};
