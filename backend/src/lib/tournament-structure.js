const crypto = require("crypto");
const { buildMatchKey } = require("./match-identity");

const STAGE_FORMATS = new Set([
  "round-robin",
  "swiss",
  "single-elimination",
  "double-elimination",
  "custom",
]);

const MAX_GROUPS_PER_STAGE = 16;
const MAX_GROUP_NAME_LENGTH = 40;

class StructureValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "StructureValidationError";
    this.status = 400;
  }
}

class StructureNotFoundError extends Error {
  constructor(message = "Tournament structure target not found") {
    super(message);
    this.name = "StructureNotFoundError";
    this.status = 404;
  }
}

function ensureTournamentStructureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournament_stages (
      stage_id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      tournament TEXT NOT NULL,
      name TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'custom',
      stage_order INTEGER NOT NULL,
      created_by_sub TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (format IN ('round-robin', 'swiss', 'single-elimination', 'double-elimination', 'custom'))
    );
    CREATE TABLE IF NOT EXISTS tournament_stage_overrides (
      stage_id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      tournament TEXT NOT NULL,
      name TEXT NOT NULL,
      format TEXT NOT NULL,
      stage_order INTEGER NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      edited_by_sub TEXT NOT NULL,
      edited_by_email TEXT,
      edited_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (format IN ('round-robin', 'swiss', 'single-elimination', 'double-elimination', 'custom'))
    );
    CREATE INDEX IF NOT EXISTS tournament_stages_scope
      ON tournament_stages(year, tournament, stage_order);

    CREATE TABLE IF NOT EXISTS tournament_series (
      series_id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      tournament TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      round_label TEXT,
      best_of INTEGER,
      created_by_sub TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (best_of IS NULL OR best_of IN (1, 3, 5, 7))
    );
    CREATE INDEX IF NOT EXISTS tournament_series_scope
      ON tournament_series(year, tournament, stage_id);

    CREATE TABLE IF NOT EXISTS csv_game_structure (
      match_key TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      series_id TEXT
    );

    CREATE TABLE IF NOT EXISTS game_structure_overrides (
      match_key TEXT PRIMARY KEY,
      stage_id TEXT,
      series_id TEXT,
      edited_by_sub TEXT NOT NULL,
      edited_by_email TEXT,
      edited_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS editor_created_matches (
      match_key TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      tournament TEXT NOT NULL,
      team1 TEXT NOT NULL,
      team2 TEXT NOT NULL,
      result TEXT NOT NULL,
      csv_row_index INTEGER NOT NULL,
      match_order INTEGER NOT NULL,
      match_stage TEXT
    );

    CREATE TABLE IF NOT EXISTS tournament_stage_groups (
      group_id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      name TEXT NOT NULL,
      group_order INTEGER NOT NULL,
      edited_by_sub TEXT,
      edited_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS tournament_stage_groups_stage
      ON tournament_stage_groups(stage_id, group_order);
    CREATE TABLE IF NOT EXISTS tournament_stage_group_teams (
      group_id TEXT NOT NULL,
      team TEXT NOT NULL,
      team_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (group_id, team)
    );

    CREATE TABLE IF NOT EXISTS tournament_structure_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      tournament TEXT NOT NULL,
      edited_by_sub TEXT NOT NULL,
      edited_by_email TEXT,
      edited_at TEXT NOT NULL DEFAULT (datetime('now')),
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL
    );
  `);
}

function structureForMatches(db, matches) {
  const keys = matches.map((match) => match.matchKey).filter(Boolean);
  if (!keys.length) return new Map();
  const placeholders = keys.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT m.match_key AS matchKey,
              CASE WHEN so.is_deleted = 1 THEN NULL
                   WHEN so.stage_id IS NOT NULL THEN so.stage_id
                   ELSE s.stage_id END AS stageId,
              CASE WHEN so.is_deleted = 1 THEN NULL
                   WHEN so.stage_id IS NOT NULL THEN so.name ELSE s.name END AS stageName,
              CASE WHEN so.is_deleted = 1 THEN NULL
                   WHEN so.stage_id IS NOT NULL THEN so.format ELSE s.format END AS stageFormat,
              CASE WHEN so.is_deleted = 1 THEN NULL
                   WHEN so.stage_id IS NOT NULL THEN so.stage_order ELSE s.stage_order END AS stageOrder,
              CASE WHEN o.match_key IS NOT NULL THEN o.series_id ELSE c.series_id END AS seriesId,
              ts.round_label AS seriesRound, ts.best_of AS bestOf
       FROM matches m
       LEFT JOIN csv_game_structure c ON c.match_key = m.match_key
       LEFT JOIN game_structure_overrides o ON o.match_key = m.match_key
       LEFT JOIN tournament_stages s
         ON s.stage_id = CASE WHEN o.match_key IS NOT NULL THEN o.stage_id ELSE c.stage_id END
       LEFT JOIN tournament_stage_overrides so ON so.stage_id = s.stage_id
       LEFT JOIN tournament_series ts
         ON ts.series_id = CASE WHEN o.match_key IS NOT NULL THEN o.series_id ELSE c.series_id END
       WHERE m.match_key IN (${placeholders})`,
    )
    .all(...keys);
  const structure = new Map();
  for (const row of rows) {
    structure.set(row.matchKey, {
      stageId: row.stageId,
      stage: row.stageId
        ? {
            stageId: row.stageId,
            stageName: row.stageName,
            stageFormat: row.stageFormat,
            stageOrder: row.stageOrder,
          }
        : null,
      seriesId: row.seriesId,
      series: row.seriesId
        ? { seriesId: row.seriesId, roundLabel: row.seriesRound, bestOf: row.bestOf }
        : null,
    });
  }
  return structure;
}

