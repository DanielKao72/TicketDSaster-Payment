// Runs the Idempotency Key purge once against the Payment Store and exits, for an
// external scheduler (cron, Kubernetes CronJob). Usage: npm run idempotency:purge
// Needs DATABASE_URL; the retention comes from IDEMPOTENCY_RETENTION_HOURS.
const config = require('../src/infrastructure/config');
const { createKnex } = require('../src/infrastructure/database/Knex');
const {
  PostgresIdempotencyStore,
} = require('../src/adapters/repositories/PostgresIdempotencyStore');
const { IdempotencyKeyPurgeJob } = require('../src/infrastructure/jobs/IdempotencyKeyPurgeJob');

async function main() {
  if (!config.database.url) {
    throw new Error('DATABASE_URL is required to purge the Idempotency Keys');
  }

  const knex = createKnex(config);
  try {
    const job = new IdempotencyKeyPurgeJob({
      idempotencyStore: new PostgresIdempotencyStore(knex),
      retentionHours: config.idempotency.retentionHours,
      intervalMinutes: 0,
      // The summary below is printed even when nothing was deleted.
      logger: { info() {}, error: console.error },
    });
    const deleted = await job.runOnce();
    console.log(
      `Deleted ${deleted} Idempotency Keys older than ${config.idempotency.retentionHours} h`,
    );
  } finally {
    await knex.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
