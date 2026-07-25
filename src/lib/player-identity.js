/**
 * Resolves raw "Player" column strings to a canonical identity (merging
 * name variants that share a PUUID) and builds an op.gg profile link when
 * a player has been successfully synced against Riot's API at least once.
 *
 * If the identity tables haven't been created/bootstrapped yet (fresh DB,
 * bootstrap-player-identities.js never run), this degrades gracefully to
 * "nothing is resolved" rather than throwing — the app works exactly as
 * it did before this feature existed.
 */

const OPGG_REGION = process.env.OPGG_REGION || "na";

function opggLink(gameName, tagLine, region = OPGG_REGION) {
  if (!gameName || !tagLine) return null;
  return `https://op.gg/lol/summoners/${region}/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
}

function identityTablesExist(db) {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='player_aliases'",
    )
    .get();
  return !!row;
}

/**
 * Returns a Map from raw alias string -> { identityKey, displayName, profileUrl, resolved }.
 * identityKey is what stats aggregation should actually GROUP BY — it's the
 * numeric player_id when an alias has been bootstrapped, so multiple raw
 * spellings that turned out to be the same person (merged via a Riot sync)
 * collapse into one ranked entry.
 */
function loadIdentityMap(db) {
  const map = new Map();
  if (!identityTablesExist(db)) return map;

  const rows = db
    .prepare(
      `SELECT pa.alias, p.id AS player_id, p.riot_game_name, p.riot_tag_line,
              p.riot_region, p.display_name_override
       FROM player_aliases pa
       JOIN players p ON p.id = pa.player_id`,
    )
    .all();

  for (const row of rows) {
    const resolved = !!row.riot_game_name;
    const displayName =
      row.display_name_override || row.riot_game_name || row.alias;
    map.set(row.alias, {
      identityKey: `p${row.player_id}`,
      displayName,
      profileUrl: resolved
        ? opggLink(row.riot_game_name, row.riot_tag_line, OPGG_REGION)
        : null,
      resolved,
    });
  }

  return map;
}

// Reverse of identityMap: identityKey -> display info. Built once per
// computeTrueSkillFromMatches call rather than scanning draftRows per
// lookup -- also fixes captains/players who are correctly identity-matched
// but never appear as a Player value in draftRows (e.g. captain-only,
// no recorded picks), who previously fell through to showing their raw
// identityKey as a "name".
function buildReverseIdentityLookup(identityMap) {
  const byKey = new Map();
  for (const identity of identityMap.values()) {
    if (!byKey.has(identity.identityKey)) {
      byKey.set(identity.identityKey, {
        displayName: identity.displayName,
        profileUrl: identity.profileUrl || null,
        identified: !!identity.resolved,
      });
    }
  }
  return byKey;
}

module.exports = {
  loadIdentityMap,
  buildReverseIdentityLookup,
  opggLink,
  identityTablesExist,
};