function ensureDefaultStages(db, matches) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO tournament_stages
      (stage_id, year, tournament, name, format, stage_order)
    VALUES (?, ?, ?, 'Tournament', 'custom', 1)
  `);
  const assign = db.prepare(`
    INSERT OR IGNORE INTO csv_game_structure (match_key, stage_id, series_id)
    VALUES (?, ?, NULL)
  `);
  const hasStructure = db.prepare(
    `SELECT 1 FROM csv_game_structure WHERE match_key = ?
     UNION ALL SELECT 1 FROM game_structure_overrides WHERE match_key = ?
     LIMIT 1`,
  );
  for (const match of matches) {
    if (hasStructure.get(match.matchKey, match.matchKey)) continue;
    const tournament = match.tournament || "";
    const stageId = defaultStageId(match.year, tournament);
    insert.run(stageId, match.year, tournament);
    assign.run(match.matchKey, stageId);
  }
}

function defaultStageId(year, tournament) {
  const slug = String(tournament || "tournament")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = crypto.createHash("sha256").update(String(tournament || "")).digest("hex").slice(0, 8);
  return `stage-${year}-${slug || "tournament"}-${suffix}-default`;
}


// Round-robin groups are editor-defined only (never imported from CSV), so they
// live in plain tables rather than base + override pairs. A group is a name, an
// order and a list of team names exactly as they appear in the matches table;
// a game belongs to a group when both of its teams do.
function readStageGroups(db, stageIds) {
  const ids = [...new Set(stageIds)];
  const byStage = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return byStage;
  const placeholders = ids.map(() => "?").join(",");
  const groups = db
    .prepare(
      `SELECT group_id AS groupId, stage_id AS stageId, name, group_order AS "order"
       FROM tournament_stage_groups
       WHERE stage_id IN (${placeholders})
       ORDER BY group_order, name`,
    )
    .all(...ids);
  if (!groups.length) return byStage;
  const teamsByGroup = new Map();
  const teamRows = db
    .prepare(
      `SELECT group_id AS groupId, team FROM tournament_stage_group_teams
       WHERE group_id IN (${groups.map(() => "?").join(",")})
       ORDER BY team_order, team`,
    )
    .all(...groups.map((group) => group.groupId));
  for (const row of teamRows) {
    if (!teamsByGroup.has(row.groupId)) teamsByGroup.set(row.groupId, []);
    teamsByGroup.get(row.groupId).push(row.team);
  }
  for (const group of groups) {
    byStage.get(group.stageId).push({ ...group, teams: teamsByGroup.get(group.groupId) || [] });
  }
  return byStage;
}

// Every stage's groups for the public tournaments summary, keyed by stage ID.
function readAllStageGroups(db) {
  const stageIds = db.prepare("SELECT DISTINCT stage_id AS stageId FROM tournament_stage_groups").all().map((row) => row.stageId);
  return readStageGroups(db, stageIds);
}

function tournamentTeamNames(db, year, tournament) {
  const rows = db
    .prepare(
      `SELECT team1, team2 FROM matches
       WHERE year = ? AND COALESCE(tournament, '') = ?
       ORDER BY match_order, csv_row_index`,
    )
    .all(year, tournament);
  const canonical = new Map();
  for (const row of rows) {
    for (const team of [row.team1, row.team2]) {
      const key = String(team || "").trim().toLowerCase();
      if (key && !canonical.has(key)) canonical.set(key, team);
    }
  }
  return canonical;
}

// Checks a stage's group list against the tournament and returns it in a
// normalised shape (trimmed names, teams spelled as the matches table spells
// them). Throws StructureValidationError for anything the display could not
// make sense of: duplicate names, a team in two groups, an unknown team.
function normalizeGroups(stageName, format, groups, teamNames, existingGroupIds) {
  if (groups == null) return null;
  if (!Array.isArray(groups)) throw new StructureValidationError("Stage groups must be a list");
  if (groups.length && format !== "round-robin") {
    throw new StructureValidationError(`Groups can only be defined on round-robin stages (${stageName})`);
  }
  if (groups.length > MAX_GROUPS_PER_STAGE) {
    throw new StructureValidationError(`A stage can have at most ${MAX_GROUPS_PER_STAGE} groups`);
  }
  const names = new Set();
  const groupIds = new Set();
  const assigned = new Map();
  return groups.map((group, index) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      throw new StructureValidationError("Each group must be an object");
    }
    const name = typeof group.name === "string" ? group.name.trim() : "";
    if (!name || name.length > MAX_GROUP_NAME_LENGTH) {
      throw new StructureValidationError(`Group names must be 1 to ${MAX_GROUP_NAME_LENGTH} characters`);
    }
    if (names.has(name.toLowerCase())) throw new StructureValidationError(`Duplicate group name: ${name}`);
    names.add(name.toLowerCase());
    if (!Array.isArray(group.teams)) throw new StructureValidationError(`Group ${name} must list its teams`);
    const teams = group.teams.map((team) => {
      const canonical = teamNames.get(String(team ?? "").trim().toLowerCase());
      if (!canonical) throw new StructureValidationError(`Unknown team in group ${name}: ${team}`);
      const owner = assigned.get(canonical.toLowerCase());
      if (owner !== undefined) {
        throw new StructureValidationError(
          owner === name ? `${canonical} is listed twice in group ${name}` : `${canonical} is in both ${owner} and ${name}`,
        );
      }
      assigned.set(canonical.toLowerCase(), name);
      return canonical;
    });
    // Keep a client-supplied ID only when it already belongs to this stage;
    // anything else gets a fresh one so IDs can't be claimed across stages.
    let groupId = typeof group.groupId === "string" && existingGroupIds.has(group.groupId) ? group.groupId : "";
    if (!groupId || groupIds.has(groupId)) groupId = `group-${crypto.randomUUID()}`;
    groupIds.add(groupId);
    return { groupId, name, order: index + 1, teams };
  });
}

function replaceStageGroups(db, stageId, groups, editor) {
  const oldIds = db.prepare("SELECT group_id AS groupId FROM tournament_stage_groups WHERE stage_id = ?").all(stageId);
  const deleteTeams = db.prepare("DELETE FROM tournament_stage_group_teams WHERE group_id = ?");
  for (const { groupId } of oldIds) deleteTeams.run(groupId);
  db.prepare("DELETE FROM tournament_stage_groups WHERE stage_id = ?").run(stageId);
  const insertGroup = db.prepare(
    `INSERT INTO tournament_stage_groups (group_id, stage_id, name, group_order, edited_by_sub, edited_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  );
  const insertTeam = db.prepare(
    "INSERT INTO tournament_stage_group_teams (group_id, team, team_order) VALUES (?, ?, ?)",
  );
  for (const group of groups) {
    insertGroup.run(group.groupId, stageId, group.name, group.order, editor.sub);
    group.teams.forEach((team, teamIndex) => insertTeam.run(group.groupId, team, teamIndex));
  }
}

