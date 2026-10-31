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
  updateGameRounds,
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

function seedRoundRobin(db) {
  const keys = [
    insertGame(db, 1, { team1: "Alpha", team2: "Beta", result: "Alpha" }),
    insertGame(db, 2, { team1: "Gamma", team2: "Delta", result: "Delta" }),
    insertGame(db, 3, { team1: "Alpha", team2: "Gamma", result: "Gamma" }),
  ];
  ensureDefaultStages(db, db.prepare("SELECT match_key AS matchKey, year, tournament FROM matches").all());
  return { keys, stage: readTournamentStructure(db, 2026, "Summer").stages[0] };
}

test("round-robin stages store a defined number of named groups with team allocation", () => {
  const db = createDb();
  try {
    const { stage } = seedRoundRobin(db);
    const saved = saveStages(db, 2026, "Summer", {
      stages: [{
        ...stage,
        format: "round-robin",
        groups: [
          { name: "Group A", teams: ["Alpha", "beta"] },
          { name: " Group B ", teams: ["Gamma", "Delta"] },
        ],
      }],
    }, editor);
    const groups = saved.stages[0].groups;
    assert.deepEqual(groups.map((group) => [group.name, group.order]), [["Group A", 1], ["Group B", 2]]);
    // Teams are stored with the spelling the matches table uses.
    assert.deepEqual(groups[0].teams, ["Alpha", "Beta"]);
    assert.deepEqual(groups[1].teams, ["Gamma", "Delta"]);

    // Saving again with the returned IDs keeps them stable; renaming and
    // reallocating replaces the old rows rather than appending.
    const resaved = saveStages(db, 2026, "Summer", {
      stages: [{
        ...saved.stages[0],
        groups: [
          { ...groups[0], name: "Alpha Group", teams: ["Alpha"] },
          { ...groups[1], teams: ["Gamma", "Delta", "Beta"] },
        ],
      }],
    }, editor);
    assert.deepEqual(resaved.stages[0].groups.map((group) => group.groupId), groups.map((group) => group.groupId));
    assert.deepEqual(resaved.stages[0].groups.map((group) => group.name), ["Alpha Group", "Group B"]);
    assert.deepEqual(resaved.stages[0].groups[1].teams, ["Gamma", "Delta", "Beta"]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tournament_stage_group_teams").get().n, 4);
  } finally {
    db.close();
  }
});

test("omitting groups leaves them alone, an empty list clears them, and removing a stage drops them", () => {
  const db = createDb();
  try {
    const { stage } = seedRoundRobin(db);
    const withGroups = saveStages(db, 2026, "Summer", {
      stages: [{ ...stage, format: "round-robin", groups: [{ name: "A", teams: ["Alpha", "Beta"] }] }],
    }, editor);
    const { groups: _ignored, ...withoutGroupsKey } = withGroups.stages[0];
    const untouched = saveStages(db, 2026, "Summer", { stages: [{ ...withoutGroupsKey, name: "Renamed" }] }, editor);
    assert.equal(untouched.stages[0].groups.length, 1);

    const cleared = saveStages(db, 2026, "Summer", { stages: [{ ...untouched.stages[0], groups: [] }] }, editor);
    assert.deepEqual(cleared.stages[0].groups, []);

    saveStages(db, 2026, "Summer", {
      stages: [
        { ...cleared.stages[0], groups: [{ name: "A", teams: ["Alpha"] }] },
        { stageId: "stage-playoffs", name: "Playoffs", format: "single-elimination", order: 2 },
      ],
    }, editor);
    const current = readTournamentStructure(db, 2026, "Summer");
    saveStages(db, 2026, "Summer", { stages: [current.stages[1]] }, editor);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tournament_stage_groups").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tournament_stage_group_teams").get().n, 0);
  } finally {
    db.close();
  }
});

