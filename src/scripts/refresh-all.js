/**
 * Convenience wrapper for the full "I edited the CSV" workflow:
 *   1. Re-ingest the CSV (upsert — picks up any changed/added rows)
 *   2. Re-bootstrap identities (queues any new/changed Player names)
 *   3. Run the Riot sync (resolves newly-queued names, refreshes known ones)
 *
 * Equivalent to running, in order:
 *   node data/csv-to-sqlite.js data/draft-data.csv
 *   node data/bootstrap-player-identities.js
 *   node data/run-riot-sync.js
 *
 * Usage:
 *   RIOT_API_KEY=your-key node data/refresh-all.js [path-to-csv]
 */

const path = require("path");
const Database = require("better-sqlite3");
const { ingestCsv, DB_PATH } = require("./csv-to-sqlite");
const { ingestMatchDetails } = require("./ingest-match-details");
const { bootstrap } = require("./bootstrap-player-identities");
const { runFullSync } = require("../lib/riot-sync");

const csvPath =
  process.argv[2] || path.join(__dirname, "..", "..", "data", "draft-data.csv");
const detailsPath = process.env.MATCH_DETAILS_PATH;

(async () => {
  console.log(`Step 1/3: ingesting ${csvPath}...`);
  const { imported, totalRows } = ingestCsv(csvPath, { fresh: false });
  console.log(`  imported ${imported} rows (table has ${totalRows} total)`);
  if (detailsPath) {
    console.log(`  ingesting match details from ${detailsPath}...`);
    console.log(
      `  loaded ${ingestMatchDetails(detailsPath)} match detail rows`,
    );
  }

  console.log("Step 2/3: bootstrapping player identities...");
  const db = new Database(DB_PATH);
  const bootResult = bootstrap(db);
  console.log(
    `  ${bootResult.created} new name(s) queued ` +
      `(${bootResult.queuedWithTag} with a parseable tag, ${bootResult.queuedWithoutTag} still need one)`,
  );

  if (!process.env.RIOT_API_KEY) {
    db.close();
    console.log(
      "\nStep 3/3: SKIPPED — RIOT_API_KEY is not set, so nothing was actually resolved against Riot.",
    );
    console.log("Set RIOT_API_KEY and re-run to complete the sync.");
    return;
  }

  console.log("Step 3/3: running Riot sync...");
  const syncResult = await runFullSync(db);
  db.close();
  console.log(
    `  resolved: ${syncResult.pending.resolved}, failed: ${syncResult.pending.failed}`,
  );
  console.log(
    `  renamed (refresh pass): ${syncResult.refresh.updated}, unchanged: ${syncResult.refresh.unchanged}`,
  );
})();