function readTournamentStructure(db, year, tournament) {
  const stages = db
    .prepare(
      `SELECT s.stage_id AS stageId, s.year, s.tournament,
              COALESCE(o.name, s.name) AS name,
              COALESCE(o.format, s.format) AS format,
              COALESCE(o.stage_order, s.stage_order) AS stageOrder
       FROM tournament_stages s
       LEFT JOIN tournament_stage_overrides o ON o.stage_id = s.stage_id
       WHERE s.year = ? AND s.tournament = ? AND COALESCE(o.is_deleted, 0) = 0
       ORDER BY COALESCE(o.stage_order, s.stage_order), COALESCE(o.name, s.name)`,
    )
    .all(year, tournament);
  const groupsByStage = readStageGroups(db, stages.map((stage) => stage.stageId));
  for (const stage of stages) stage.groups = groupsByStage.get(stage.stageId) || [];
  const matches = db
    .prepare(
      `SELECT match_key AS matchKey, year, tournament, team1, team2, result,
              match_order AS matchOrder, match_stage AS matchStage
       FROM matches
       WHERE year = ? AND COALESCE(tournament, '') = ?
       ORDER BY match_order, csv_row_index`,
    )
    .all(year, tournament);
  const structure = structureForMatches(db, matches);
  const seriesRows = db
    .prepare(
      `SELECT series_id AS seriesId, stage_id AS stageId, round_label AS roundLabel,
              best_of AS bestOf, created_at AS createdAt
       FROM tournament_series
       WHERE year = ? AND tournament = ?
       ORDER BY stage_id, round_label, created_at`,
    )
    .all(year, tournament);
  const gameNumbers = new Map();
  const seriesCounts = new Map();
  for (const match of matches) {
    const seriesId = structure.get(match.matchKey)?.seriesId;
    if (!seriesId) continue;
    const gameNumber = (seriesCounts.get(seriesId) || 0) + 1;
    seriesCounts.set(seriesId, gameNumber);
    gameNumbers.set(match.matchKey, gameNumber);
  }
  return {
    year,
    tournament,
    stages,
    series: seriesRows.map((series) => ({
      ...series,
      games: matches
        .filter((match) => structure.get(match.matchKey)?.seriesId === series.seriesId)
        .map((match, index) => ({ ...match, gameNumber: index + 1 })),
    })),
    games: matches.map((match) => ({
      ...match,
      ...structure.get(match.matchKey),
      gameNumber: gameNumbers.get(match.matchKey) || null,
    })),
  };
}

