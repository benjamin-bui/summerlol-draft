const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { parseCsv } = require("./ingest-matches");
const { buildMatchContextKey } = require("../lib/match-identity");
const { loadIdentityMap } = require("../lib/player-identity");

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

function ingestMatchDetails(csvPath, { dbPath = DB_PATH } = {}) {
  const [header, ...rows] = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const indexes = Object.fromEntries(
    REQUIRED_COLUMNS.map((column) => [column, header.indexOf(column)]),
  );
  for (const [column, index] of Object.entries(indexes)) {
    if (index === -1)
      throw new Error(`Missing expected column for "${column}" in ${csvPath}`);
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = OFF");
  const identityMap = loadIdentityMap(db);
  try {
    const importDetails = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS match_details (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          match_key TEXT NOT NULL,
          player TEXT NOT NULL,
          champion TEXT,
          kills INTEGER,
          deaths INTEGER,
          assists INTEGER
        )
      `);
      db.exec("DELETE FROM match_details");
      const insert = db.prepare(`
        INSERT INTO match_details (match_key, player, champion, kills, deaths, assists)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
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
          throw new Error(
            `Row ${index + 2}: Year and Match Order must be integers`,
          );
        }
        const matches = db
          .prepare(
            `
          SELECT id, match_key, team1, team2 FROM matches
          WHERE year = ? AND COALESCE(tournament, '') = COALESCE(?, '')
            AND COALESCE(match_stage, '') = COALESCE(?, '') AND match_order = ?
        `,
          )
          .all(
            context.year,
            context.tournament || null,
            context.matchStage || null,
            context.matchOrder,
          );
        const player = row[indexes.Player].trim();
        const playerMatches = matches.filter((match) => {
          const rosterRows = db
            .prepare(
              `
              SELECT Player AS player, Captain AS captain FROM rows
              WHERE CAST(Year AS INTEGER) = ?
                AND COALESCE(Tournament, '') = COALESCE(?, '')
            `,
            )
            .all(context.year, context.tournament || null);
          const members = [match.team1, match.team2];
          for (const rosterRow of rosterRows) {
            if (playersMatch(rosterRow.captain, match.team1, identityMap)) {
              members.push(rosterRow.player);
            }
            if (playersMatch(rosterRow.captain, match.team2, identityMap)) {
              members.push(rosterRow.player);
            }
          }
          return members.some((member) =>
            playersMatch(player, member, identityMap),
          );
        });
        if (playerMatches.length !== 1) {
          throw new Error(
            `Row ${index + 2}: expected one parent match for ${buildMatchContextKey(context)} and player "${player}", found ${playerMatches.length}`,
          );
        }
        insert.run(
          playerMatches[0].match_key,
          player,
          row[indexes.Champion]?.trim() || null,
          nullableInteger(row[indexes.K], "K", index + 2),
          nullableInteger(row[indexes.D], "D", index + 2),
          nullableInteger(row[indexes.A], "A", index + 2),
        );
      }
    });
    importDetails();
    return db.prepare("SELECT COUNT(*) AS count FROM match_details").get()
      .count;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error(
      "Usage: node src/scripts/ingest-match-details.js <path-to-details-csv>",
    );
    process.exit(1);
  }
  console.log(
    `Loaded ${ingestMatchDetails(csvPath)} match details into ${DB_PATH}`,
  );
}

module.exports = { ingestMatchDetails, nullableInteger };
