// data/ingest-matches.js
// One-off/rerunnable loader for the head-to-head match CSV, mirroring the
// pattern of bootstrap-player-identities.js. Run with:
//   node data/ingest-matches.js path/to/lol-draft-match.csv
// Columns expected in the CSV: {Year} {Tournament} {Team 1} {Team 2} {Result} {Match Order} {Match Stage}
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { buildMatchKey } = require("../lib/match-identity");
const {
  defaultStageId,
  ensureDefaultStages,
  ensureTournamentStructureSchema,
} = require("../lib/tournament-structure");
const { ensureMatchDetailsSchema, tableColumns } = require("../lib/match-details-schema");
const DB_PATH = path.join(__dirname, "..", "..", "data", "app.db");

// Minimal RFC4180-ish line parser (handles quoted fields defensively even
// though the current export doesn't use any) -- consistent with the
// existing csvEscape() in server.js being the mirror-image of this.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\n") {
      if (field !== "" || row.length) pushRow();
    } else if (c === "\r") {
      /* skip, \n handles the row break */
    } else field += c;
  }
  if (field !== "" || row.length) pushRow();
  return rows;
}

// Loads the match CSV into the `matches` table of the DB at `dbPath` (the app's
// DB by default), replacing any previous contents. Returns how many matches
// were loaded. The CLI below is a thin wrapper; check-data.js calls this with a
// throwaway DB.
function ingestMatches(csvPath, { dbPath = DB_PATH } = {}) {
  const text = fs.readFileSync(csvPath, "utf8");
  const [header, ...rows] = parseCsv(text);

  const idx = {
    year: header.indexOf("Year"),
    tournament: header.indexOf("Tournament"),
    team1: header.indexOf("Team 1"),
    team2: header.indexOf("Team 2"),
    result: header.indexOf("Result"),
    matchOrder: header.indexOf("Match Order"),
  };
  for (const [key, i] of Object.entries(idx)) {
    if (i === -1)
      throw new Error(`Missing expected column for "${key}" in ${csvPath}`);
  }

  // Match Stage is context-only (e.g. "Finals", "Group Stage") -- unlike
  // the columns above, rating correctness never depends on it, so a CSV
  // that doesn't have this column yet just gets NULLs there instead of
  // failing ingestion entirely.
  const optionalIndexes = Object.fromEntries(
    ["Match Stage", "Stage ID", "Stage Name", "Stage Format", "Stage Order", "Series ID", "Series Round", "Best Of"].map(
      (column) => [column, header.indexOf(column)],
    ),
  );
  const optionalCell = (row, column) => {
    const index = optionalIndexes[column];
    return index === -1 ? "" : String(row[index] ?? "").trim();
  };

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  ensureTournamentStructureSchema(db);
  const editorCreatedMatches = db.prepare("SELECT * FROM editor_created_matches").all();
  const savedDetails =
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'match_details'").get()
      ? db
          .prepare(
            `SELECT match_key, player, champion, kills, deaths, assists, ${
              tableColumns(db, "match_details").includes("role") ? "role" : "NULL AS role"
            } FROM match_details`,
          )
          .all()
      : [];
  const savedBans =
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'match_bans'").get()
      ? db.prepare("SELECT match_key, side, champion FROM match_bans").all()
      : [];
  db.exec("DELETE FROM csv_game_structure");
  db.exec("DROP TABLE IF EXISTS match_details");
  db.exec("DROP TABLE IF EXISTS match_bans"); // keyed by match_key, same as match_details
  db.exec("DROP TABLE IF EXISTS matches");
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

  const insert = db.prepare(
    `INSERT INTO matches (year, tournament, team1, team2, result, csv_row_index, match_order, match_stage, match_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const findByKey = db.prepare(
    `SELECT csv_row_index, year, tournament, team1, team2, match_order, match_stage
     FROM matches WHERE match_key = ?`,
  );

  const insertMany = db.transaction((rows) => {
    rows.forEach((r, i) => {
      if (!r[idx.year]) return;
      const matchOrderVal = parseInt(r[idx.matchOrder], 10);
      if (Number.isNaN(matchOrderVal)) {
        throw new Error(
          `Row ${i + 2}: "Match Order" value "${r[idx.matchOrder]}" is not a valid integer`,
        );
      }
      const values = {
        year: parseInt(r[idx.year], 10),
        tournament: r[idx.tournament] || null,
        team1: r[idx.team1],
        team2: r[idx.team2],
        result: r[idx.result],
        matchStage: optionalCell(r, "Match Stage") || null,
        matchOrder: matchOrderVal,
      };
      const matchKey = buildMatchKey(values);

      try {
        insert.run(
          values.year,
          values.tournament,
          values.team1,
          values.team2,
          values.result,
          i, // csv_row_index -- position in file, top of file = 0
          values.matchOrder,
          values.matchStage,
          matchKey,
        );
      } catch (err) {
        if (
          err.code === "SQLITE_CONSTRAINT_UNIQUE" ||
          /UNIQUE constraint failed.*match_key/.test(err.message)
        ) {
          const existing = findByKey.get(matchKey);
          const existingDesc = existing
            ? `csv row ${existing.csv_row_index + 2} (year=${existing.year}, tournament=${existing.tournament}, ` +
              `team1=${existing.team1}, team2=${existing.team2}, match_order=${existing.match_order}, ` +
              `match_stage=${existing.match_stage})`
            : "an earlier row (details unavailable)";
          throw new Error(
            `Duplicate match_key "${matchKey}" at CSV row ${i + 2} ` +
              `(year=${values.year}, tournament=${values.tournament}, team1=${values.team1}, ` +
              `team2=${values.team2}, match_order=${values.matchOrder}, match_stage=${values.matchStage}). ` +
              `Already inserted from ${existingDesc}.`,
          );
        }
        // Not a uniqueness issue -- rethrow with row context so it's still traceable.
        throw new Error(`Row ${i + 2} (match_key "${matchKey}") failed to insert: ${err.message}`);
      }
    });
  });
  insertMany(rows);

  const importedMatches = db
    .prepare(
      `SELECT match_key AS matchKey, csv_row_index AS csvRowIndex, year, tournament, team1, team2, match_order AS matchOrder
       FROM matches ORDER BY match_order, csv_row_index`,
    )
    .all();
  const importedByRow = new Map(importedMatches.map((match) => [match.csvRowIndex, match]));
  const insertStage = db.prepare(
    `INSERT INTO tournament_stages
       (stage_id, year, tournament, name, format, stage_order)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(stage_id) DO UPDATE SET
       name = excluded.name, format = excluded.format, stage_order = excluded.stage_order,
       updated_at = datetime('now')`,
  );
  const insertSeries = db.prepare(
    `INSERT INTO tournament_series
       (series_id, year, tournament, stage_id, round_label, best_of)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(series_id) DO UPDATE SET
       stage_id = excluded.stage_id, round_label = excluded.round_label,
       best_of = excluded.best_of, updated_at = datetime('now')`,
  );
  const assignStructure = db.prepare(
    `INSERT INTO csv_game_structure (match_key, stage_id, series_id)
     VALUES (?, ?, ?)
     ON CONFLICT(match_key) DO UPDATE SET stage_id = excluded.stage_id, series_id = excluded.series_id`,
  );
  const importStructure = db.transaction(() => {
    ensureDefaultStages(
      db,
      importedMatches.filter((match) => !optionalCell(rows[match.csvRowIndex] || [], "Stage ID")),
    );
    const seenStages = new Map();
    const seenSeries = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row[idx.year]) continue;
      const match = importedByRow.get(i);
      if (!match) continue;
      const stageId = optionalCell(row, "Stage ID") || defaultStageId(match.year, match.tournament || "");
      const stageName = optionalCell(row, "Stage Name") || "Tournament";
      const stageFormat = optionalCell(row, "Stage Format") || "custom";
      if (stageName.length > 80) throw new Error(`Row ${i + 2}: "Stage Name" must be at most 80 characters`);
      const stageOrderText = optionalCell(row, "Stage Order");
      const stageOrder = stageOrderText ? Number(stageOrderText) : 1;
      if (!Number.isInteger(stageOrder) || stageOrder < 1) {
        throw new Error(`Row ${i + 2}: "Stage Order" must be a positive integer`);
      }
      const knownFormat = ["round-robin", "swiss", "single-elimination", "double-elimination", "custom"].includes(stageFormat);
      if (!knownFormat) throw new Error(`Row ${i + 2}: unsupported "Stage Format" value "${stageFormat}"`);
      const tournament = match.tournament || "";
      const stageData = { year: match.year, tournament, name: stageName, format: stageFormat, order: stageOrder };
      const priorStage = seenStages.get(stageId);
      if (priorStage && JSON.stringify(priorStage) !== JSON.stringify(stageData)) {
        throw new Error(`Row ${i + 2}: rows sharing Stage ID "${stageId}" must use identical stage metadata`);
      }
      seenStages.set(stageId, stageData);
      const stageOwner = db
        .prepare("SELECT year, tournament FROM tournament_stages WHERE stage_id = ?")
        .get(stageId);
      if (stageOwner && (stageOwner.year !== match.year || stageOwner.tournament !== tournament)) {
        throw new Error(`Row ${i + 2}: Stage ID "${stageId}" is already used by another tournament`);
      }
      insertStage.run(stageId, match.year, match.tournament || "", stageName, stageFormat, stageOrder);

      const seriesId = optionalCell(row, "Series ID") || null;
      const bestOfText = optionalCell(row, "Best Of");
      const bestOf = bestOfText ? Number(bestOfText) : null;
      const roundLabel = optionalCell(row, "Series Round") || null;
      if (roundLabel?.length > 80) throw new Error(`Row ${i + 2}: "Series Round" must be at most 80 characters`);
      if (bestOf != null && ![1, 3, 5, 7].includes(bestOf)) {
        throw new Error(`Row ${i + 2}: "Best Of" must be 1, 3, 5, or 7`);
      }
      if (seriesId) {
        const teamPair = [match.team1.toLowerCase(), match.team2.toLowerCase()].sort();
        const seriesData = {
          year: match.year,
          tournament,
          stageId,
          roundLabel,
          bestOf,
          teamPair,
        };
        const priorSeries = seenSeries.get(seriesId);
        if (priorSeries && JSON.stringify(priorSeries) !== JSON.stringify(seriesData)) {
          throw new Error(`Row ${i + 2}: rows sharing Series ID "${seriesId}" must use identical stage, round, best-of, and teams`);
        }
        seenSeries.set(seriesId, seriesData);
        const seriesOwner = db
          .prepare("SELECT year, tournament FROM tournament_series WHERE series_id = ?")
          .get(seriesId);
        if (seriesOwner && (seriesOwner.year !== match.year || seriesOwner.tournament !== tournament)) {
          throw new Error(`Row ${i + 2}: Series ID "${seriesId}" is already used by another tournament`);
        }
        insertSeries.run(
          seriesId,
          match.year,
          tournament,
          stageId,
          roundLabel,
          bestOf,
        );
      }
      assignStructure.run(match.matchKey, stageId, seriesId);
    }

    let nextEditorRowIndex =
      db.prepare("SELECT COALESCE(MAX(csv_row_index), -1) + 1 AS n FROM matches").get().n;
    const restoreEditorMatch = db.prepare(
      `INSERT OR IGNORE INTO matches
       (year, tournament, team1, team2, result, csv_row_index, match_order, match_stage, match_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateEditorRowIndex = db.prepare(
      "UPDATE editor_created_matches SET csv_row_index = ? WHERE match_key = ?",
    );
    for (const match of [...editorCreatedMatches].sort((a, b) => a.match_order - b.match_order)) {
      const rowIndex = nextEditorRowIndex++;
      const restored = restoreEditorMatch.run(
        match.year,
        match.tournament,
        match.team1,
        match.team2,
        match.result,
        rowIndex,
        match.match_order,
        match.match_stage,
        match.match_key,
      );
      if (restored.changes) updateEditorRowIndex.run(rowIndex, match.match_key);
    }
    ensureDefaultStages(
      db,
      db
        .prepare(
          `SELECT match_key AS matchKey, year, tournament, match_order AS matchOrder
           FROM matches ORDER BY match_order`,
        )
        .all(),
    );
  });
  importStructure();

  ensureMatchDetailsSchema(db);
  const importedKeys = new Set(
    db.prepare("SELECT match_key FROM matches").all().map((row) => row.match_key),
  );
  const restoreDetail = db.prepare(
    `INSERT INTO match_details
     (match_key, player, champion, kills, deaths, assists, role)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const detail of savedDetails) {
    if (!importedKeys.has(detail.match_key)) continue;
    restoreDetail.run(
      detail.match_key,
      detail.player,
      detail.champion,
      detail.kills,
      detail.deaths,
      detail.assists,
      detail.role,
    );
  }
  const restoreBan = db.prepare(
    "INSERT OR IGNORE INTO match_bans (match_key, side, champion) VALUES (?, ?, ?)",
  );
  for (const ban of savedBans) {
    if (importedKeys.has(ban.match_key)) restoreBan.run(ban.match_key, ban.side, ban.champion);
  }

  const { n } = db.prepare("SELECT COUNT(*) AS n FROM matches").get();
  db.close();
  return n;
}

if (require.main === module) {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: node data/ingest-matches.js <path-to-match-csv>");
    process.exit(1);
  }
  const n = ingestMatches(csvPath);
  console.log(`Loaded ${n} matches into ${DB_PATH}`);
}

module.exports = { parseCsv, ingestMatches, DB_PATH };