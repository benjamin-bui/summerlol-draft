// Runs an initial ingest immediately, then watches for further edits.
// Every ingest (with or without --fresh) now syncs deletions too: any row
// whose id no longer appears in the CSV is removed from the DB, not just
// upserted. --fresh instead does a full drop+recreate, which is only
// needed if the CSV's column list itself has changed.
// CLI usage:
//   node data/csv-to-sqlite.js <path-to-csv> [--fresh]
//
//   --fresh   drop and recreate the table before importing
//             (omit this if you want to re-run without wiping edits —
//             see the upsert behavior below)
//
// Example:
//   node src/scripts/csv-to-sqlite.js data/sample-data.csv --fresh

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'app.db');
const TABLE = 'rows';

// Quote every identifier with double quotes — this is what lets column
// names like "group" (reserved) or "Pick Value" (has a space) work.
const q = (id) => `"${id}"`;

function ingestCsv(csvPath, { fresh = false } = {}) {
  const csvRaw = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(csvRaw, { columns: true, skip_empty_lines: true, trim: true });

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

  // Sync, not just upsert: any DB row whose id is no longer present in
  // the CSV gets deleted. Without this, removing/replacing a row in the
  // spreadsheet (e.g. correcting a mislabeled draft pick) never actually
  // removes the stale row from the DB -- it just accumulates forever,
  // which is exactly the bug that motivated this change.
  const syncDeletes = db.transaction((incomingIds) => {
    if (!hasIdCol) return 0; // no stable key to diff against -- see note below
    const existingIds = db.prepare(`SELECT id FROM ${q(TABLE)}`).all().map((r) => Number(r.id));
    const incoming = new Set(incomingIds.map(Number));
    const staleIds = existingIds.filter((id) => !incoming.has(id));
    if (staleIds.length === 0) return 0;
    const del = db.prepare(`DELETE FROM ${q(TABLE)} WHERE id = ?`);
    for (const id of staleIds) del.run(id);
    return staleIds.length;
  });

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const values = columns.map((c) => (row[c] === '' ? null : row[c]));
      insert.run(values);
    }
  });

  insertMany(records);
  const deletedCount = hasIdCol ? syncDeletes(records.map((r) => r.id)) : 0;

  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${q(TABLE)}`).get().n;
  db.close();

  return { imported: records.length, deleted: deletedCount, totalRows: count };
}

if (require.main === module) {
  const csvPath = process.argv[2];
  const fresh = process.argv.includes('--fresh');
  if (!csvPath) {
    console.error('Usage: node data/csv-to-sqlite.js <path-to-csv> [--fresh]');
    process.exit(1);
  }
  try {
    const { imported, deleted, totalRows } = ingestCsv(csvPath, { fresh });
    console.log(`Imported ${imported} rows. Removed ${deleted} stale row(s) no longer in the CSV. Table "rows" now has ${totalRows} rows total.`);
    console.log(`Database file: ${DB_PATH}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { ingestCsv, DB_PATH, TABLE };
