// Docker entrypoint: on container start, checks whether the CSV is newer
// than the SQLite DB (or the DB doesn't exist yet) and re-ingests if so,
// then starts the server. This makes "edit the CSV, redeploy" the normal
// workflow — no manual ingestion step required after a restart.
//
// - No DB yet (fresh volume)        -> full ingest with --fresh
// - CSV mtime newer than DB mtime   -> upsert ingest (preserves any
//                                      manual edits made directly in the
//                                      DB, unless a row was removed from
//                                      the CSV — see README)
// - CSV not newer than DB           -> skip ingestion, just start serving
//
// Configurable via env var CSV_PATH; defaults to the bundled dataset.

const fs = require("fs");
const path = require("path");
const { ingestCsv, DB_PATH } = require("./src/scripts/csv-to-sqlite");
const { bootstrap } = require("./src/scripts/bootstrap-player-identities");

const CSV_PATH =
  process.env.CSV_PATH || path.join(__dirname, "data", "draft-data.csv");

function getMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function maybeIngest() {
  if (!fs.existsSync(CSV_PATH)) {
    console.log(
      `[entrypoint] No CSV found at ${CSV_PATH} — skipping ingestion, using existing DB if present.`,
    );
    return;
  }

  const dbExists = fs.existsSync(DB_PATH);
  const csvMtime = getMtimeMs(CSV_PATH);
  const dbMtime = getMtimeMs(DB_PATH);

  if (!dbExists) {
    console.log("[entrypoint] No existing DB found — running full ingest.");
    const { imported, totalRows } = ingestCsv(CSV_PATH, { fresh: true });
    console.log(
      `[entrypoint] Ingested ${imported} rows (table has ${totalRows} total).`,
    );
    return;
  }

  if (csvMtime > dbMtime) {
    console.log(
      "[entrypoint] CSV is newer than the DB — re-ingesting (upsert).",
    );
    const { imported, totalRows } = ingestCsv(CSV_PATH, { fresh: false });
    console.log(
      `[entrypoint] Ingested ${imported} rows (table has ${totalRows} total).`,
    );
  } else {
    console.log(
      "[entrypoint] DB is already up to date with the CSV — skipping ingestion.",
    );
  }
}

function maybeBootstrapIdentities() {
  // Additive/idempotent — safe to run on every start. Picks up any newly
  // ingested player names (e.g. a new season) as new pending_lookups rows
  // without touching players already resolved/aliased.
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH);
  const result = bootstrap(db);
  db.close();
  if (result.created > 0) {
    console.log(
      `[entrypoint] Player identities: ${result.created} new name(s) queued ` +
        `(${result.queuedWithTag} with a parseable tag, ${result.queuedWithoutTag} still need one).`,
    );
  }
}

maybeIngest();
maybeBootstrapIdentities();

// Starting the server is just requiring it — server.js calls app.listen()
// as a side effect of being loaded.
require("./server");
