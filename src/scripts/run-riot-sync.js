/**
 * CLI entrypoint: runs the full Riot sync (resolve pending lookups, then
 * refresh already-known players to catch renames) against the real Riot
 * API. Requires RIOT_API_KEY in the environment.
 *
 * Usage:
 *   RIOT_API_KEY=RGAPI-xxxx node data/run-riot-sync.js
 */

const path = require('path');
const Database = require('better-sqlite3');
const { runFullSync } = require('./riot-sync');

const DB_PATH = path.join(__dirname, 'app.db');

(async () => {
  if (!process.env.RIOT_API_KEY) {
    console.error('RIOT_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  console.log('Running Riot sync...');
  const result = await runFullSync(db);
  db.close();

  console.log('\nPending lookups pass:');
  console.log(`  resolved: ${result.pending.resolved}`);
  console.log(`  failed:   ${result.pending.failed}`);
  console.log(`  attempted: ${result.pending.attempted}`);

  console.log('\nRefresh-known pass:');
  console.log(`  updated (renamed):   ${result.refresh.updated}`);
  console.log(`  unchanged:           ${result.refresh.unchanged}`);
  console.log(`  failed:              ${result.refresh.failed}`);
})();
