const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { ingestCsv } = require("../src/scripts/csv-to-sqlite");
const { ensureRowsIdColumn } = require("../src/lib/rows-schema");

function fixture(csvText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-sqlite-test-"));
  const dbPath = path.join(dir, "t.db");
  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
  };
  const rows = () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db.prepare('SELECT * FROM "rows" ORDER BY Player').all();
    } finally {
      db.close();
    }
  };
  return { dir, dbPath, write, rows, first: write("a.csv", csvText) };
}

const WITH_IDS = [
  "id,Tournament,Year,Captain,Player,Pick Order,Rank",
  "1,Summer,2020,Cap A,P1,1,1",
  "2,Summer,2020,Cap A,P2,2,1",
  "3,Summer,2020,Cap B,P3,1,2",
].join("\n");

test("re-ingesting an id-bearing CSV unchanged leaves the table identical", () => {
  const f = fixture(WITH_IDS);
  ingestCsv(f.first, { fresh: true, dbPath: f.dbPath });
  const before = f.rows();
  const result = ingestCsv(f.first, { fresh: false, dbPath: f.dbPath });
  assert.equal(result.deleted, 0);
  assert.deepEqual(f.rows(), before);
});

test("edits apply by id and rows missing from the CSV are deleted", () => {
  const f = fixture(WITH_IDS);
  ingestCsv(f.first, { fresh: true, dbPath: f.dbPath });
  const edited = f.write(
    "b.csv",
    [
      "id,Tournament,Year,Captain,Player,Pick Order,Rank",
      "1,Summer,2020,Cap A,P1-renamed,1,1", // edited in place
      "3,Summer,2020,Cap B,P3,1,2", // id 2 removed
    ].join("\n"),
  );
  const result = ingestCsv(edited, { fresh: false, dbPath: f.dbPath });
  assert.equal(result.deleted, 1);
  assert.deepEqual(
    f.rows().map((r) => [r.id, r.Player]),
    [
      [1, "P1-renamed"],
      [3, "P3"],
    ],
  );
});

test("a row added with a blank id is kept (it used to be inserted, then deleted as stale)", () => {
  const f = fixture(WITH_IDS);
  ingestCsv(f.first, { fresh: true, dbPath: f.dbPath });
  const added = f.write("c.csv", `${WITH_IDS}\n,Summer,2020,Cap B,P4-new,2,2`);
  const result = ingestCsv(added, { fresh: false, dbPath: f.dbPath });
  assert.equal(result.deleted, 0);
  const rows = f.rows();
  assert.equal(rows.length, 4);
  const added4 = rows.find((r) => r.Player === "P4-new");
  assert.ok(added4 && Number.isInteger(added4.id), "new row got an id");
  // Existing rows keep their ids.
  assert.deepEqual(
    rows.filter((r) => r.Player !== "P4-new").map((r) => r.id).sort(),
    [1, 2, 3],
  );
});

const NO_IDS = [
  "Tournament,Year,Captain,Player,Pick Order,Rank",
  "Summer,2020,Cap A,P1,1,1",
  "Summer,2020,Cap A,P2,2,1",
  "Summer,2020,Cap B,P3,1,2",
].join("\n");

const columnsOf = (dbPath) => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('PRAGMA table_info("rows")').all();
  } finally {
    db.close();
  }
};

test("a CSV with no id column gets an auto-built id primary key, 1..N in file order", () => {
  const f = fixture(NO_IDS);
  const result = ingestCsv(f.first, { fresh: true, dbPath: f.dbPath });
  assert.equal(result.replaced, true);
  const cols = columnsOf(f.dbPath);
  assert.equal(cols[0].name, "id");
  assert.equal(cols[0].pk, 1);
  assert.equal(cols[0].type, "INTEGER");
  assert.deepEqual(
    f.rows().map((r) => [r.id, r.Player]),
    [
      [1, "P1"],
      [2, "P2"],
      [3, "P3"],
    ],
  );
});

