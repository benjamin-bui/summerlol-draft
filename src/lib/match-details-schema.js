// Schema for the per-game detail tables, shared by everything that creates or
// migrates them (ingest-match-details.js, and server.js's startup pass) so the
// column lists can't drift apart.
//
//   match_details -- one row per player per game (champion, K/D/A, role).
//   match_bans    -- one row per champion banned by one TEAM in one game.
//
// Bans live in their own table, not on match_details, because a ban belongs to
// a team's side of a game, never to the player whose CSV row it happened to be
// typed on. `side` is 1 or 2 -- the game's Team 1 / Team 2 in `matches`.

const MATCH_DETAILS_COLUMNS = [
  "match_key",
  "player",
  "champion",
  "kills",
  "deaths",
  "assists",
  "role",
];

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

// Creates whatever is missing and adds `role` to a match_details table that
// predates it. Safe to call on every start: it never drops or rewrites data.
function ensureMatchDetailsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_key TEXT NOT NULL,
      player TEXT NOT NULL,
      champion TEXT,
      kills INTEGER,
      deaths INTEGER,
      assists INTEGER,
      role TEXT
    )
  `);
  if (!tableColumns(db, "match_details").includes("role")) {
    db.exec("ALTER TABLE match_details ADD COLUMN role TEXT");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_key TEXT NOT NULL,
      side INTEGER NOT NULL CHECK (side IN (1, 2)),
      champion TEXT NOT NULL,
      UNIQUE (match_key, side, champion)
    )
  `);
}

module.exports = {
  MATCH_DETAILS_COLUMNS,
  ensureMatchDetailsSchema,
  tableColumns,
};
