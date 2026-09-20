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

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const Database = require("better-sqlite3");
const { ensureRowsIdColumn } = require("../lib/rows-schema");

const DB_PATH = path.join(__dirname, "..", "..", "data", "app.db");
const TABLE = "rows";

// Quote every identifier with double quotes — this is what lets column
// names like "group" (reserved) or "Pick Value" (has a space) work.
const q = (id) => `"${id}"`;

function ingestCsv(csvPath, { fresh = false, dbPath = DB_PATH } = {}) {
  const csvRaw = fs.readFileSync(csvPath, "utf-8");
  const records = parse(csvRaw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    throw new Error("No rows found in CSV.");
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const columns = Object.keys(records[0]);

  if (fresh) {
    db.exec(`DROP TABLE IF EXISTS ${q(TABLE)}`);
  }

  // Does the CSV itself carry ids? The table always has an `id` column
  // regardless -- when the CSV has none, SQLite assigns them.
  const hasIdCol = columns.includes("id");
  const colDefs = [
    `${q("id")} INTEGER PRIMARY KEY`,
    ...columns.filter((c) => c !== "id").map((c) => `${q(c)} TEXT`),
  ].join(", ");

  db.exec(`CREATE TABLE IF NOT EXISTS ${q(TABLE)} (${colDefs})`);
  // A table left over from a CSV with no id column (or an older version of
  // the app) gets one added, keeping its rows.
  ensureRowsIdColumn(db, TABLE);

  const placeholders = columns.map(() => "?").join(", ");
  const upsertCols = columns
    .filter((c) => c !== "id")
    .map((c) => `${q(c)}=excluded.${q(c)}`)
    .join(", ");

  const insert = hasIdCol
    ? db.prepare(
        `INSERT INTO ${q(TABLE)} (${columns.map(q).join(", ")}) VALUES (${placeholders})
         ON CONFLICT("id") DO UPDATE SET ${upsertCols}`,
      )
    : db.prepare(
        `INSERT INTO ${q(TABLE)} (${columns.map(q).join(", ")}) VALUES (${placeholders})`,
      );

  // Sync, not just upsert: any DB row whose id is no longer present in
  // the CSV gets deleted. Without this, removing/replacing a row in the
  // spreadsheet (e.g. correcting a mislabeled draft pick) never actually
  // removes the stale row from the DB -- it just accumulates forever,
  // which is exactly the bug that motivated this change.
  const syncDeletes = db.transaction((incomingIds) => {
    if (!hasIdCol) return 0; // no ids in the CSV to diff against -- see insertMany
    const existingIds = db
      .prepare(`SELECT id FROM ${q(TABLE)}`)
      .all()
      .map((r) => Number(r.id));
    const incoming = new Set(incomingIds.map(Number));
    const staleIds = existingIds.filter((id) => !incoming.has(id));
    if (staleIds.length === 0) return 0;
    const del = db.prepare(`DELETE FROM ${q(TABLE)} WHERE id = ?`);
    for (const id of staleIds) del.run(id);
    return staleIds.length;
  });

  // Returns the ids SQLite assigned to rows whose id cell was blank (a row
  // added to the sheet without an id yet). Those ids aren't in the CSV, so
  // without this the sync below would take each brand-new row for a stale
  // one and delete it the moment it was inserted.
  const insertMany = db.transaction((rows) => {
    // With no id column in the CSV there is nothing to tell which existing row
    // is which, so the table is replaced outright (ids restart at 1, in file
    // order). Appending instead would duplicate every row on each re-ingest.
    if (!hasIdCol) db.exec(`DELETE FROM ${q(TABLE)}`);
    const assignedIds = [];
    for (const row of rows) {
      const values = columns.map((c) => (row[c] === "" ? null : row[c]));
      const info = insert.run(values);
      if (hasIdCol && (row.id === "" || row.id == null)) {
        assignedIds.push(Number(info.lastInsertRowid));
      }
    }
    return assignedIds;
  });

  const assignedIds = insertMany(records);
  const deletedCount = hasIdCol
    ? syncDeletes([...records.map((r) => r.id), ...assignedIds])
    : 0;

  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${q(TABLE)}`).get().n;
  db.close();

  return {
    imported: records.length,
    deleted: deletedCount,
    totalRows: count,
    // True when the CSV had no id column, so the table was replaced wholesale.
    replaced: !hasIdCol,
  };
}

if (require.main === module) {
  const csvPath = process.argv[2];
  const fresh = process.argv.includes("--fresh");
  if (!csvPath) {
    console.error("Usage: node data/csv-to-sqlite.js <path-to-csv> [--fresh]");
    process.exit(1);
  }
  try {
    const { imported, deleted, totalRows, replaced } = ingestCsv(csvPath, {
      fresh,
    });
    console.log(
      replaced
        ? `Imported ${imported} rows, replacing the table's contents (the CSV has no id column, so ids were assigned 1..${totalRows} in file order). Table "rows" now has ${totalRows} rows total.`
        : `Imported ${imported} rows. Removed ${deleted} stale row(s) no longer in the CSV. Table "rows" now has ${totalRows} rows total.`,
    );
    console.log(`Database file: ${DB_PATH}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { ingestCsv, DB_PATH, TABLE };
