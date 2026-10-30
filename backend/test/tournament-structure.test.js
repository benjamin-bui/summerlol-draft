const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const { buildMatchKey } = require("../src/lib/match-identity");
const {
  addGameToSeries,
  createSeries,
  ensureDefaultStages,
  ensureTournamentStructureSchema,
  readTournamentStructure,
  saveStages,
} = require("../src/lib/tournament-structure");
const { ensureMatchDetailsSchema } = require("../src/lib/match-details-schema");
const { ingestMatches } = require("../src/scripts/ingest-matches");

const editor = { sub: "editor-1", email: "editor@example.test" };

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      tournament TEXT,
      team1 TEXT NOT NULL,
      team2 TEXT NOT NULL,
      result TEXT NOT NULL,
      csv_row_index INTEGER NOT NULL,
      match_order INTEGER NOT NULL,
      match_stage TEXT,
      match_key TEXT NOT NULL UNIQUE
    )
  `);
  ensureTournamentStructureSchema(db);
  return db;
}

function insertGame(db, matchOrder, { team1 = "Team A", team2 = "Team B", result = "Team A" } = {}) {
  const values = {
    year: 2026,
    tournament: "Summer",
    matchStage: null,
    matchOrder,
    team1,
    team2,
  };
  const matchKey = buildMatchKey(values);
  db.prepare(
    `INSERT INTO matches
      (year, tournament, team1, team2, result, csv_row_index, match_order, match_stage, match_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(2026, "Summer", team1, team2, result, matchOrder - 1, matchOrder, null, matchKey);
  return matchKey;
}

test("stages and series group games for display without removing individual games", () => {
  const db = createDb();
  try {
    const first = insertGame(db, 1);
    const second = insertGame(db, 2, { result: "Team B" });
    ensureDefaultStages(db, db.prepare("SELECT match_key AS matchKey, year, tournament FROM matches").all());
    const stage = readTournamentStructure(db, 2026, "Summer").stages[0];
    createSeries(db, 2026, "Summer", {
      matchKeys: [first, second],
      stageId: stage.stageId,
      roundLabel: "Final",
      bestOf: 3,
    }, editor);

    const structure = readTournamentStructure(db, 2026, "Summer");
    assert.equal(structure.games.length, 2);
    assert.equal(structure.series.length, 1);
    assert.deepEqual(structure.series[0].games.map((game) => game.gameNumber), [1, 2]);
    assert.deepEqual(structure.games.map((game) => game.stage.stageName), ["Tournament", "Tournament"]);
  } finally {
    db.close();
  }
});

test("stage edits override imported metadata and deleting a stage reassigns its games", () => {
  const db = createDb();
  try {
    const first = insertGame(db, 1);
    ensureDefaultStages(db, db.prepare("SELECT match_key AS matchKey, year, tournament FROM matches").all());
    const initial = readTournamentStructure(db, 2026, "Summer");
    const defaultStage = initial.stages[0];
    const extraStage = {
      stageId: "stage-playoffs",
      name: "Playoffs",
      format: "single-elimination",
      order: 2,
    };
    saveStages(db, 2026, "Summer", { stages: [{ ...defaultStage, name: "Qualifier", format: "round-robin" }, extraStage] }, editor);
    db.prepare("UPDATE tournament_stages SET name = 'Tournament' WHERE stage_id = ?").run(defaultStage.stageId);
    assert.equal(readTournamentStructure(db, 2026, "Summer").stages[0].name, "Qualifier");

    const current = readTournamentStructure(db, 2026, "Summer");
    const playoffs = current.stages.find((stage) => stage.stageId === "stage-playoffs");
    db.prepare("UPDATE csv_game_structure SET stage_id = ? WHERE match_key = ?").run(playoffs.stageId, first);
    saveStages(db, 2026, "Summer", { stages: [current.stages[0]] }, editor);

    const updated = readTournamentStructure(db, 2026, "Summer");
    assert.deepEqual(updated.stages.map((stage) => stage.name), ["Qualifier"]);
    assert.equal(updated.games[0].stageId, defaultStage.stageId);
  } finally {
    db.close();
  }
});

test("CSV re-ingestion preserves editor-created games, stage overrides, details, and bans", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "summerlol-structure-"));
  const csvPath = path.join(tempDir, "matches.csv");
  const dbPath = path.join(tempDir, "app.db");
  fs.writeFileSync(
    csvPath,
    "Year,Tournament,Team 1,Team 2,Result,Match Order,Stage ID,Stage Name,Stage Format,Stage Order,Series ID,Series Round,Best Of\n" +
      "2026,Summer,Team A,Team B,Team A,1,stage-imported,Playoffs,single-elimination,2,series-imported,Final,3\n" +
      "2026,Summer,Team A,Team B,Team B,2,stage-imported,Playoffs,single-elimination,2,series-imported,Final,3\n",
  );
  try {
    ingestMatches(csvPath, { dbPath });
    const db = new Database(dbPath);
    try {
      const stage = readTournamentStructure(db, 2026, "Summer").stages[0];
      assert.equal(stage.stageId, "stage-imported");
      saveStages(db, 2026, "Summer", {
        stages: [{ ...stage, name: "Finals", format: "single-elimination" }],
      }, editor);
      const keys = db.prepare("SELECT match_key AS matchKey FROM matches ORDER BY match_order").all().map((row) => row.matchKey);
      assert.equal(keys.length, 2);
      const added = addGameToSeries(db, 2026, "Summer", "series-imported", {
        result: "team1",
      }, editor);
      ensureMatchDetailsSchema(db);
      db.prepare(
        "INSERT INTO match_details (match_key, player, champion, kills, deaths, assists, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(added.matchKey, "Player One", "Ahri", 5, 1, 7, "MID");
      db.prepare("INSERT INTO match_bans (match_key, side, champion) VALUES (?, ?, ?)").run(added.matchKey, 1, "Yasuo");
    } finally {
      db.close();
    }

    ingestMatches(csvPath, { dbPath });
    const dbAfter = new Database(dbPath);
    try {
      const structure = readTournamentStructure(dbAfter, 2026, "Summer");
      assert.equal(structure.games.length, 3);
      assert.equal(structure.stages[0].name, "Finals");
      assert.equal(structure.series[0].seriesId, "series-imported");
      assert.equal(structure.series[0].roundLabel, "Final");
      assert.deepEqual(structure.series[0].games.map((game) => game.gameNumber), [1, 2, 3]);
      assert.equal(dbAfter.prepare("SELECT COUNT(*) AS n FROM match_details").get().n, 1);
      assert.equal(dbAfter.prepare("SELECT COUNT(*) AS n FROM match_bans").get().n, 1);
      assert.equal(new Set(dbAfter.prepare("SELECT csv_row_index FROM matches").all().map((row) => row.csv_row_index)).size, 3);
    } finally {
      dbAfter.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
