const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { parseCsv } = require("./ingest-matches");
const { buildMatchContextKey } = require("../lib/match-identity");
const { loadIdentityMap } = require("../lib/player-identity");
const { ensureMatchDetailsSchema } = require("../lib/match-details-schema");
const { normalizeRole, parseBanList } = require("../lib/match-detail-fields");
const { championKey } = require("../lib/champion-releases");

const DB_PATH = path.join(__dirname, "..", "..", "data", "app.db");
const REQUIRED_COLUMNS = [
  "Year",
  "Tournament",
  "Match Stage",
  "Match Order",
  "Player",
  "Champion",
  "K",
  "D",
  "A",
];
// Optional columns: a CSV without them (or with them left empty) ingests
// exactly as it did before they existed.
//   Role -- the role the row's player played that game.
//   Ban  -- champion(s) banned by the row's player's TEAM that game. This is
//           deliberately NOT tied to the player on the row: a ban belongs to
//           the team, and any row of the team can carry it (one ban per row,
//           several in one cell, or the same list repeated on every row all
//           give the same result, since a team can only ban a champion once).
const OPTIONAL_COLUMNS = ["Role", "Ban"];

function nullableInteger(value, column, rowNumber) {
  if (value === undefined || value.trim() === "") return null;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(
      `Row ${rowNumber}: "${column}" value "${value}" is not a valid integer`,
    );
  }
  return Number(value.trim());
}

function normalizePlayerId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function playersMatch(left, right, identityMap) {
  if (normalizePlayerId(left) === normalizePlayerId(right)) return true;
  const leftIdentity = identityMap.get(String(left || "").trim());
  const rightIdentity = identityMap.get(String(right || "").trim());
  if (
    leftIdentity &&
    rightIdentity &&
    leftIdentity.identityKey === rightIdentity.identityKey
  ) {
    return true;
  }
  return false;
}

// Which side of `match` (1 = Team 1, 2 = Team 2) a player was on, as a Set of
// the sides they match. A player is on a side if they are that side's
// captain, or were drafted onto that captain's team for the tournament.
function sidesForPlayer(player, match, rosterRows, identityMap) {
  const sides = new Set();
  [match.team1, match.team2].forEach((captain, i) => {
    const members = [captain];
    for (const rosterRow of rosterRows) {
      if (playersMatch(rosterRow.captain, captain, identityMap)) {
        members.push(rosterRow.player);
      }
    }
    if (members.some((member) => playersMatch(player, member, identityMap))) {
      sides.add(i + 1);
    }
  });
  return sides;
}

