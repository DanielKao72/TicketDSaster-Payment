// Seeds load dummy data and wipe the tables first, so they must never run in production.
// Every seed calls this before touching the database.
function assertSeedsAllowed(appEnv) {
  if (appEnv === 'production') {
    throw new Error('Seeds never run in production (APP_ENV=production)');
  }
}

module.exports = { assertSeedsAllowed };
