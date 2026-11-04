// Past names: the migration, recording a name an editor matched by hand when
// saving a match, and reading the names back for the lookups.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { ensureMatchDetailsSchema } = require("../src/lib/match-details-schema");
const { loadIdentityMap } = require("../src/lib/player-identity");
const { readMatchState, saveMatchEdit } = require("../src/lib/match-detail-editor");
const {
  ensureNameHistorySchema,
  identityKeysForPastName,
  loadPastNamesByIdentityKey,
} = require("../src/lib/name-history");

const MATCH_KEY = "match-2026-summer-groups-1-cap1-cap2";
const EDITOR = { sub: "editor-1", email: "editor@example.com" };
const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "src", "db", "identity-schema.sql"), "utf8");

// Identity tables, with the player_aliases table the schema file leaves to the
// bootstrap script.
function makeDb({ withIdentity = true } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE rows ("Tournament" TEXT, "Year" TEXT, "Captain" TEXT, "Player" TEXT, "Pick Order" TEXT, "Rank" TEXT);
    CREATE TABLE matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, tournament TEXT,
      team1 TEXT NOT NULL, team2 TEXT NOT NULL, result TEXT NOT NULL,
      csv_row_index INTEGER NOT NULL, match_order INTEGER NOT NULL, match_stage TEXT,
      match_key TEXT NOT NULL UNIQUE
    );
  `);
  ensureMatchDetailsSchema(db);
  if (withIdentity) {
    db.exec(`CREATE TABLE player_aliases (alias TEXT PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE)`);
    db.exec(SCHEMA);
  }
  const addRow = db.prepare(`INSERT INTO rows VALUES ('Summer', '2026', ?, ?, '1', '1')`);
  for (const [captain, player] of [["Cap1", "A1#NA1"], ["Cap2", "B1#NA1"]]) addRow.run(captain, player);
  db.prepare(
    `INSERT INTO matches (year, tournament, team1, team2, result, csv_row_index, match_order, match_stage, match_key)
     VALUES (2026, 'Summer', 'Cap1', 'Cap2', 'Cap1', 0, 1, 'Groups', ?)`,
  ).run(MATCH_KEY);
  if (withIdentity) {
    const addPlayer = db.prepare("INSERT INTO players (riot_game_name, riot_tag_line) VALUES (?, ?)");
    const addAlias = db.prepare("INSERT INTO player_aliases (alias, player_id) VALUES (?, ?)");
    for (const [alias, name, tag] of [["Cap1", "Cap1", "X"], ["A1#NA1", "A1", "NA1"], ["Cap2", "Cap2", "X"], ["B1#NA1", "B1", "NA1"]]) {
      addAlias.run(alias, addPlayer.run(name, tag).lastInsertRowid);
    }
  }
  return db;
}

const save = (db, extra = {}) => {
  const state = readMatchState(db, MATCH_KEY, loadIdentityMap(db));
  return saveMatchEdit(
    db,
    MATCH_KEY,
    { baseRev: state.rev, resultSide: "team1", players: [{ player: "A1#NA1", champion: "Ahri", kills: 1, deaths: 2, assists: 3, role: "Mid" }], bans: { team1: [], team2: [] }, ...extra },
    EDITOR,
    loadIdentityMap(db),
  );
};
const history = (db) => db.prepare("SELECT * FROM name_history ORDER BY id").all();

test("a name_history table from before the provenance columns is upgraded in place, keeping its rows", () => {
  const db = makeDb();
  db.exec("DROP TABLE name_history");
  db.exec(`CREATE TABLE name_history (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL, old_name TEXT, old_tag TEXT, new_name TEXT, new_tag TEXT, changed_at TEXT DEFAULT (datetime('now')))`);
  db.prepare("INSERT INTO name_history (player_id, old_name, old_tag, new_name, new_tag) VALUES (2, 'Old', 'T', 'A1', 'NA1')").run();
  assert.equal(ensureNameHistorySchema(db), true);
  assert.equal(ensureNameHistorySchema(db), true, "running it again is harmless");
  const [row] = history(db);
  assert.equal(row.old_name, "Old");
  assert.equal(row.source, "riot-sync", "existing rows were written by Riot sync");
  assert.equal(row.match_key, null);
});

test("without identity tables the schema step and a save both carry on", () => {
  const db = makeDb({ withIdentity: false });
  assert.equal(ensureNameHistorySchema(db), false);
  const saved = save(db, { nameMatches: [{ player: "A1#NA1", name: "OldA" }] });
  assert.deepEqual(saved.recordedPastNames, []);
  assert.equal(loadPastNamesByIdentityKey(db).size, 0);
});

test("a name matched by hand is remembered as a past name of that roster player", () => {
  const db = makeDb();
  const saved = save(db, { nameMatches: [{ player: "A1#NA1", name: "  Old   A1 ", tag: "EUW" }] });
  assert.equal(saved.recordedPastNames.length, 1);
  const [row] = history(db);
  assert.deepEqual(
    { old_name: row.old_name, old_tag: row.old_tag, new_name: row.new_name, new_tag: row.new_tag, source: row.source, match_key: row.match_key, added_by: row.added_by },
    { old_name: "Old A1", old_tag: "EUW", new_name: "A1", new_tag: "NA1", source: "manual-match", match_key: MATCH_KEY, added_by: "editor-1" },
  );
  assert.deepEqual([...loadPastNamesByIdentityKey(db)], [["p2", ["Old A1#EUW"]]]);
});

test("the editor's match state lists each roster player's past names", () => {
  const db = makeDb();
  save(db, { nameMatches: [{ player: "A1#NA1", name: "OldA" }] });
  const state = readMatchState(db, MATCH_KEY, loadIdentityMap(db));
  const slot = state.teams[0].players.find((p) => p.player === "A1#NA1");
  assert.deepEqual(slot.pastNames, ["OldA"]);
  assert.deepEqual(state.teams[1].players[0].pastNames, []);
});

test("a name already remembered, or the player's own current name, is not added again", () => {
  const db = makeDb();
  save(db, { nameMatches: [{ player: "A1#NA1", name: "OldA" }] });
  save(db, { nameMatches: [{ player: "A1#NA1", name: "olda" }, { player: "A1#NA1", name: "A1" }, { player: "A1#NA1", name: "a1", tag: "NA1" }] });
  assert.equal(history(db).length, 1);
});

test("it is remembered even when nothing else about the match changed", () => {
  const db = makeDb();
  save(db);
  const again = save(db, { nameMatches: [{ player: "A1#NA1", name: "OldA" }] });
  assert.equal(again.recordedPastNames.length, 1);
});

test("nothing is recorded for players who are not in the match, untracked, or malformed", () => {
  const db = makeDb();
  db.prepare("DELETE FROM player_aliases WHERE alias = 'B1#NA1'").run();
  save(db, {
    nameMatches: [
      { player: "Stranger#1", name: "Whoever" }, // not on either team
      { player: "B1#NA1", name: "OldB" }, // on a team, but no tracked identity
      { player: "A1#NA1", name: "x".repeat(40) },
      { player: "A1#NA1", name: "has#hash" },
      { player: "A1#NA1", name: "" },
      { player: "A1#NA1" },
      "nonsense",
      null,
    ],
  });
  assert.equal(history(db).length, 0);
  save(db, { nameMatches: "not a list" }); // ignored, the save still works
});

test("a bad tag is dropped but the name is still kept", () => {
  const db = makeDb();
  save(db, { nameMatches: [{ player: "A1#NA1", name: "OldA", tag: "way-too-long!" }] });
  assert.equal(history(db)[0].old_tag, null);
});

test("a conflicting save records nothing", () => {
  const db = makeDb();
  assert.throws(() => save(db, { baseRev: "stale", nameMatches: [{ player: "A1#NA1", name: "OldA" }] }), /changed by someone else/);
  assert.equal(history(db).length, 0);
});

test("an old name finds its player, but only when it is unambiguous; profile slugs work too", () => {
  const names = new Map([["p2", ["Old A1#EUW"]], ["p3", ["Shared"]], ["p4", ["shared"]]]);
  assert.deepEqual(identityKeysForPastName(names, "old a1"), []); // the tag is part of the name
  assert.deepEqual(identityKeysForPastName(names, "Old A1#EUW"), ["p2"]);
  assert.deepEqual(identityKeysForPastName(names, "Old A1-EUW"), ["p2"]);
  assert.deepEqual(identityKeysForPastName(names, "SHARED"), ["p3", "p4"]);
  assert.deepEqual(identityKeysForPastName(names, ""), []);
});

test("Riot-sync history and manual matches both feed the same list, without duplicates", () => {
  const db = makeDb();
  db.prepare("INSERT INTO name_history (player_id, old_name, old_tag, new_name, new_tag) VALUES (2, 'Syncd', 'T', 'A1', 'NA1')").run();
  save(db, { nameMatches: [{ player: "A1#NA1", name: "Syncd", tag: "T" }, { player: "A1#NA1", name: "Manual" }] });
  assert.deepEqual(loadPastNamesByIdentityKey(db).get("p2"), ["Syncd#T", "Manual"]);
});
