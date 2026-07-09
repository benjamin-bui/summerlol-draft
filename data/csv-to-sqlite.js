// Ingests a CSV file into a SQLite database.
//
// Usage:
//   node data/csv-to-sqlite.js <path-to-csv> [--fresh]
//
//   --fresh   drop and recreate the table before importing
//             (omit this if you want to re-run without wiping edits —
//             see the upsert behavior below)
//
// Example:
//   node data/csv-to-sqlite.js data/sample-data.csv --fresh

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'app.db');
const TABLE = 'rows';

const csvPath = process.argv[2];
const fresh = process.argv.includes('--fresh');

if (!csvPath) {
  console.error('Usage: node data/csv-to-sqlite.js <path-to-csv> [--fresh]');
  process.exit(1);
}

const csvRaw = fs.readFileSync(csvPath, 'utf-8');
const records = parse(csvRaw, {
  columns: true,       // use header row as keys
  skip_empty_lines: true,
  trim: true
});

if (records.length === 0) {
  console.error('No rows found in CSV.');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const columns = Object.keys(records[0]);

if (fresh) {
  db.exec(`DROP TABLE IF EXISTS ${TABLE}`);
}

// Create the table if it doesn't exist yet. `id` is treated as the primary
// key if present in the CSV, otherwise SQLite adds its own rowid.
// Quote every identifier with double quotes — this is what lets column
// names like "group" (a reserved SQL keyword) work without breaking.
const q = (id) => `"${id}"`;

const hasIdCol = columns.includes('id');
const colDefs = columns
  .map((c) => (c === 'id' ? `${q(c)} INTEGER PRIMARY KEY` : `${q(c)} TEXT`))
  .join(', ');

db.exec(`CREATE TABLE IF NOT EXISTS ${q(TABLE)} (${colDefs})`);

// Numeric-looking columns are stored as TEXT above to keep this generic
// (CSV gives you strings), but SQLite is dynamically typed per-value, so
// storing "49.96" as TEXT still sorts/computes correctly once cast with
// CAST(value AS REAL) in queries — see server.js.

const placeholders = columns.map(() => '?').join(', ');
const upsertCols = columns
  .filter((c) => c !== 'id')
  .map((c) => `${q(c)}=excluded.${q(c)}`)
  .join(', ');

const insert = hasIdCol
  ? db.prepare(
      `INSERT INTO ${q(TABLE)} (${columns.map(q).join(', ')}) VALUES (${placeholders})
       ON CONFLICT("id") DO UPDATE SET ${upsertCols}`
    )
  : db.prepare(`INSERT INTO ${q(TABLE)} (${columns.map(q).join(', ')}) VALUES (${placeholders})`);

// Positional params: pull values out in column order for each row, since
// column names (e.g. "Pick Order") aren't valid @named-param identifiers.
const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(columns.map((c) => row[c]));
});

insertMany(records);

const count = db.prepare(`SELECT COUNT(*) AS n FROM ${q(TABLE)}`).get().n;
console.log(`Imported ${records.length} rows. Table "${TABLE}" now has ${count} rows total.`);
console.log(`Database file: ${DB_PATH}`);

db.close();