function snapshotStructure(db, year, tournament) {
  return JSON.stringify(readTournamentStructure(db, year, tournament));
}

function auditStructure(db, year, tournament, editor, before) {
  db.prepare(
    `INSERT INTO tournament_structure_audit
       (year, tournament, edited_by_sub, edited_by_email, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(year, tournament, editor.sub, editor.email, before, snapshotStructure(db, year, tournament));
}

function validateScope(db, year, tournament) {
  if (!Number.isInteger(year) || typeof tournament !== "string" || !tournament.trim()) {
    throw new StructureValidationError("A valid tournament year and name are required");
  }
  const exists = db
    .prepare(
      `SELECT 1 FROM matches WHERE year = ? AND COALESCE(tournament, '') = ? LIMIT 1`,
    )
    .get(year, tournament);
  if (!exists) throw new StructureNotFoundError("Tournament not found");
}

function saveStages(db, year, tournament, body, editor) {
  validateScope(db, year, tournament);
  if (!body || !Array.isArray(body.stages) || !body.stages.length) {
    throw new StructureValidationError("A tournament must have at least one stage");
  }
  const seen = new Set();
  const seenIds = new Set();
  const teamNames = tournamentTeamNames(db, year, tournament);
  const stages = body.stages.map((stage, index) => {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      throw new StructureValidationError("Each stage must be an object");
    }
    const name = typeof stage.name === "string" ? stage.name.trim() : "";
    const format = stage.format;
    const order = stage.order ?? index + 1;
    if (!name || name.length > 80) throw new StructureValidationError("Stage names must be 1 to 80 characters");
    if (!STAGE_FORMATS.has(format)) throw new StructureValidationError(`Unsupported stage format: ${format}`);
    if (!Number.isInteger(order) || order < 1) throw new StructureValidationError("Stage order must be a positive integer");
    if (seen.has(order)) throw new StructureValidationError("Stage orders must be unique");
    seen.add(order);
    const stageId = typeof stage.stageId === "string" && stage.stageId ? stage.stageId : `stage-${crypto.randomUUID()}`;
    if (seenIds.has(stageId)) throw new StructureValidationError("Stage IDs must be unique");
    seenIds.add(stageId);
    const existingGroupIds = new Set(
      db.prepare("SELECT group_id AS groupId FROM tournament_stage_groups WHERE stage_id = ?").all(stageId).map((row) => row.groupId),
    );
    return {
      stageId,
      name,
      format,
      order,
      // null = the caller did not mention groups, so leave them as they are.
      groups: normalizeGroups(name, format, stage.groups, teamNames, existingGroupIds),
    };
  });
  const before = snapshotStructure(db, year, tournament);
  const current = JSON.parse(before);
  const save = db.transaction(() => {
    const currentIds = new Set(
      current.stages.map((stage) => stage.stageId),
    );
    const nextIds = new Set(stages.map((stage) => stage.stageId));
    for (const stage of stages) {
      const owner = db
        .prepare("SELECT year, tournament FROM tournament_stages WHERE stage_id = ?")
        .get(stage.stageId);
      if (owner && (owner.year !== year || owner.tournament !== tournament)) {
        throw new StructureValidationError("Stage IDs must be unique across tournaments");
      }
      db.prepare(
        `INSERT INTO tournament_stages
          (stage_id, year, tournament, name, format, stage_order, created_by_sub, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(stage_id) DO NOTHING`,
      ).run(stage.stageId, year, tournament, stage.name, stage.format, stage.order, editor.sub);
      db.prepare(
        `INSERT INTO tournament_stage_overrides
          (stage_id, year, tournament, name, format, stage_order, is_deleted, edited_by_sub, edited_by_email, edited_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now'))
         ON CONFLICT(stage_id) DO UPDATE SET
           name = excluded.name, format = excluded.format, stage_order = excluded.stage_order,
           is_deleted = 0, edited_by_sub = excluded.edited_by_sub,
           edited_by_email = excluded.edited_by_email, edited_at = datetime('now')`,
      ).run(stage.stageId, year, tournament, stage.name, stage.format, stage.order, editor.sub, editor.email);
      if (stage.groups) replaceStageGroups(db, stage.stageId, stage.groups, editor);
    }
    for (const stageId of currentIds) {
      if (nextIds.has(stageId)) continue;
      const hasSeries = current.games.some((game) => game.stageId === stageId && game.seriesId);
      if (hasSeries) throw new StructureValidationError("Move or remove this stage's series before deleting the stage");
      const fallbackStageId = stages[0].stageId;
      const updateGame = db.prepare(
        `INSERT INTO game_structure_overrides
          (match_key, stage_id, series_id, edited_by_sub, edited_by_email, edited_at)
         VALUES (?, ?, NULL, ?, ?, datetime('now'))
         ON CONFLICT(match_key) DO UPDATE SET
           stage_id = excluded.stage_id, series_id = NULL,
           edited_by_sub = excluded.edited_by_sub, edited_by_email = excluded.edited_by_email,
           edited_at = datetime('now')`,
      );
      for (const game of current.games.filter((item) => item.stageId === stageId)) {
        updateGame.run(game.matchKey, fallbackStageId, editor.sub, editor.email);
      }
      replaceStageGroups(db, stageId, [], editor);
      const oldStage = current.stages.find((stage) => stage.stageId === stageId);
      db.prepare(
        `INSERT INTO tournament_stage_overrides
          (stage_id, year, tournament, name, format, stage_order, is_deleted, edited_by_sub, edited_by_email, edited_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'))
         ON CONFLICT(stage_id) DO UPDATE SET
           is_deleted = 1, edited_by_sub = excluded.edited_by_sub,
           edited_by_email = excluded.edited_by_email, edited_at = datetime('now')`,
      ).run(stageId, year, tournament, oldStage.name, oldStage.format, oldStage.stageOrder, editor.sub, editor.email);
    }
    auditStructure(db, year, tournament, editor, before);
  });
  save();
  return readTournamentStructure(db, year, tournament);
}

function createSeries(db, year, tournament, body, editor) {
  validateScope(db, year, tournament);
  if (!body || !Array.isArray(body.matchKeys) || body.matchKeys.length < 2) {
    throw new StructureValidationError("Select at least two games to group into a series");
  }
  if (body.matchKeys.some((key) => typeof key !== "string" || !key)) {
    throw new StructureValidationError("Every selected game must have a match key");
  }
  const stageId = body.stageId;
  if (typeof stageId !== "string" || !stageId) {
    throw new StructureValidationError("Choose a stage in this tournament");
  }
  const stage = db
    .prepare(
      `SELECT 1 FROM tournament_stages s
       LEFT JOIN tournament_stage_overrides o ON o.stage_id = s.stage_id
       WHERE s.stage_id = ? AND s.year = ? AND s.tournament = ? AND COALESCE(o.is_deleted, 0) = 0`,
    )
    .get(stageId, year, tournament);
  if (!stage) throw new StructureValidationError("Choose a stage in this tournament");
  const bestOf = body.bestOf == null || body.bestOf === "" ? null : Number(body.bestOf);
  if (bestOf != null && ![1, 3, 5, 7].includes(bestOf)) throw new StructureValidationError("Best-of must be 1, 3, 5, or 7");
  const roundLabel = typeof body.roundLabel === "string" ? body.roundLabel.trim() : "";
  if (roundLabel.length > 80) throw new StructureValidationError("Round label must be at most 80 characters");
  const games = db
    .prepare(
      `SELECT match_key AS matchKey, team1, team2, year, tournament
       FROM matches WHERE match_key IN (${body.matchKeys.map(() => "?").join(",")})`,
    )
    .all(...body.matchKeys);
  if (games.length !== new Set(body.matchKeys).size || games.length !== body.matchKeys.length) {
    throw new StructureValidationError("One or more selected games do not exist");
  }
  if (games.some((game) => game.year !== year || (game.tournament || "") !== tournament)) {
    throw new StructureValidationError("All selected games must be from this tournament");
  }
  const teamPair = new Set(games.flatMap((game) => [game.team1, game.team2]).map((team) => team.toLowerCase()));
  if (teamPair.size !== 2) throw new StructureValidationError("A series must contain games between the same two teams");
  const before = snapshotStructure(db, year, tournament);
  const seriesId = `series-${crypto.randomUUID()}`;
  const save = db.transaction(() => {
    db.prepare(
      `INSERT INTO tournament_series
       (series_id, year, tournament, stage_id, round_label, best_of, created_by_sub)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(seriesId, year, tournament, stageId, roundLabel || null, bestOf, editor.sub);
    const setOverride = db.prepare(
      `INSERT INTO game_structure_overrides
       (match_key, stage_id, series_id, edited_by_sub, edited_by_email, edited_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(match_key) DO UPDATE SET
         stage_id = excluded.stage_id, series_id = excluded.series_id,
         edited_by_sub = excluded.edited_by_sub, edited_by_email = excluded.edited_by_email,
         edited_at = datetime('now')`,
    );
    for (const matchKey of body.matchKeys) setOverride.run(matchKey, stageId, seriesId, editor.sub, editor.email);
    auditStructure(db, year, tournament, editor, before);
  });
  save();
  return readTournamentStructure(db, year, tournament);
}

function updateGameStructure(db, year, tournament, body, editor) {
  validateScope(db, year, tournament);
  if (!body || !Array.isArray(body.assignments)) throw new StructureValidationError("Assignments must be a list");
  if (
    body.assignments.some(
      (assignment) =>
        !assignment ||
        typeof assignment !== "object" ||
        Array.isArray(assignment) ||
        typeof assignment.matchKey !== "string" ||
        !assignment.matchKey ||
        (assignment.stageId != null && typeof assignment.stageId !== "string") ||
        (assignment.seriesId != null && typeof assignment.seriesId !== "string"),
    )
  ) {
    throw new StructureValidationError("Each assignment must include a match key and valid stage/series IDs");
  }
  const assignmentKeys = body.assignments.map((assignment) => assignment.matchKey);
  if (new Set(assignmentKeys).size !== assignmentKeys.length) {
    throw new StructureValidationError("Each game may only be assigned once per request");
  }
  const before = snapshotStructure(db, year, tournament);
  const save = db.transaction(() => {
    const setOverride = db.prepare(
      `INSERT INTO game_structure_overrides
       (match_key, stage_id, series_id, edited_by_sub, edited_by_email, edited_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(match_key) DO UPDATE SET
         stage_id = excluded.stage_id, series_id = excluded.series_id,
         edited_by_sub = excluded.edited_by_sub, edited_by_email = excluded.edited_by_email,
         edited_at = datetime('now')`,
    );
    for (const assignment of body.assignments) {
      const match = db
        .prepare("SELECT year, tournament FROM matches WHERE match_key = ?")
        .get(assignment.matchKey);
      if (!match || match.year !== year || (match.tournament || "") !== tournament) {
        throw new StructureValidationError(`Game not found in tournament: ${assignment.matchKey}`);
      }
      if (assignment.stageId) {
        const stage = db
          .prepare(
            `SELECT 1 FROM tournament_stages s
             LEFT JOIN tournament_stage_overrides o ON o.stage_id = s.stage_id
             WHERE s.stage_id = ? AND s.year = ? AND s.tournament = ? AND COALESCE(o.is_deleted, 0) = 0`,
          )
          .get(assignment.stageId, year, tournament);
        if (!stage) throw new StructureValidationError("Choose a stage in this tournament");
      }
      if (assignment.seriesId) {
        const series = db
          .prepare(
            "SELECT stage_id AS stageId FROM tournament_series WHERE series_id = ? AND year = ? AND tournament = ?",
          )
          .get(assignment.seriesId, year, tournament);
        if (!series) throw new StructureValidationError("Choose a series in this tournament");
        if (assignment.stageId && assignment.stageId !== series.stageId) {
          throw new StructureValidationError("Game stage must match its series stage");
        }
      }
      setOverride.run(
        assignment.matchKey,
        assignment.stageId || null,
        assignment.seriesId || null,
        editor.sub,
        editor.email,
      );
    }
    auditStructure(db, year, tournament, editor, before);
  });
  save();
  return readTournamentStructure(db, year, tournament);
}

function addGameToSeries(db, year, tournament, seriesId, body, editor) {
  validateScope(db, year, tournament);
  if (!body || !["team1", "team2", "draw"].includes(body.result)) {
    throw new StructureValidationError("Choose the game winner or a draw");
  }
  const series = db
    .prepare(
      `SELECT series_id AS seriesId, stage_id AS stageId
       FROM tournament_series WHERE series_id = ? AND year = ? AND tournament = ?`,
    )
    .get(seriesId, year, tournament);
  if (!series) throw new StructureNotFoundError("Series not found");
  const activeStage = db
    .prepare(
      `SELECT 1 FROM tournament_stages s
       LEFT JOIN tournament_stage_overrides o ON o.stage_id = s.stage_id
       WHERE s.stage_id = ? AND s.year = ? AND s.tournament = ? AND COALESCE(o.is_deleted, 0) = 0`,
    )
    .get(series.stageId, year, tournament);
  if (!activeStage) throw new StructureValidationError("This series belongs to a removed stage");
  const seriesGames = db
    .prepare(
      `SELECT m.match_key AS matchKey, m.team1, m.team2
       FROM matches m
       LEFT JOIN game_structure_overrides o ON o.match_key = m.match_key
       LEFT JOIN csv_game_structure c ON c.match_key = m.match_key
       WHERE (CASE WHEN o.match_key IS NOT NULL THEN o.series_id ELSE c.series_id END) = ?
       ORDER BY m.match_order`,
    )
    .all(seriesId);
  if (!seriesGames.length) throw new StructureValidationError("Add this game to a series that already has at least one game");
  const team1 = seriesGames[0].team1;
  const team2 = seriesGames[0].team2;
  const resultSide = body.result;
  const result = resultSide === "team1" ? team1 : resultSide === "team2" ? team2 : null;
  if (!result && resultSide !== "draw") throw new StructureValidationError("Choose the game winner or a draw");
  const matchOrder = db
    .prepare(
      `SELECT COALESCE(MAX(match_order), 0) + 1 AS nextOrder
       FROM matches WHERE year = ? AND COALESCE(tournament, '') = ?`,
    )
    .get(year, tournament).nextOrder;
  const matchStage = body.matchStage == null ? null : String(body.matchStage).trim() || null;
  const matchKey = buildMatchKey({
    year,
    tournament,
    matchStage,
    matchOrder,
    team1,
    team2,
  });
  const before = snapshotStructure(db, year, tournament);
  const insert = db.transaction(() => {
    const rowIndex = db.prepare("SELECT COALESCE(MAX(csv_row_index), -1) + 1 AS n FROM matches").get().n;
    db.prepare(
      `INSERT INTO matches
       (year, tournament, team1, team2, result, csv_row_index, match_order, match_stage, match_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(year, tournament, team1, team2, result || "Draw", rowIndex, matchOrder, matchStage, matchKey);
    db.prepare(
      `INSERT INTO editor_created_matches
       (match_key, year, tournament, team1, team2, result, csv_row_index, match_order, match_stage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(matchKey, year, tournament, team1, team2, result || "Draw", rowIndex, matchOrder, matchStage);
    db.prepare(
      `INSERT INTO game_structure_overrides
       (match_key, stage_id, series_id, edited_by_sub, edited_by_email)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(matchKey, series.stageId, seriesId, editor.sub, editor.email);
    auditStructure(db, year, tournament, editor, before);
  });
  insert();
  return { matchKey, matchOrder, seriesId };
}

module.exports = {
  MAX_GROUPS_PER_STAGE,
  STAGE_FORMATS,
  StructureNotFoundError,
  StructureValidationError,
  addGameToSeries,
  createSeries,
  defaultStageId,
  ensureDefaultStages,
  ensureTournamentStructureSchema,
  readAllStageGroups,
  readTournamentStructure,
  saveStages,
  structureForMatches,
  updateGameStructure,
};
