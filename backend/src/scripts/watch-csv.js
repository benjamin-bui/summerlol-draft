// Watches a CSV file and automatically re-ingests it into SQLite whenever
// it changes on disk — no manual command needed after editing the CSV.
//
// Usage:
//   node data/watch-csv.js <path-to-csv>
//
// Example:
//   node data/watch-csv.js data/draft-data.csv
//
// Runs an initial ingest immediately, then watches for further edits.
// Uses upsert (not --fresh) on every change, so it won't wipe rows you
// removed from the sheet on purpose without a --fresh pass first — if you
// deleted rows in the CSV and want that reflected, run the CLI ingestion
// script once with --fresh, then resume watching.

const chokidar = require("chokidar");
const path = require("path");
const { ingestCsv } = require("./csv-to-sqlite");

const csvPath = process.argv[2];

if (!csvPath) {
  console.error("Usage: node data/watch-csv.js <path-to-csv>");
  process.exit(1);
}

const resolvedPath = path.resolve(csvPath);

function runIngest(reason) {
  try {
    const { imported, totalRows } = ingestCsv(resolvedPath, { fresh: false });
    const ts = new Date().toLocaleTimeString();
    console.log(
      `[${ts}] ${reason}: imported ${imported} rows (table has ${totalRows} total)`,
    );
  } catch (err) {
    console.error(`Ingestion failed: ${err.message}`);
  }
}

console.log(`Watching ${resolvedPath} for changes...`);
runIngest("initial load");

const watcher = chokidar.watch(resolvedPath, {
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
});

watcher.on("change", () => runIngest("file changed"));
watcher.on("error", (err) => console.error("Watcher error:", err.message));
