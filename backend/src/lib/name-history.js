// Past names -- the `name_history` table.
//
// Riot sync already writes a row there whenever it sees a player's Riot ID
// change. This module adds the other source: an editor importing a scoreboard
// screenshot (or replay) sees a name nobody on the roster is called any more,
// matches it to the right roster player by hand, and the name it was read as is
// remembered as one of that player's past names. Both kinds of row are then used
// to find the player again (player search, the profile URL, and the editor's own
// name matching on the next import).
//
// The tables are optional: on a database whose identity tables were never
// created (nothing bootstrapped yet) everything here quietly does nothing.

const { lookupIdentity } = require("./player-identity");
const { normalizePlayerId } = require("./match-roster");

const MANUAL_SOURCE = "manual-match";
const MAX_ENTRIES_PER_SAVE = 10;
// Riot game names are 3-16 characters; allow for a little noise in a name read
// from pixels, but not for a sentence.
const MAX_NAME_LENGTH = 24;
const TAG_PATTERN = /^[\p{L}\p{N}]{1,5}$/u;

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function hasNameHistory(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'name_history'").get();
}

// Adds the provenance columns to a name_history table that predates them. Safe
// to run on every start. Returns false when there is no name_history table.
function ensureNameHistorySchema(db) {
  if (!hasNameHistory(db)) return false;
  const columns = tableColumns(db, "name_history");
  // Existing rows were all written by Riot sync, which is what the default says.
  if (!columns.includes("source")) db.exec("ALTER TABLE name_history ADD COLUMN source TEXT NOT NULL DEFAULT 'riot-sync'");
  if (!columns.includes("match_key")) db.exec("ALTER TABLE name_history ADD COLUMN match_key TEXT");
  if (!columns.includes("added_by")) db.exec("ALTER TABLE name_history ADD COLUMN added_by TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_name_history_player ON name_history(player_id)");
  return true;
}

const fold = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const formatName = (name, tag) => (tag ? `${name}#${tag}` : name);

// identityKey ("p12") -> every earlier name of that person, as "Name" or
// "Name#TAG", oldest first.
function loadPastNamesByIdentityKey(db) {
  const byKey = new Map();
  if (!hasNameHistory(db)) return byKey;
  const rows = db
    .prepare("SELECT player_id, old_name, old_tag FROM name_history WHERE old_name IS NOT NULL AND TRIM(old_name) != '' ORDER BY id")
    .all();
  for (const row of rows) {
    const key = `p${row.player_id}`;
    const name = formatName(row.old_name, row.old_tag);
    if (!byKey.has(key)) byKey.set(key, []);
    const list = byKey.get(key);
    if (!list.some((existing) => fold(existing) === fold(name))) list.push(name);
  }
  return byKey;
}

// What the editor sent, cleaned up; entries that make no sense are dropped
// rather than failing the whole save (remembering a name is a side benefit of
// saving a match, never a reason to refuse it).
function cleanEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const entries = [];
  for (const entry of raw.slice(0, MAX_ENTRIES_PER_SAVE)) {
    if (!entry || typeof entry !== "object" || typeof entry.player !== "string" || typeof entry.name !== "string") continue;
    const name = entry.name.replace(/\s+/g, " ").trim();
    if (!name || name.length > MAX_NAME_LENGTH || /[\p{Cc}#]/u.test(name)) continue;
    const tag = typeof entry.tag === "string" && TAG_PATTERN.test(entry.tag.trim()) ? entry.tag.trim() : null;
    entries.push({ player: entry.player, name, tag });
  }
  return entries;
}

// Remembers each `{ player, name, tag }` as a past name of the roster player
// `player` (the slot's stored player string) -- but only if that player is on
// one of this match's teams, resolves to a tracked identity, and the name isn't
// one we already know them by. Call inside the save's transaction. Returns the
// entries actually written.
function recordPastNames(db, { matchKey, slots, entries, identityMap, editor }) {
  if (!hasNameHistory(db)) return [];
  ensureNameHistorySchema(db);
  const bySlot = new Map(slots.map((slot) => [normalizePlayerId(slot.player), slot]));
  const playerRow = db.prepare("SELECT riot_game_name AS name, riot_tag_line AS tag FROM players WHERE id = ?");
  const history = db.prepare("SELECT old_name, old_tag FROM name_history WHERE player_id = ?");
  const insert = db.prepare(
    `INSERT INTO name_history (player_id, old_name, old_tag, new_name, new_tag, source, match_key, added_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const written = [];
  for (const entry of cleanEntries(entries)) {
    const slot = bySlot.get(normalizePlayerId(entry.player));
    const identity = slot && (lookupIdentity(identityMap, slot.player) || lookupIdentity(identityMap, slot.displayName));
    const playerId = identity && /^p(\d+)$/.exec(identity.identityKey) ? Number(identity.identityKey.slice(1)) : null;
    const current = playerId ? playerRow.get(playerId) : null;
    if (!current) continue; // not a tracked player (or a stale id)

    // The name they're called today (Riot's, else the roster's) in two parts.
    const shown = identity.displayName || slot.displayName;
    const hash = shown.lastIndexOf("#");
    const newName = current.name || (hash === -1 ? shown : shown.slice(0, hash));
    const newTag = current.tag || (hash === -1 ? null : shown.slice(hash + 1));

    const sameAsToday = [newName, slot.displayName.split("#")[0], slot.player.split("#")[0]].some((name) => fold(name) === fold(entry.name));
    const known = history.all(playerId).some((row) => fold(row.old_name) === fold(entry.name) && (!row.old_tag || !entry.tag || fold(row.old_tag) === fold(entry.tag)));
    if (sameAsToday || known) continue;

    insert.run(playerId, entry.name, entry.tag, newName, newTag, MANUAL_SOURCE, matchKey, editor?.sub ?? null);
    written.push({ player: slot.player, playerId, name: entry.name, tag: entry.tag });
  }
  return written;
}

// Everything that goes by `wanted` once: the identityKeys with that name (or a
// profile slug made from it) in their past names. Used to find a player by an
// old name or an old profile link.
function identityKeysForPastName(pastNames, wanted) {
  const target = fold(wanted);
  const found = [];
  if (!target) return found;
  for (const [identityKey, names] of pastNames) {
    const matches = names.some((name) => {
      const hash = name.lastIndexOf("#");
      const slug = hash === -1 ? name : `${name.slice(0, hash)}-${name.slice(hash + 1)}`;
      return fold(name) === target || fold(slug) === target;
    });
    if (matches) found.push(identityKey);
  }
  return found;
}

module.exports = {
  MANUAL_SOURCE,
  ensureNameHistorySchema,
  hasNameHistory,
  identityKeysForPastName,
  loadPastNamesByIdentityKey,
  recordPastNames,
};