// Returns { details, rolesRecorded, bans, gamesWithBans }. Everything is
// replaced wholesale on each run (same as before), so the DB always mirrors
// the CSV -- including bans and roles that were deleted from it.
function ingestMatchDetailsDetailed(csvPath, { dbPath = DB_PATH } = {}) {
  const [header, ...rows] = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const indexes = Object.fromEntries(
    REQUIRED_COLUMNS.map((column) => [column, header.indexOf(column)]),
  );
  for (const [column, index] of Object.entries(indexes)) {
    if (index === -1)
      throw new Error(`Missing expected column for "${column}" in ${csvPath}`);
  }
  const optional = Object.fromEntries(
    OPTIONAL_COLUMNS.map((column) => [column, header.indexOf(column)]),
  );
  const optionalCell = (row, column) =>
    optional[column] === -1 ? "" : (row[optional[column]] ?? "");

  const db = new Database(dbPath);
  db.pragma("foreign_keys = OFF");
  const identityMap = loadIdentityMap(db);
  try {
    const importDetails = db.transaction(() => {
      ensureMatchDetailsSchema(db);
      db.exec("DELETE FROM match_details");
      db.exec("DELETE FROM match_bans");
      const insert = db.prepare(`
        INSERT INTO match_details (match_key, player, champion, kills, deaths, assists, role)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertBan = db.prepare(`
        INSERT INTO match_bans (match_key, side, champion) VALUES (?, ?, ?)
      `);
      const findMatches = db.prepare(`
        SELECT id, match_key, team1, team2 FROM matches
        WHERE year = ? AND COALESCE(tournament, '') = COALESCE(?, '')
          AND COALESCE(match_stage, '') = COALESCE(?, '') AND match_order = ?
      `);
      const findRosterRows = db.prepare(`
        SELECT Player AS player, Captain AS captain FROM rows
        WHERE CAST(Year AS INTEGER) = ?
          AND COALESCE(Tournament, '') = COALESCE(?, '')
      `);
      const rosterCache = new Map();
      const rosterRowsFor = (year, tournament) => {
        const cacheKey = `${year}::${tournament || ""}`;
        if (!rosterCache.has(cacheKey)) {
          rosterCache.set(cacheKey, findRosterRows.all(year, tournament || null));
        }
        return rosterCache.get(cacheKey);
      };

      // `${match_key}|${side}|${championKey}` -> the ban, with the champion
      // spelled as first typed. A team can only ban a champion once per game,
      // so repeats (the same list copied onto every row of a team, say)
      // collapse to one ban.
      const bansToInsert = new Map();
      let rolesRecorded = 0;

      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const rowNumber = index + 2;
        if (!row[indexes.Year]?.trim()) continue;
        const context = {
          year: Number(row[indexes.Year]),
          tournament: row[indexes.Tournament],
          matchStage: row[indexes["Match Stage"]],
          matchOrder: Number(row[indexes["Match Order"]]),
        };
        if (
          !Number.isInteger(context.year) ||
          !Number.isInteger(context.matchOrder)
        ) {
          throw new Error(`Row ${rowNumber}: Year and Match Order must be integers`);
        }
        const matches = findMatches.all(
          context.year,
          context.tournament || null,
          context.matchStage || null,
          context.matchOrder,
        );
        const player = row[indexes.Player].trim();
        const rosterRows = rosterRowsFor(context.year, context.tournament);
        const candidates = matches
          .map((match) => ({
            match,
            sides: sidesForPlayer(player, match, rosterRows, identityMap),
          }))
          .filter((candidate) => candidate.sides.size > 0);
        if (candidates.length !== 1) {
          throw new Error(
            `Row ${rowNumber}: expected one parent match for ${buildMatchContextKey(context)} and player "${player}", found ${candidates.length}`,
          );
        }
        const { match, sides } = candidates[0];

        const role = normalizeRole(optionalCell(row, "Role"), rowNumber);
        const bans = parseBanList(optionalCell(row, "Ban"));
        if (bans.length) {
          // Only a problem if there are bans to file: a player who somehow
          // matched both teams still ingests fine as a plain detail row.
          if (sides.size !== 1) {
            throw new Error(
              `Row ${rowNumber}: player "${player}" matches both teams in ${buildMatchContextKey(context)}, so the Ban on this row can't be assigned to a team`,
            );
          }
          const [side] = sides;
          for (const champion of bans) {
            const key = championKey(champion);
            if (!key) continue;
            const banKey = `${match.match_key}|${side}|${key}`;
            if (!bansToInsert.has(banKey)) {
              bansToInsert.set(banKey, {
                matchKey: match.match_key,
                side,
                champion,
              });
            }
          }
        }

        insert.run(
          match.match_key,
          player,
          row[indexes.Champion]?.trim() || null,
          nullableInteger(row[indexes.K], "K", rowNumber),
          nullableInteger(row[indexes.D], "D", rowNumber),
          nullableInteger(row[indexes.A], "A", rowNumber),
          role,
        );
        if (role) rolesRecorded += 1;
      }

      const gamesWithBans = new Set();
      for (const { matchKey, side, champion } of bansToInsert.values()) {
        insertBan.run(matchKey, side, champion);
        gamesWithBans.add(matchKey);
      }
      return { rolesRecorded, bans: bansToInsert.size, gamesWithBans: gamesWithBans.size };
    });
    const { rolesRecorded, bans, gamesWithBans } = importDetails();
    return {
      details: db.prepare("SELECT COUNT(*) AS count FROM match_details").get()
        .count,
      rolesRecorded,
      bans,
      gamesWithBans,
    };
  } finally {
    db.close();
  }
}

// Kept as the plain "how many detail rows" entry point entrypoint.js and
// refresh-all.js already use.
function ingestMatchDetails(csvPath, options) {
  return ingestMatchDetailsDetailed(csvPath, options).details;
}

if (require.main === module) {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error(
      "Usage: node src/scripts/ingest-match-details.js <path-to-details-csv>",
    );
    process.exit(1);
  }
  const { details, rolesRecorded, bans, gamesWithBans } =
    ingestMatchDetailsDetailed(csvPath);
  console.log(`Loaded ${details} match details into ${DB_PATH}`);
  console.log(
    `  ${rolesRecorded} with a role; ${bans} bans across ${gamesWithBans} games`,
  );
}

module.exports = {
  ingestMatchDetails,
  ingestMatchDetailsDetailed,
  nullableInteger,
};
