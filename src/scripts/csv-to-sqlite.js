// Ingests a CSV file into a SQLite database. Can be run standalone from
// the CLI, or imported as a module (see ingestCsv export) — the watcher
// script (watch-csv.js) uses the same function so both paths share one
// implementation.
//
// CLI usage:
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

// Quote every identifier with double quotes — this is what lets column
// names like "group" (reserved) or "Pick Value" (has a space) work.
const q = (id) => `"${id}"`;

function ingestCsv(csvPath, { fresh = false } = {}) {
  const csvRaw = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(csvRaw, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  if (records.length === 0) {
    throw new Error('No rows found in CSV.');
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const columns = Object.keys(records[0]);

  if (fresh) {
    db.exec(`DROP TABLE IF EXISTS ${q(TABLE)}`);
  }

  const hasIdCol = columns.includes('id');
  const colDefs = columns
    .map((c) => (c === 'id' ? `${q(c)} INTEGER PRIMARY KEY` : `${q(c)} TEXT`))
    .join(', ');

  db.exec(`CREATE TABLE IF NOT EXISTS ${q(TABLE)} (${colDefs})`);

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

  // Empty cells become real SQL NULL (not '') — CAST('' AS REAL) silently
  // returns 0 in SQLite, which would corrupt averages for any column with
  // intentionally-blank values (e.g. a season missing derived stats).
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const values = columns.map((c) => (row[c] === '' ? null : row[c]));
      insert.run(values);
    }
  });

  insertMany(records);

  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${q(TABLE)}`).get().n;
  db.close();

  return { imported: records.length, totalRows: count };
}

if (require.main === module) {
  const csvPath = process.argv[2];
  const fresh = process.argv.includes('--fresh');

  if (!csvPath) {
    console.error('Usage: node data/csv-to-sqlite.js <path-to-csv> [--fresh]');
    process.exit(1);
  }

  try {
    const { imported, totalRows } = ingestCsv(csvPath, { fresh });
    console.log(`Imported ${imported} rows. Table "rows" now has ${totalRows} rows total.`);
    console.log(`Database file: ${DB_PATH}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { ingestCsv, DB_PATH, TABLE };
