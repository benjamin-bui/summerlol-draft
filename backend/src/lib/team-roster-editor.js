const crypto = require("crypto");
const { lookupIdentity } = require("./player-identity");

const MAX_ROSTER_SIZE = 20;
const MAX_PLAYER_NAME_LENGTH = 100;
const q = (name) => `"${name}"`;

class TeamRosterError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "TeamRosterError";
    this.status = status;
  }
}

function playerKey(name, identityMap) {
  const normalized = String(name || "").trim();
  return identityForName(normalized, identityMap)?.identityKey || normalized;
}

function draftPlayerKey(name, identityMap) {
  const normalized = String(name || "").trim();
  return identityForName(normalized, identityMap)?.identityKey || normalized.toLowerCase();
}

function identityForName(name, identityMap) {
  const identity = lookupIdentity(identityMap, name);
  if (identity) return identity;
  const normalized = String(name || "").trim().toLowerCase();
  for (const candidate of identityMap.values()) {
    if (candidate.displayName?.trim().toLowerCase() === normalized) return candidate;
  }
  return null;
}

function tournamentRows(db, year, tournament) {
  return db
    .prepare(
      `SELECT rowid AS rowId, "Year" AS year, "Tournament" AS tournament,
              "Captain" AS captain, "Player" AS player, "Pick Order" AS pickOrder,
              "Rank" AS rank
       FROM rows
       WHERE CAST("Year" AS INTEGER) = ?
         AND COALESCE("Tournament", 'Summer') = ?
       ORDER BY CAST("Pick Order" AS REAL), rowid`,
    )
    .all(year, tournament);
}

function teamCaptainNames(db, year, tournament, rows) {
  const names = new Set(rows.map((row) => row.captain).filter(Boolean));
  const matchTeams = db
    .prepare(
      `SELECT team1 AS name FROM matches
       WHERE year = ? AND COALESCE(tournament, '') = ?
       UNION
       SELECT team2 AS name FROM matches
       WHERE year = ? AND COALESCE(tournament, '') = ?`,
    )
    .all(year, tournament, year, tournament);
  for (const row of matchTeams) if (row.name) names.add(row.name);
  return [...names];
}

function currentTeamRows(rows, captainKey, identityMap) {
  return rows.filter((row) => playerKey(row.captain, identityMap) === captainKey);
}

function rosterRevision(rows) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(rows.map((row) => [row.rowId, row.captain, row.player, row.pickOrder, row.rank])))
    .digest("hex")
    .slice(0, 16);
}

function readState(db, year, tournament, captainKey, captainName, identityMap) {
  if (!Number.isInteger(year) || typeof tournament !== "string" || !tournament.trim()) {
    throw new TeamRosterError("A valid tournament year and name are required");
  }
  if (typeof captainKey !== "string" || !captainKey.trim()) {
    throw new TeamRosterError("A team captain is required");
  }
  const rows = tournamentRows(db, year, tournament);
  const names = teamCaptainNames(db, year, tournament, rows);
  const teamName = names.find((name) => playerKey(name, identityMap) === captainKey);
  if (!teamName) throw new TeamRosterError("Team not found in this tournament", 404);
  if (captainName && playerKey(captainName, identityMap) !== captainKey) {
    throw new TeamRosterError("The captain does not match this team");
  }

  const teamRows = currentTeamRows(rows, captainKey, identityMap);
  const displayCaptain = identityForName(captainName || teamName, identityMap)?.displayName || captainName || teamName;
  const players = teamRows.map((row) => {
    const identity = identityForName(row.player, identityMap);
    const pickOrder = row.pickOrder == null || String(row.pickOrder).trim() === "" ? NaN : Number(row.pickOrder);
    return {
      name: identity?.displayName || row.player,
      identityKey: identity?.identityKey || String(row.player || "").trim().toLowerCase(),
      pickOrder: Number.isFinite(pickOrder) ? pickOrder : null,
    };
  });
  return {
    captainKey,
    captainName: displayCaptain,
    players,
    baseRev: rosterRevision(teamRows),
    teamRows,
  };
}

