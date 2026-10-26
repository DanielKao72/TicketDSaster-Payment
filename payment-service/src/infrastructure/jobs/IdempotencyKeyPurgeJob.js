// Periodically deletes the Idempotency Keys past their retention period (RF-22), so the
// `idempotency_keys` table does not grow forever. Every replica may run it: deleting an
// already deleted key is a no-op.
class IdempotencyKeyPurgeJob {
  #idempotencyStore;
  #retentionSeconds;
  #intervalMs;
  #logger;
  #timer = null;
  #running = null;

  constructor({ idempotencyStore, retentionHours, intervalMinutes, logger = console }) {
    this.#idempotencyStore = idempotencyStore;
    this.#retentionSeconds = retentionHours * 3600;
    this.#intervalMs = intervalMinutes * 60 * 1000;
    this.#logger = logger;
  }

  // Runs one purge and resolves to how many keys it deleted. A call while another run
  // is in progress shares that run instead of starting a second one.
  runOnce() {
    if (!this.#running) {
      this.#running = this.#idempotencyStore
        .purgeExpired({ retentionSeconds: this.#retentionSeconds })
        .then((deleted) => {
          if (deleted > 0) this.#logger.info(`Purged ${deleted} expired Idempotency Keys`);
          return deleted;
        })
        .finally(() => {
          this.#running = null;
        });
    }
    return this.#running;
  }

  // Runs a purge now and then every interval. Failures are logged, never thrown, so a
  // database hiccup does not stop the service. The timer does not keep the process alive.
  start() {
    if (this.#timer || this.#intervalMs <= 0) return;

    const run = () =>
      this.runOnce().catch((err) =>
        this.#logger.error('Could not purge expired Idempotency Keys', err),
      );
    this.#timer = setInterval(run, this.#intervalMs);
    this.#timer.unref();
    run();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }
}

module.exports = { IdempotencyKeyPurgeJob };
