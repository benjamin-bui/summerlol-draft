const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const {
  ingestMatchDetails,
  ingestMatchDetailsDetailed,
} = require("../src/scripts/ingest-match-details");
const { buildMatchKey } = require("../src/lib/match-identity");
const { normalizeRole, parseBanList } = require("../src/lib/match-detail-fields");

// One tournament (2026 Summer), two captains, two players each:
//   Team 1: Cap1 (captain) + A1, A2     Team 2: Cap2 (captain) + B1, B2
// and two games between them.
function makeFixture({ olderMatchDetailsTable = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  const dbPath = path.join(dir, "test.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE rows ("Tournament" TEXT, "Year" TEXT, "Captain" TEXT, "Player" TEXT, "Pick Order" TEXT, "Rank" TEXT);
    CREATE TABLE matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, tournament TEXT,
      team1 TEXT NOT NULL, team2 TEXT NOT NULL, result TEXT NOT NULL,
      csv_row_index INTEGER NOT NULL, match_order INTEGER NOT NULL, match_stage TEXT,
      match_key TEXT NOT NULL UNIQUE
    );
  `);
  if (olderMatchDetailsTable) {
    // The shape match_details had before the role column existed.
    db.exec(`
      CREATE TABLE match_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT, match_key TEXT NOT NULL, player TEXT NOT NULL,
        champion TEXT, kills INTEGER, deaths INTEGER, assists INTEGER
      );
      INSERT INTO match_details (match_key, player, champion) VALUES ('stale', 'x', 'Ahri');
    `);
  }
  const addRow = db.prepare(
    `INSERT INTO rows VALUES ('Summer', '2026', ?, ?, ?, '1')`,
  );
  addRow.run("Cap1", "A1", "1");
  addRow.run("Cap1", "A2", "2");
  addRow.run("Cap2", "B1", "3");
  addRow.run("Cap2", "B2", "4");
  const addMatch = db.prepare(
    `INSERT INTO matches (year, tournament, team1, team2, result, csv_row_index, match_order, match_stage, match_key)
     VALUES (2026, 'Summer', 'Cap1', 'Cap2', 'Cap1', ?, ?, 'Groups', ?)`,
  );
  const keys = {};
  [1, 2].forEach((order, i) => {
    const key = buildMatchKey({
      year: 2026,
      tournament: "Summer",
      matchStage: "Groups",
      matchOrder: order,
      team1: "Cap1",
      team2: "Cap2",
    });
    keys[order] = key;
    addMatch.run(i, order, key);
  });
  db.close();
  return { dir, dbPath, keys };
}

function writeCsv(dir, name, header, rows) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, [header, ...rows].join("\n") + "\n");
  return file;
}

function readBans(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare("SELECT match_key, side, champion FROM match_bans ORDER BY id")
      .all();
  } finally {
    db.close();
  }
}

const BASE_HEADER = "Year,Tournament,Match Stage,Match Order,Player,Champion,K,D,A";

test("a CSV with no Role or Ban column still ingests, with null roles and no bans", () => {
  const { dir, dbPath } = makeFixture();
  const csv = writeCsv(dir, "d.csv", BASE_HEADER, [
    "2026,Summer,Groups,1,A1,Ahri,1,2,3",
    "2026,Summer,Groups,1,B1,Zed,4,5,6",
  ]);
  const result = ingestMatchDetailsDetailed(csv, { dbPath });
  assert.equal(result.details, 2);
  assert.equal(result.bans, 0);
  assert.equal(result.rolesRecorded, 0);
  const db = new Database(dbPath, { readonly: true });
  assert.deepEqual(
    db.prepare("SELECT player, role FROM match_details ORDER BY id").all(),
    [
      { player: "A1", role: null },
      { player: "B1", role: null },
    ],
  );
  db.close();
  assert.deepEqual(readBans(dbPath), []);
});

test("the plain ingestMatchDetails entry point still returns the row count", () => {
  const { dir, dbPath } = makeFixture();
  const csv = writeCsv(dir, "d.csv", `${BASE_HEADER},Role,Ban`, [
    "2026,Summer,Groups,1,A1,Ahri,1,2,3,Mid,Yasuo",
  ]);
  assert.equal(ingestMatchDetails(csv, { dbPath }), 1);
});

test("Role and Ban columns that are present but empty behave like absent ones", () => {
  const { dir, dbPath } = makeFixture();
  const csv = writeCsv(dir, "d.csv", `${BASE_HEADER},Role,Ban`, [
    "2026,Summer,Groups,1,A1,Ahri,1,2,3,,",
    "2026,Summer,Groups,1,B1,Zed,4,5,6,,",
  ]);
  const result = ingestMatchDetailsDetailed(csv, { dbPath });
  assert.equal(result.details, 2);
  assert.equal(result.bans, 0);
  assert.equal(result.rolesRecorded, 0);
});

test("rows shorter than the header (trailing empty cells dropped) are fine", () => {
  const { dir, dbPath } = makeFixture();
  const csv = writeCsv(dir, "d.csv", `${BASE_HEADER},Role,Ban`, [
    "2026,Summer,Groups,1,A1,Ahri,1,2,3",
  ]);
  assert.equal(ingestMatchDetailsDetailed(csv, { dbPath }).details, 1);
});

test("roles are stored canonically, whatever alias was typed", () => {
  const { dir, dbPath } = makeFixture();
  const csv = writeCsv(dir, "d.csv", `${BASE_HEADER},Role,Ban`, [
    "2026,Summer,Groups,1,A1,Ahri,1,2,3,mid,",
    "2026,Summer,Groups,1,A2,Ashe,1,2,3,ADC,",
    "2026,Summer,Groups,1,B1,Zed,4,5,6,Jng,",
    "2026,Summer,Groups,1,B2,Leona,4,5,6,Support,",
  ]);
  const result = ingestMatchDetailsDetailed(csv, { dbPath });
  assert.equal(result.rolesRecorded, 4);
  const db = new Database(dbPath, { readonly: true });
  assert.deepEqual(
    db.prepare("SELECT role FROM match_details ORDER BY id").all().map((r) => r.role),
    ["Mid", "Bot", "Jungle", "Supp"],
  );
  db.close();
});

test("a ban belongs to the row's team, not the row's player", () => {
  const { dir, dbPath, keys } = makeFixture();
  // Team 1's bans are typed on A1's and A2's rows; team 2's on B2's row only.
  // Neither team's bans are tied to a particular player.
  const csv = writeCsv(dir, "d.csv", `${BASE_HEADER},Role,Ban`, [
    "2026,Summer,Groups,1,A1,Ahri,1,2,3,Mid,Yasuo",
    "2026,Summer,Groups,1,A2,Ashe,1,2,3,Bot,Zed",
    "2026,Summer,Groups,1,B1,Zed,4,5,6,Jungle,",
    "2026,Summer,Groups,1,B2,Leona,4,5,6,Supp,Garen",
  ]);
  const result = ingestMatchDetailsDetailed(csv, { dbPath });
  assert.equal(result.bans, 3);
  assert.equal(result.gamesWithBans, 1);
  const bans = readBans(dbPath);
  assert.deepEqual(
    bans.map((b) => [b.side, b.champion]).sort(),
    [
      [1, "Yasuo"],
      [1, "Zed"],
      [2, "Garen"],
    ],
  );
  assert.ok(bans.every((b) => b.match_key === keys[1]));
});

test("the captain's own row (not in the Player draft rows) attributes bans to their team", () => {
  const { dir, dbPath } = makeFixture();
  const csv = writeCsv(dir, "d.csv", `${BASE_HEADER},Role,Ban`, [
    "2026,Summer,Groups,1,Cap2,Ahri,1,2,3,Top,Teemo",
  ]);
  ingestMatchDetailsDetailed(csv, { dbPath });
  assert.deepEqual(
    readBans(dbPath).map((b) => [b.side, b.champion]),
    [[2, "Teemo"]],
  );
});

test("several bans in one cell, repeats across rows, and 'no ban' placeholders", () => {
  const { dir, dbPath } = makeFixture();
  const csv = writeCsv(dir, "d.csv", `${BASE_HEADER},Role,Ban`, [
    // The whole team's list repeated on every row -> still one ban each.
    `2026,Summer,Groups,1,A1,Ahri,1,2,3,Mid,"Yasuo, Zed; Kai'Sa"`,
    `2026,Summer,Groups,1,A2,Ashe,1,2,3,Bot,"Yasuo, Zed; Kai'Sa"`,
    // Same champion spelled differently by the other team's rows.
    "2026,Summer,Groups,1,B1,Leona,1,2,3,Supp,kaisa",
    "2026,Summer,Groups,1,B2,Lux,1,2,3,Mid,None",
    // A team that skipped its ban.
    "2026,Summer,Groups,2,A1,Ahri,1,2,3,Mid,N/A",
    "2026,Summer,Groups,2,B1,Leona,1,2,3,Supp,Nunu & Willump",
  ]);
  const result = ingestMatchDetailsDetailed(csv, { dbPath });
  // Team 1 game 1: Yasuo, Zed, Kai'Sa. Team 2 game 1: kaisa. Team 2 game 2: Nunu & Willump.
  assert.equal(result.bans, 5);
  assert.equal(result.gamesWithBans, 2);
  const db = new Database(dbPath, { readonly: true });
  const perSide = db
    .prepare("SELECT side, COUNT(*) AS n FROM match_bans GROUP BY side ORDER BY side")
    .all();
  assert.deepEqual(perSide, [
    { side: 1, n: 3 },
    { side: 2, n: 2 },
  ]);
  db.close();
});

test("re-running replaces bans and roles wholesale", () => {
  const { dir, dbPath } = makeFixture();
  const withBan = writeCsv(dir, "a.csv", `${BASE_HEADER},Role,Ban`, [
    "2026,Summer,Groups,1,A1,Ahri,1,2,3,Mid,Yasuo",
  ]);
  ingestMatchDetailsDetailed(withBan, { dbPath });
  assert.equal(readBans(dbPath).length, 1);
  const without = writeCsv(dir, "b.csv", BASE_HEADER, [
    "2026,Summer,Groups,1,A1,Ahri,1,2,3",
  ]);
  ingestMatchDetailsDetailed(without, { dbPath });
  assert.equal(readBans(dbPath).length, 0);
});

test("a database from before the role column existed is migrated in place", () => {
  const { dir, dbPath } = makeFixture({ olderMatchDetailsTable: true });
  const csv = writeCsv(dir, "d.csv", `${BASE_HEADER},Role,Ban`, [
    "2026,Summer,Groups,1,A1,Ahri,1,2,3,Top,Yasuo",
  ]);
  ingestMatchDetailsDetailed(csv, { dbPath });
  const db = new Database(dbPath, { readonly: true });
  const cols = db.prepare("PRAGMA table_info(match_details)").all().map((c) => c.name);
  assert.ok(cols.includes("role"));
  assert.deepEqual(db.prepare("SELECT player, role FROM match_details").all(), [
    { player: "A1", role: "Top" },
  ]);
  db.close();
});

test("an unrecognized Role fails loudly with its row number", () => {
  const { dir, dbPath } = makeFixture();
  const csv = writeCsv(dir, "d.csv", `${BASE_HEADER},Role,Ban`, [
    "2026,Summer,Groups,1,A1,Ahri,1,2,3,Mid,",
    "2026,Summer,Groups,1,A2,Ashe,1,2,3,Fill,",
  ]);
  assert.throws(
    () => ingestMatchDetailsDetailed(csv, { dbPath }),
    /Row 3: "Role" value "Fill" is not recognized/,
  );
});

test("normalizeRole / parseBanList", () => {
  assert.equal(normalizeRole("", 2), null);
  assert.equal(normalizeRole("  Jungle ", 2), "Jungle");
  assert.equal(normalizeRole("SUP", 2), "Supp");
  assert.deepEqual(parseBanList("Ahri|Zed/Yasuo"), ["Ahri", "Zed", "Yasuo"]);
  assert.deepEqual(parseBanList("N/A"), []);
  assert.deepEqual(parseBanList("Dr. Mundo"), ["Dr. Mundo"]);
  assert.deepEqual(parseBanList(undefined), []);
});
