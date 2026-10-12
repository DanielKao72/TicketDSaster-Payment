const config = require('./src/infrastructure/config');

module.exports = {
  client: 'pg',
  connection: config.database.url,
  migrations: {
    directory: './db/migrations',
  },
  seeds: {
    directory: './db/seeds',
  },
};
