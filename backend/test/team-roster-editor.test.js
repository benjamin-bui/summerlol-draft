const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { readTeamRoster, saveTeamRoster } = require("../src/lib/team-roster-editor");

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE rows (
      "Year" TEXT,
      "Tournament" TEXT,
      "Captain" TEXT,
      "Player" TEXT,
      "Pick Order" TEXT,
      "Rank" TEXT,
      "Extra" TEXT
    );
    CREATE TABLE matches (
      year INTEGER,
      tournament TEXT,
      team1 TEXT,
      team2 TEXT
    );
    INSERT INTO matches VALUES
      (2026, 'Summer', 'Cap#NA1', 'Other#NA1'),
      (2026, 'Summer', 'Solo#NA1', 'Cap#NA1');
    INSERT INTO rows VALUES
      ('2026', 'Summer', 'Cap#NA1', 'First-old', '1', '2', 'keep'),
      ('2026', 'Summer', 'Cap#NA1', 'Second#NA1', '2', '2', 'keep'),
      ('2026', 'Summer', 'Other#NA1', 'Other-player', '1', '1', 'other');
  `);
  return db;
}

const identities = new Map([
  ["Cap#NA1", { identityKey: "p1", displayName: "Cap#NA1" }],
  ["First-old", { identityKey: "p2", displayName: "First#NA1" }],
  ["First#NA1", { identityKey: "p2", displayName: "First#NA1" }],
  ["Second#NA1", { identityKey: "p3", displayName: "Second#NA1" }],
  ["New#NA1", { identityKey: "p4", displayName: "New#NA1" }],
  ["Other#NA1", { identityKey: "p5", displayName: "Other#NA1" }],
  ["Solo#NA1", { identityKey: "p6", displayName: "Solo#NA1" }],
]);

test("reads and saves canonical roster names, pick order and existing row data", () => {
  const db = createDb();
  try {
    const state = readTeamRoster(db, 2026, "Summer", "p1", "Cap#NA1", identities);
    assert.deepEqual(state.players.map(({ name, pickOrder }) => [name, pickOrder]), [
      ["First#NA1", 1],
      ["Second#NA1", 2],
    ]);

    const saved = saveTeamRoster(
      db,
      2026,
      "Summer",
      {
        captainKey: "p1",
        captainName: "Cap#NA1",
        baseRev: state.baseRev,
        players: ["New#NA1", "Second#NA1"],
      },
      identities,
    );

    assert.deepEqual(saved.players.map(({ name, pickOrder }) => [name, pickOrder]), [
      ["New#NA1", 1],
      ["Second#NA1", 2],
    ]);
    assert.deepEqual(
      db.prepare(`SELECT "Player" AS player, "Pick Order" AS pickOrder, "Rank" AS rank, "Extra" AS extra
                  FROM rows WHERE "Captain" = 'Cap#NA1' ORDER BY CAST("Pick Order" AS INTEGER)`).all(),
      [
        { player: "New#NA1", pickOrder: "1", rank: "2", extra: null },
        { player: "Second#NA1", pickOrder: "2", rank: "2", extra: "keep" },
      ],
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rows WHERE \"Captain\" = 'Other#NA1'").get().count, 1);
  } finally {
    db.close();
  }
});

test("rejects duplicate identities and stale roster revisions without changing rows", () => {
  const db = createDb();
  try {
    const state = readTeamRoster(db, 2026, "Summer", "p1", "Cap#NA1", identities);
    assert.throws(
      () => saveTeamRoster(
        db,
        2026,
        "Summer",
        { captainKey: "p1", captainName: "Cap#NA1", baseRev: state.baseRev, players: ["First-old", "First#NA1"] },
        identities,
      ),
      /appears more than once/,
    );
    assert.throws(
      () => saveTeamRoster(
        db,
        2026,
        "Summer",
        { captainKey: "p1", captainName: "Cap#NA1", baseRev: "stale", players: ["New#NA1"] },
        identities,
      ),
      /changed while you were editing/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rows WHERE \"Captain\" = 'Cap#NA1'").get().count, 2);
  } finally {
    db.close();
  }
});

test("can add picks for a team found in match history before it has draft rows", () => {
  const db = createDb();
  try {
    const state = readTeamRoster(db, 2026, "Summer", "p6", "Solo#NA1", identities);
    assert.deepEqual(state.players, []);
    const saved = saveTeamRoster(
      db,
      2026,
      "Summer",
      { captainKey: "p6", captainName: "Solo#NA1", baseRev: state.baseRev, players: ["New#NA1"] },
      identities,
    );
    assert.deepEqual(saved.players.map(({ name, pickOrder }) => [name, pickOrder]), [["New#NA1", 1]]);
    assert.deepEqual(
      db.prepare(`SELECT "Captain" AS captain, "Player" AS player, "Pick Order" AS pickOrder, "Rank" AS rank
                  FROM rows WHERE "Captain" = 'Solo#NA1'`).get(),
      { captain: "Solo#NA1", player: "New#NA1", pickOrder: "1", rank: null },
    );
  } finally {
    db.close();
  }
});

test("supports unresolved captain names before player identities are bootstrapped", () => {
  const db = createDb();
  try {
    const state = readTeamRoster(db, 2026, "Summer", "Cap#NA1", "Cap#NA1", new Map());
    assert.deepEqual(state.players.map((player) => player.name), ["First-old", "Second#NA1"]);
  } finally {
    db.close();
  }
});
