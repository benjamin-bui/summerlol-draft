// Reading, validating and saving one match's details (per-player champion /
// K/D/A / role, plus each team's bans) for the in-app editor.
//
// The server is the only authority on who played for which team: it derives
// the two rosters itself and rejects anything that doesn't line up, so a
// client can't invent players or file a ban against the wrong side.

const crypto = require("crypto");
const { ROLES, normalizeRole } = require("./match-detail-fields");
const { championKey } = require("./champion-releases");
const { normalizePlayerId, playersMatch, sideMembers } = require("./match-roster");

const MAX_BANS_PER_SIDE = 5;
const MAX_STAT = 99;
const CHAMPION_PATTERN = /^[\p{L}\p{N} .'&-]{1,30}$/u;

class ValidationError extends Error {
  constructor(problems) {
    super("Invalid match details");
    this.problems = problems;
  }
}
class ConflictError extends Error {
  constructor() {
    super("This match was changed by someone else since you opened it");
  }
}
class NotFoundError extends Error {
  constructor() {
    super("Match not found");
  }
}

function findMatch(db, matchKey) {
  if (typeof matchKey !== "string" || matchKey.length === 0 || matchKey.length > 300) {
    return null;
  }
  return (
    db
      .prepare(
        `SELECT year, tournament, team1, team2, result, match_stage AS matchStage,
                match_order AS matchOrder, match_key AS matchKey
         FROM matches WHERE match_key = ?`,
      )
      .get(matchKey) || null
  );
}

function storedDetails(db, matchKey) {
  return db
    .prepare(
      `SELECT id, player, champion, kills, deaths, assists, role
       FROM match_details WHERE match_key = ? ORDER BY id`,
    )
    .all(matchKey);
}

function storedBans(db, matchKey) {
  return db
    .prepare(
      "SELECT side, champion FROM match_bans WHERE match_key = ? ORDER BY id",
    )
    .all(matchKey);
}

// A fingerprint of what is stored right now. An editor sends back the rev they
// loaded; if it no longer matches, someone else saved in between.
function computeRev(details, bans) {
  const canonical = JSON.stringify({
    details: details
      .map((d) => [
        normalizePlayerId(d.player),
        d.champion ?? null,
        d.kills ?? null,
        d.deaths ?? null,
        d.assists ?? null,
        d.role ?? null,
      ])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    bans: bans
      .map((b) => [b.side, championKey(b.champion)])
      .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function rosterRowsFor(db, match) {
  return db
    .prepare(
      `SELECT Player AS player, Captain AS captain FROM rows
       WHERE CAST(Year AS INTEGER) = ? AND COALESCE(Tournament, '') = COALESCE(?, '')`,
    )
    .all(match.year, match.tournament || null);
}

// The two teams, each as a list of roster slots. A slot carries the player
// string to store (the spelling already used for them in this match if any,
// otherwise their roster spelling) and whatever is currently recorded.
function buildTeams(db, match, details, identityMap) {
  const rosterRows = rosterRowsFor(db, match);
  const used = new Set();
  const teams = [match.team1, match.team2].map((captain, index) => {
    const seen = new Set();
    const players = [];
    for (const member of sideMembers(captain, rosterRows, identityMap)) {
      const id = normalizePlayerId(member);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const detail = details.find(
        (d) => !used.has(d.id) && playersMatch(d.player, member, identityMap),
      );
      if (detail) used.add(detail.id);
      players.push({
        side: index + 1,
        player: detail ? detail.player : member,
        displayName: member,
        isCaptain: players.length === 0,
        champion: detail?.champion ?? null,
        kills: detail?.kills ?? null,
        deaths: detail?.deaths ?? null,
        assists: detail?.assists ?? null,
        role: detail?.role ?? null,
      });
    }
    return { side: index + 1, name: captain, players };
  });
  return { teams, matchedDetailIds: used };
}

function championSuggestions(db) {
  const names = new Map();
  const add = (name) => {
    const key = name ? championKey(name) : "";
    if (key && !names.has(key)) names.set(key, name);
  };
  db.prepare("SELECT DISTINCT champion FROM match_details").all().forEach((r) => add(r.champion));
  db.prepare("SELECT DISTINCT champion FROM match_bans").all().forEach((r) => add(r.champion));
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

// Everything the editor UI needs for one match. `matchDetails` and `bans` use
// the same shape as /api/raw-matches rows, so the page can drop them straight
// into the match it already has on screen after a save.
function readMatchState(db, matchKey, identityMap) {
  const match = findMatch(db, matchKey);
  if (!match) throw new NotFoundError();
  const details = storedDetails(db, matchKey);
  const bans = storedBans(db, matchKey);
  const { teams } = buildTeams(db, match, details, identityMap);
  const banShape = { team1: [], team2: [] };
  for (const ban of bans) {
    banShape[ban.side === 1 ? "team1" : "team2"].push({
      champion: ban.champion,
      key: championKey(ban.champion),
    });
  }
  // Which team the recorded result says won (1 or 2), so a replay's winner can
  // be sanity-checked against it. null when the result names neither captain.
  const winner = normalizePlayerId(match.result);
  const winnerSide =
    winner && winner === normalizePlayerId(match.team1)
      ? 1
      : winner && winner === normalizePlayerId(match.team2)
        ? 2
        : null;
  return {
    matchKey: match.matchKey,
    winnerSide,
    year: match.year,
    tournament: match.tournament,
    matchStage: match.matchStage,
    matchOrder: match.matchOrder,
    teams,
    bans: banShape,
    matchDetails: details.map(({ id, ...d }) => ({
      ...d,
      championKey: d.champion ? championKey(d.champion) : null,
    })),
    rev: computeRev(details, bans),
    roles: ROLES,
    maxBans: MAX_BANS_PER_SIDE,
    championSuggestions: championSuggestions(db),
  };
}

// ---- validation -------------------------------------------------------------

function parseChampion(value, field, problems) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    problems.push({ field, message: "Champion must be text" });
    return null;
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name === "") return null;
  if (!CHAMPION_PATTERN.test(name) || !championKey(name)) {
    problems.push({ field, message: `"${name.slice(0, 30)}" is not a valid champion name` });
    return null;
  }
  return name;
}

function parseStat(value, field, label, problems) {
  if (value === null || value === undefined || value === "") return null;
  const number =
    typeof value === "number" ? value : /^\d{1,2}$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < 0 || number > MAX_STAT) {
    problems.push({ field, message: `${label} must be a whole number from 0 to ${MAX_STAT}` });
    return null;
  }
  return number;
}

function parseRole(value, field, problems) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    problems.push({ field, message: "Role is not valid" });
    return null;
  }
  try {
    return normalizeRole(value, 0);
  } catch {
    problems.push({ field, message: `Role must be one of ${ROLES.join(", ")}` });
    return null;
  }
}