function readTeamRoster(db, year, tournament, captainKey, captainName, identityMap) {
  const { teamRows, ...state } = readState(db, year, tournament, captainKey, captainName, identityMap);
  return state;
}

function parsePlayers(players, identityMap) {
  if (!Array.isArray(players) || players.length > MAX_ROSTER_SIZE) {
    throw new TeamRosterError(`Roster must contain at most ${MAX_ROSTER_SIZE} players`);
  }
  if (players.length === 0) throw new TeamRosterError("A team must have at least one draft player");

  const seen = new Set();
  return players.map((value, index) => {
    if (typeof value !== "string") throw new TeamRosterError(`Player ${index + 1} must be a name`);
    const name = value.trim().replace(/\s+/g, " ");
    if (!name || name.length > MAX_PLAYER_NAME_LENGTH) {
      throw new TeamRosterError(`Player ${index + 1} must be between 1 and ${MAX_PLAYER_NAME_LENGTH} characters`);
    }
    const identity = identityForName(name, identityMap);
    const key = identity?.identityKey || name.toLowerCase();
    if (seen.has(key)) throw new TeamRosterError(`"${name}" appears more than once in the roster`);
    seen.add(key);
    return { key, name: identity?.displayName || name };
  });
}

function saveTeamRoster(db, year, tournament, body, identityMap) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TeamRosterError("A roster update is required");
  }
  const { captainKey, captainName, baseRev } = body;
  const players = parsePlayers(body.players, identityMap);
  if (typeof baseRev !== "string" || !baseRev) throw new TeamRosterError("Reload the roster before saving");

  const columns = db.prepare("PRAGMA table_info(rows)").all().map((column) => column.name);
  for (const required of ["Year", "Tournament", "Captain", "Player", "Pick Order"]) {
    if (!columns.includes(required)) throw new Error(`Draft rows are missing the "${required}" column`);
  }
  const hasRank = columns.includes("Rank");

  return db.transaction(() => {
    const current = readState(db, year, tournament, captainKey, captainName, identityMap);
    if (current.baseRev !== baseRev) {
      throw new TeamRosterError("This roster changed while you were editing. Reload it and try again.", 409);
    }

    const remaining = new Map();
    for (const row of current.teamRows) {
      const key = draftPlayerKey(row.player, identityMap);
      if (!remaining.has(key)) remaining.set(key, []);
      remaining.get(key).push(row);
    }
    const keptRowIds = new Set();
    const update = db.prepare(
      `UPDATE rows SET "Player" = ?, "Pick Order" = ? WHERE rowid = ?`,
    );
    const insertColumns = ["Year", "Tournament", "Captain", "Player", "Pick Order", ...(hasRank ? ["Rank"] : [])];
    const insert = db.prepare(
      `INSERT INTO rows (${insertColumns.map(q).join(", ")})
       VALUES (${insertColumns.map(() => "?").join(", ")})`,
    );
    const captainRaw = current.teamRows[0]?.captain || teamCaptainNames(db, year, tournament, tournamentRows(db, year, tournament))
      .find((name) => playerKey(name, identityMap) === captainKey);
    const teamRank = current.teamRows[0]?.rank ?? null;

    players.forEach((player, index) => {
      const existing = remaining.get(player.key)?.shift();
      if (existing) {
        keptRowIds.add(existing.rowId);
        update.run(player.name, String(index + 1), existing.rowId);
      } else {
        insert.run(
          String(year),
          tournament,
          captainRaw || captainName,
          player.name,
          String(index + 1),
          ...(hasRank ? [teamRank] : []),
        );
      }
    });

    const remove = db.prepare("DELETE FROM rows WHERE rowid = ?");
    for (const row of current.teamRows) {
      if (!keptRowIds.has(row.rowId)) remove.run(row.rowId);
    }
    const after = readTeamRoster(db, year, tournament, captainKey, captainName, identityMap);
    return after;
  })();
}

module.exports = { TeamRosterError, readTeamRoster, saveTeamRoster };
