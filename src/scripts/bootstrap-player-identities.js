/**
 * Seeds the identity tables (players / player_aliases / pending_lookups)
 * from every distinct value currently in the `rows` table's Player column.
 *
 * Safe to re-run: any raw Player string that already has an alias row is
 * skipped, so running this again after ingesting a new season only adds
 * aliases for names that are actually new.
 *
 * For raw names that already look like a Riot ID ("Name#Tag", optionally
 * with trailing junk like " (Santiago)"), the tag is parsed out
 * automatically and the row is queued in pending_lookups ready to resolve.
 * Everything else gets a player+alias row created but is left out of
 * pending_lookups (no game_name/tag_line to look up yet) until someone
 * supplies one — see export-pending-tags.js / import-pending-tags.js.
 *
 * Usage:
 *   node data/bootstrap-player-identities.js
 */

const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'app.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'identity-schema.sql');
const TABLE = 'rows';
const GROUP_COL = 'Player';
const DEFAULT_REGION = process.env.RIOT_REGION || 'americas';

// Matches "Name#Tag" at the start of the string, tag is alphanumeric only
// (Riot tag lines are 2-5 alphanumeric chars) — anything after the tag
// (like " (Santiago)") is deliberately ignored rather than included.
const RIOT_ID_PATTERN = /^(.+?)#([A-Za-z0-9]{2,5})\b/;

function parseRiotId(rawName) {
  const match = rawName.match(RIOT_ID_PATTERN);
  if (!match) return null;
  return { gameName: match[1].trim(), tagLine: match[2].trim() };
}

function bootstrap(db) {
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf-8'));

  const distinctPlayers = db
    .prepare(`SELECT DISTINCT "${GROUP_COL}" AS name FROM "${TABLE}" WHERE "${GROUP_COL}" IS NOT NULL AND "${GROUP_COL}" != ''`)
    .all()
    .map((r) => r.name);

  let created = 0;
  let skipped = 0;
  let queuedWithTag = 0;
  let queuedWithoutTag = 0;

  const insertPlayer = db.prepare('INSERT INTO players DEFAULT VALUES');
  const insertAlias = db.prepare('INSERT INTO player_aliases (alias, player_id) VALUES (?, ?)');
  const insertPending = db.prepare(
    `INSERT INTO pending_lookups (raw_name, game_name, tag_line, region) VALUES (?, ?, ?, ?)
     ON CONFLICT(raw_name) DO NOTHING`
  );
  const aliasExists = db.prepare('SELECT 1 FROM player_aliases WHERE alias = ?');

  const seedAll = db.transaction((names) => {
    for (const rawName of names) {
      if (aliasExists.get(rawName)) {
        skipped += 1;
        continue;
      }

      const playerId = insertPlayer.run().lastInsertRowid;
      insertAlias.run(rawName, playerId);
      created += 1;

      const parsed = parseRiotId(rawName);
      if (parsed) {
        insertPending.run(rawName, parsed.gameName, parsed.tagLine, DEFAULT_REGION);
        queuedWithTag += 1;
      } else {
        insertPending.run(rawName, null, null, DEFAULT_REGION);
        queuedWithoutTag += 1;
      }
    }
  });

  seedAll(distinctPlayers);

  return { totalPlayerNames: distinctPlayers.length, created, skipped, queuedWithTag, queuedWithoutTag };
}

if (require.main === module) {
  const db = new Database(DB_PATH);
  const result = bootstrap(db);
  console.log(`Distinct Player names in dataset: ${result.totalPlayerNames}`);
  console.log(`New identity rows created: ${result.created}`);
  console.log(`Already had an alias (skipped): ${result.skipped}`);
  console.log(`Queued for Riot lookup (tag parsed from name): ${result.queuedWithTag}`);
  console.log(`Queued but missing a tag (needs manual entry): ${result.queuedWithoutTag}`);
  db.close();
}

module.exports = { bootstrap, parseRiotId };