// Turns a request body into the exact rows to store, or throws ValidationError
// listing every problem found (so the UI can show them all at once).
function validateEdit(body, teams) {
  const problems = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError([{ field: "body", message: "Expected a JSON object" }]);
  }

  const slots = new Map();
  for (const team of teams) {
    for (const slot of team.players) slots.set(normalizePlayerId(slot.player), slot);
  }

  const submitted = Array.isArray(body.players) ? body.players : null;
  if (!submitted) problems.push({ field: "players", message: "players must be a list" });

  const rows = [];
  const claimed = new Set();
  (submitted || []).forEach((entry, i) => {
    const field = `players[${i}]`;
    if (!entry || typeof entry !== "object") {
      problems.push({ field, message: "Invalid player entry" });
      return;
    }
    const slot = typeof entry.player === "string" ? slots.get(normalizePlayerId(entry.player)) : null;
    if (!slot) {
      problems.push({ field, message: "That player is not on either team in this match" });
      return;
    }
    if (claimed.has(slot.player)) {
      problems.push({ field, message: `${slot.displayName} is listed twice` });
      return;
    }
    claimed.add(slot.player);
    const row = {
      side: slot.side,
      player: slot.player,
      label: slot.displayName,
      champion: parseChampion(entry.champion, `${field}.champion`, problems),
      kills: parseStat(entry.kills, `${field}.kills`, "Kills", problems),
      deaths: parseStat(entry.deaths, `${field}.deaths`, "Deaths", problems),
      assists: parseStat(entry.assists, `${field}.assists`, "Assists", problems),
      role: parseRole(entry.role, `${field}.role`, problems),
    };
    // A blank line means "no details for this player"; nothing is stored.
    const blank = [row.champion, row.kills, row.deaths, row.assists, row.role].every(
      (v) => v === null,
    );
    if (!blank) rows.push(row);
  });

  for (const side of [1, 2]) {
    const seenRoles = new Map();
    for (const row of rows.filter((r) => r.side === side && r.role)) {
      if (seenRoles.has(row.role)) {
        problems.push({
          field: "players",
          message: `${row.label} and ${seenRoles.get(row.role)} are both set to ${row.role} on the same team`,
        });
      }
      seenRoles.set(row.role, row.label);
    }
  }

  const bans = { 1: [], 2: [] };
  const submittedBans = body.bans && typeof body.bans === "object" ? body.bans : {};
  for (const [side, name] of [[1, "team1"], [2, "team2"]]) {
    const list = submittedBans[name] ?? [];
    if (!Array.isArray(list)) {
      problems.push({ field: `bans.${name}`, message: "Bans must be a list" });
      continue;
    }
    const keys = new Set();
    list.forEach((raw, i) => {
      const champion = parseChampion(raw, `bans.${name}[${i}]`, problems);
      if (!champion) return;
      const key = championKey(champion);
      if (keys.has(key)) return; // a team can only ban a champion once
      keys.add(key);
      bans[side].push(champion);
    });
    if (bans[side].length > MAX_BANS_PER_SIDE) {
      problems.push({
        field: `bans.${name}`,
        message: `A team can have at most ${MAX_BANS_PER_SIDE} bans`,
      });
    }
  }

  if (typeof body.baseRev !== "string" || body.baseRev === "") {
    problems.push({ field: "baseRev", message: "baseRev is required" });
  }
  if (problems.length) throw new ValidationError(problems);
  return { rows, bans, baseRev: body.baseRev };
}

