// The draft-picks table (`rows`) always has an integer primary-key `id`. It is
// the key csv-to-sqlite.js upserts and delete-syncs on, and what the draft data
// CSV download hands back so an edited download lines up with the DB.
//
// A table built from a CSV with no id column (or from an older version of the
// app) doesn't have one, and SQLite can't bolt a primary key onto an existing
// table -- so this rebuilds it. Used by server.js at startup (so an existing
// database just gets the column) and by csv-to-sqlite.js before it ingests.

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

// Returns true if it had to add the column, false if there was nothing to do
// (the table already has `id`, or doesn't exist yet). Idempotent, and it never
// touches the data: every row and column is carried over as it was.
//
// Existing rows get ids 1..N in the order they are stored, so the numbering is
// stable and matches what a fresh ingest of the same CSV would assign.
function ensureRowsIdColumn(db, table = "rows") {
  const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
  if (columns.length === 0 || columns.some((c) => c.name === "id")) return false;

  // Indexes and triggers live on the old table and would go with it.
  const dependents = db
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL`,
    )
    .all(table)
    .map((r) => r.sql);

  const temp = `${table}__with_id`;
  const names = columns.map((c) => quote(c.name)).join(", ");
  const defs = columns
    .map((c) => `${quote(c.name)}${c.type ? ` ${c.type}` : ""}`)
    .join(", ");

  db.transaction(() => {
    db.exec(`DROP TABLE IF EXISTS ${quote(temp)}`);
    db.exec(`CREATE TABLE ${quote(temp)} ("id" INTEGER PRIMARY KEY, ${defs})`);
    db.exec(
      `INSERT INTO ${quote(temp)} ("id", ${names})
       SELECT ROW_NUMBER() OVER (ORDER BY rowid), ${names} FROM ${quote(table)}`,
    );
    // Copy, drop, rename -- rather than rename-then-copy -- so views that refer
    // to the table by name keep pointing at it.
    db.exec(`DROP TABLE ${quote(table)}`);
    db.exec(`ALTER TABLE ${quote(temp)} RENAME TO ${quote(table)}`);
    for (const sql of dependents) db.exec(sql);
  })();
  return true;
}

module.exports = { ensureRowsIdColumn };