test("re-ingesting an id-less CSV replaces the rows instead of duplicating them", () => {
  const f = fixture(NO_IDS);
  ingestCsv(f.first, { fresh: true, dbPath: f.dbPath });
  ingestCsv(f.first, { fresh: false, dbPath: f.dbPath });
  assert.equal(f.rows().length, 3);
  // ...and picks up edits and deletions, which appending never would.
  const edited = f.write(
    "b.csv",
    [
      "Tournament,Year,Captain,Player,Pick Order,Rank",
      "Summer,2020,Cap A,P1-renamed,1,1",
      "Summer,2020,Cap B,P3,1,2",
    ].join("\n"),
  );
  ingestCsv(edited, { fresh: false, dbPath: f.dbPath });
  assert.deepEqual(
    f.rows().map((r) => [r.id, r.Player]),
    [
      [1, "P1-renamed"],
      [2, "P3"],
    ],
  );
});

test("the id column is created first even when the CSV puts it last", () => {
  const f = fixture(
    [
      "Tournament,Year,Captain,Player,Pick Order,Rank,id",
      "Summer,2020,Cap A,P1,1,1,10",
    ].join("\n"),
  );
  ingestCsv(f.first, { fresh: true, dbPath: f.dbPath });
  assert.equal(columnsOf(f.dbPath)[0].name, "id");
  assert.equal(f.rows()[0].id, 10);
});

function oldStyleDb(f) {
  // What an existing database looks like: a rows table with no id at all.
  const db = new Database(f.dbPath);
  db.exec(
    'CREATE TABLE "rows" ("Tournament" TEXT, "Year" TEXT, "Captain" TEXT, "Player" TEXT, "Pick Order" TEXT, "Rank" TEXT)',
  );
  db.exec('CREATE INDEX idx_rows_player ON "rows"("Player")');
  const add = db.prepare('INSERT INTO "rows" VALUES (?, ?, ?, ?, ?, ?)');
  add.run("Summer", "2020", "Cap A", "P1", "1", "1");
  add.run("Summer", "2020", "Cap A", "P2", "2", "1");
  add.run("Summer", "2020", "Cap B", "P3", "1", "2");
  return db;
}

test("ensureRowsIdColumn adds an id to an existing table without touching its data", () => {
  const f = fixture(NO_IDS);
  const db = oldStyleDb(f);
  assert.equal(ensureRowsIdColumn(db, "rows"), true);
  const rows = db.prepare('SELECT * FROM "rows" ORDER BY id').all();
  assert.deepEqual(
    rows.map((r) => [r.id, r.Tournament, r.Year, r.Captain, r.Player, r["Pick Order"], r.Rank]),
    [
      [1, "Summer", "2020", "Cap A", "P1", "1", "1"],
      [2, "Summer", "2020", "Cap A", "P2", "2", "1"],
      [3, "Summer", "2020", "Cap B", "P3", "1", "2"],
    ],
  );
  // Column types and the user's index survive the rebuild.
  const cols = db.prepare('PRAGMA table_info("rows")').all();
  assert.deepEqual(cols.map((c) => c.name), ["id", "Tournament", "Year", "Captain", "Player", "Pick Order", "Rank"]);
  assert.equal(cols.find((c) => c.name === "Player").type, "TEXT");
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_rows_player'").get());
  db.close();
});

test("ensureRowsIdColumn is a no-op when the id exists or the table doesn't", () => {
  const f = fixture(NO_IDS);
  const db = oldStyleDb(f);
  assert.equal(ensureRowsIdColumn(db, "rows"), true);
  const before = db.prepare('SELECT * FROM "rows" ORDER BY id').all();
  assert.equal(ensureRowsIdColumn(db, "rows"), false); // second call
  assert.deepEqual(db.prepare('SELECT * FROM "rows" ORDER BY id').all(), before);
  assert.equal(ensureRowsIdColumn(db, "no_such_table"), false);
  db.close();
});

test("ingesting into an existing id-less table migrates it, with an id-bearing CSV too", () => {
  const f = fixture(NO_IDS);
  oldStyleDb(f).close();
  const withIds = f.write(
    "c.csv",
    [
      "id,Tournament,Year,Captain,Player,Pick Order,Rank",
      "1,Summer,2020,Cap A,P1,1,1",
      "2,Summer,2020,Cap A,P2-renamed,2,1",
    ].join("\n"),
  );
  const result = ingestCsv(withIds, { fresh: false, dbPath: f.dbPath });
  assert.equal(result.deleted, 1); // migrated id 3 is no longer in the CSV
  assert.deepEqual(
    f.rows().map((r) => [r.id, r.Player]),
    [
      [1, "P1"],
      [2, "P2-renamed"],
    ],
  );
});