// ---- saving -----------------------------------------------------------------

// Validates and stores an edit in one transaction and records who made it.
// Returns the match's new state. Throws NotFoundError, ValidationError or
// ConflictError; nothing is written in any of those cases.
function saveMatchEdit(db, matchKey, body, editor, identityMap) {
  const match = findMatch(db, matchKey);
  if (!match) throw new NotFoundError();

  return db.transaction(() => {
    const beforeDetails = storedDetails(db, matchKey);
    const beforeBans = storedBans(db, matchKey);
    const { teams, matchedDetailIds } = buildTeams(db, match, beforeDetails, identityMap);
    const { rows, bans, baseRev } = validateEdit(body, teams);
    const currentRev = computeRev(beforeDetails, beforeBans);
    if (baseRev !== currentRev) throw new ConflictError();

    // Saving what is already stored changes nothing, so it must not mark the
    // match as hand-edited (which would shield it from CSV re-ingests) or add
    // a misleading audit entry.
    const orphans = beforeDetails.filter((d) => !matchedDetailIds.has(d.id));
    const nextRev = computeRev(
      [...orphans, ...rows],
      [1, 2].flatMap((side) => bans[side].map((champion) => ({ side, champion }))),
    );
    if (nextRev === currentRev) return readMatchState(db, matchKey, identityMap);

    // Replace the rows that belong to a roster slot. Any stored row that
    // matches nobody (which a CSV ingest can't produce) is left untouched.
    const remove = db.prepare("DELETE FROM match_details WHERE id = ?");
    for (const id of matchedDetailIds) remove.run(id);
    const insert = db.prepare(
      `INSERT INTO match_details (match_key, player, champion, kills, deaths, assists, role)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      insert.run(matchKey, row.player, row.champion, row.kills, row.deaths, row.assists, row.role);
    }
    db.prepare("DELETE FROM match_bans WHERE match_key = ?").run(matchKey);
    const insertBan = db.prepare(
      "INSERT INTO match_bans (match_key, side, champion) VALUES (?, ?, ?)",
    );
    for (const side of [1, 2]) {
      for (const champion of bans[side]) insertBan.run(matchKey, side, champion);
    }

    const snapshot = (details, banRows) =>
      JSON.stringify({
        details: details.map(({ id, ...d }) => d),
        bans: banRows,
      });
    db.prepare(
      `INSERT INTO match_detail_edits (match_key, edited_by_sub, edited_by_email, edited_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(match_key) DO UPDATE SET
         edited_by_sub = excluded.edited_by_sub,
         edited_by_email = excluded.edited_by_email,
         edited_at = excluded.edited_at`,
    ).run(matchKey, editor.sub, editor.email);
    db.prepare(
      `INSERT INTO match_detail_audit (match_key, edited_by_sub, edited_by_email, before_json, after_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      matchKey,
      editor.sub,
      editor.email,
      snapshot(beforeDetails, beforeBans),
      snapshot(storedDetails(db, matchKey), storedBans(db, matchKey)),
    );

    return readMatchState(db, matchKey, identityMap);
  })();
}

module.exports = {
  ConflictError,
  NotFoundError,
  ValidationError,
  MAX_BANS_PER_SIDE,
  readMatchState,
  saveMatchEdit,
  validateEdit,
};