test("group definitions are validated", () => {
  const db = createDb();
  try {
    const { stage } = seedRoundRobin(db);
    const save = (groups, format = "round-robin") =>
      saveStages(db, 2026, "Summer", { stages: [{ ...stage, format, groups }] }, editor);
    assert.throws(() => save([{ name: "A", teams: ["Alpha", "Nobody"] }]), /Unknown team/);
    assert.throws(() => save([{ name: "A", teams: ["Alpha"] }, { name: "B", teams: ["alpha"] }]), /both A and B/);
    assert.throws(() => save([{ name: "A", teams: ["Alpha", "ALPHA"] }]), /listed twice/);
    assert.throws(() => save([{ name: "A", teams: [] }, { name: "a", teams: [] }]), /Duplicate group name/);
    assert.throws(() => save([{ name: "  ", teams: [] }]), /Group names/);
    assert.throws(() => save([{ name: "A" }]), /list its teams/);
    assert.throws(() => save("nope"), /must be a list/);
    assert.throws(
      () => save(Array.from({ length: 17 }, (_, i) => ({ name: `G${i}`, teams: [] }))),
      /at most 16/,
    );
    assert.throws(() => save([{ name: "A", teams: ["Alpha"] }], "swiss"), /only be defined on round-robin/);
    // Nothing from the failed saves leaked through.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tournament_stage_groups").get().n, 0);
  } finally {
    db.close();
  }
});

test("a client cannot reuse a group ID from another stage", () => {
  const db = createDb();
  try {
    const { stage } = seedRoundRobin(db);
    const first = saveStages(db, 2026, "Summer", {
      stages: [
        { ...stage, format: "round-robin", groups: [{ name: "A", teams: ["Alpha"] }] },
        { stageId: "stage-b", name: "Second", format: "round-robin", order: 2, groups: [] },
      ],
    }, editor);
    const stolenId = first.stages[0].groups[0].groupId;
    const second = saveStages(db, 2026, "Summer", {
      stages: [
        first.stages[0],
        { ...first.stages[1], groups: [{ groupId: stolenId, name: "B", teams: ["Gamma"] }] },
      ],
    }, editor);
    assert.notEqual(second.stages[1].groups[0].groupId, stolenId);
    assert.deepEqual(second.stages[0].groups[0].teams, ["Alpha"]);
  } finally {
    db.close();
  }
});

test("rounds are stored per game, are independent of the series label, and a series shares one", () => {
  const db = createDb();
  try {
    const { keys, stage } = seedRoundRobin(db);
    const [ab, gd, ag] = keys;
    // A second Alpha-Beta game so there is a series to propagate through.
    const ab2 = insertGame(db, 4, { team1: "Alpha", team2: "Beta", result: "Beta" });
    ensureDefaultStages(db, db.prepare("SELECT match_key AS matchKey, year, tournament FROM matches").all());
    createSeries(db, 2026, "Summer", { stageId: stage.stageId, matchKeys: [ab, ab2], roundLabel: "Quarterfinal", bestOf: 3 }, editor);

    const saved = updateGameRounds(db, 2026, "Summer", {
      rounds: [{ matchKey: ab, round: " Week 1 " }, { matchKey: gd, round: "Week 1" }, { matchKey: ag, round: "Week 2" }],
    }, editor);
    const byKey = new Map(saved.games.map((game) => [game.matchKey, game]));
    assert.equal(byKey.get(ab).round, "Week 1");
    // The other game of the series follows it; the series label is untouched.
    assert.equal(byKey.get(ab2).round, "Week 1");
    assert.equal(byKey.get(ab2).series.roundLabel, "Quarterfinal");
    assert.equal(byKey.get(ag).round, "Week 2");

    // Re-ingest-style changes to stage assignment do not disturb rounds, and
    // an empty round clears (for the whole series).
    const cleared = updateGameRounds(db, 2026, "Summer", { rounds: [{ matchKey: ab2, round: "" }, { matchKey: ag, round: null }] }, editor);
    assert.deepEqual(cleared.games.map((game) => game.round), [null, "Week 1", null, null]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_rounds").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tournament_structure_audit").get().n >= 2, true);
  } finally {
    db.close();
  }
});

test("round assignments are validated", () => {
  const db = createDb();
  try {
    const { keys } = seedRoundRobin(db);
    const run = (rounds) => updateGameRounds(db, 2026, "Summer", { rounds }, editor);
    assert.throws(() => updateGameRounds(db, 2026, "Summer", {}, editor), /must be a list/);
    assert.throws(() => run([{ round: "R1" }]), /match key/);
    assert.throws(() => run([{ matchKey: keys[0], round: 3 }]), /must be text/);
    assert.throws(() => run([{ matchKey: keys[0], round: "x".repeat(81) }]), /at most 80/);
    assert.throws(() => run([{ matchKey: "nope", round: "R1" }]), /not found/);
    assert.throws(() => run([{ matchKey: keys[0], round: "A" }, { matchKey: keys[0], round: "B" }]), /only be assigned once/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_rounds").get().n, 0);
  } finally {
    db.close();
  }
});
