/**
 * Riot account-v1 sync — resolves raw player names to a permanent PUUID,
 * and re-checks already-resolved players to catch renames/retags.
 *
 * Ported from a reference FastAPI project's design (see identity-schema.sql
 * for the rationale) to plain Node + fetch, since this app stays on the
 * Node/Express/better-sqlite3 stack rather than adopting Python.
 *
 * Two passes, matching the reference:
 *   1. resolvePending() — raw names with no PUUID yet -> look up by Riot ID
 *   2. refreshKnown()   — existing PUUIDs -> re-fetch current name, detect renames
 *
 * PUUID is stored in players.puuid and is NEVER returned by any API route —
 * treat that column as backend-only, same privacy stance as the reference.
 *
 * IMPORTANT — untested against the real Riot API: api.riotgames.com is not
 * reachable from the sandbox this was built in (network allowlist doesn't
 * include it), so `riotFetch()` below has never made a real request. Every
 * surrounding piece of logic (alias-repoint-on-merge, rename detection,
 * name_history logging, retry/backoff shape) is unit-tested against a
 * mocked version of riotFetch — see test-riot-sync.js. You'll need your own
 * RIOT_API_KEY to verify the actual HTTP layer works end-to-end.
 */

const RIOT_API_KEY = process.env.RIOT_API_KEY || "";
const DEFAULT_REGION = process.env.RIOT_REGION || "americas";

// Regional routing values account-v1 accepts. NA/BR/LAN/LAS/OCE all route
// through 'americas' — this is Riot's account-v1 routing, NOT platform
// routing (na1/euw1/etc), which is a different, unrelated concept.
const VALID_REGIONS = new Set(["americas", "europe", "asia", "sea"]);

class RiotApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "RiotApiError";
    this.status = status;
  }
}

/**
 * Single low-level call to Riot's account-v1 API, with 429/5xx retry.
 * Isolated as its own function so tests can monkeypatch it wholesale
 * instead of mocking global fetch — keeps the retry/backoff logic itself
 * covered by tests without needing a real network layer.
 */
async function riotFetch(path, { maxRetries = 3 } = {}) {
  if (!RIOT_API_KEY) {
    throw new Error("RIOT_API_KEY environment variable is not set");
  }

  const url = `https://${path}`;
  let attempt = 0;

  while (true) {
    const res = await fetch(url, {
      headers: { "X-Riot-Token": RIOT_API_KEY },
    });

    if (res.ok) {
      return res.json();
    }

    if (res.status === 404) {
      throw new RiotApiError("Riot account not found (404)", 404);
    }

    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterSec = retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : null;
      const backoffMs =
        retryAfterSec && !Number.isNaN(retryAfterSec)
          ? retryAfterSec * 1000
          : 2 ** attempt * 500; // 500ms, 1s, 2s exponential fallback
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }

    throw new RiotApiError(`Riot API error ${res.status}`, res.status);
  }
}

async function getAccountByRiotId(region, gameName, tagLine) {
  if (!VALID_REGIONS.has(region)) {
    throw new Error(
      `Invalid region "${region}" — must be one of ${[...VALID_REGIONS].join(", ")}`,
    );
  }
  const path =
    `${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetch(path);
}

async function getAccountByPuuid(region, puuid) {
  if (!VALID_REGIONS.has(region)) {
    throw new Error(
      `Invalid region "${region}" — must be one of ${[...VALID_REGIONS].join(", ")}`,
    );
  }
  const path = `${region}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`;
  return riotFetch(path);
}

/**
 * Applies a successful PUUID lookup for `rawName`. If the PUUID already
 * belongs to a different player row (this raw name turned out to be a
 * rename/retag of someone already tracked), the alias is repointed to the
 * existing player instead of creating a duplicate identity — this is the
 * key piece that makes "same person, different name across seasons" work.
 */
function applyResolvedAccount(db, rawName, puuid, gameName, tagLine, region) {
  const existing = db
    .prepare("SELECT id, name_locked FROM players WHERE puuid = ?")
    .get(puuid);
  const aliasRow = db
    .prepare("SELECT player_id FROM player_aliases WHERE alias = ?")
    .get(rawName);
  const currentPlayerId = aliasRow ? aliasRow.player_id : null;

  let targetId;
  if (existing && currentPlayerId && existing.id !== currentPlayerId) {
    // This raw name resolves to a PUUID already tracked under a different
    // player row — same person, repoint the alias and drop the now-orphaned
    // placeholder player row if it has no results attached elsewhere.
    db.prepare("UPDATE player_aliases SET player_id = ? WHERE alias = ?").run(
      existing.id,
      rawName,
    );
    targetId = existing.id;
  } else {
    targetId = currentPlayerId;
    db.prepare("UPDATE players SET puuid = ? WHERE id = ?").run(
      puuid,
      targetId,
    );
  }

  updateNameIfChanged(db, targetId, gameName, tagLine, region);
  return targetId;
}

function updateNameIfChanged(
  db,
  playerId,
  newName,
  newTag,
  region,
  alreadyLocked,
) {
  const row = db
    .prepare(
      "SELECT riot_game_name, riot_tag_line, name_locked FROM players WHERE id = ?",
    )
    .get(playerId);

  const locked =
    alreadyLocked !== undefined ? alreadyLocked : !!row.name_locked;
  if (locked) return false; // admin has locked this player's name from auto-sync

  const { riot_game_name: oldName, riot_tag_line: oldTag } = row;
  if (oldName === newName && oldTag === newTag) return false;

  db.prepare(
    "UPDATE players SET riot_game_name = ?, riot_tag_line = ?, riot_region = ? WHERE id = ?",
  ).run(newName, newTag, region, playerId);

  if (oldName !== null && oldName !== undefined) {
    // don't log a "history" entry for a first-time assignment
    db.prepare(
      `INSERT INTO name_history (player_id, old_name, old_tag, new_name, new_tag)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(playerId, oldName, oldTag, newName, newTag);
  }
  return true;
}

/**
 * Attempts to resolve every queued pending_lookups row to a PUUID.
 * `fetchAccountByRiotId` is injectable for testing (defaults to the real
 * getAccountByRiotId, which requires RIOT_API_KEY and real network access).
 */
async function resolvePending(
  db,
  { limit = 500, fetchAccountByRiotId = getAccountByRiotId } = {},
) {
  const rows = db
    .prepare(
      `SELECT raw_name, game_name, tag_line, region FROM pending_lookups
       WHERE game_name IS NOT NULL AND game_name != ''
         AND tag_line IS NOT NULL AND tag_line != ''
       ORDER BY attempts ASC LIMIT ?`,
    )
    .all(limit);

  let resolved = 0;
  let failed = 0;

  for (const row of rows) {
    const region = row.region || DEFAULT_REGION;
    let account;
    try {
      account = await fetchAccountByRiotId(region, row.game_name, row.tag_line);
    } catch (err) {
      failed += 1;
      db.prepare(
        `UPDATE pending_lookups
         SET attempts = attempts + 1, last_attempt = datetime('now'), last_error = ?
         WHERE raw_name = ?`,
      ).run(String(err.message || err), row.raw_name);
      continue;
    }

    applyResolvedAccount(
      db,
      row.raw_name,
      account.puuid,
      account.gameName,
      account.tagLine,
      region,
    );
    db.prepare("DELETE FROM pending_lookups WHERE raw_name = ?").run(
      row.raw_name,
    );
    resolved += 1;
  }

  return { resolved, failed, attempted: rows.length };
}

/**
 * Re-fetches current Riot ID for players who already have a PUUID, to catch
 * renames. `fetchAccountByPuuid` is injectable for testing.
 */
async function refreshKnown(
  db,
  { limit = 500, fetchAccountByPuuid = getAccountByPuuid } = {},
) {
  const rows = db
    .prepare(
      `SELECT id, puuid, riot_game_name, riot_tag_line, riot_region, name_locked
       FROM players WHERE puuid IS NOT NULL
       ORDER BY last_synced ASC LIMIT ?`,
    )
    .all(limit);

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows) {
    const region = row.riot_region || DEFAULT_REGION;
    let account;
    try {
      account = await fetchAccountByPuuid(region, row.puuid);
    } catch (err) {
      failed += 1;
      continue;
    }

    db.prepare(
      "UPDATE players SET last_synced = datetime('now') WHERE id = ?",
    ).run(row.id);
    const changed = updateNameIfChanged(
      db,
      row.id,
      account.gameName,
      account.tagLine,
      region,
      !!row.name_locked,
    );
    if (changed) updated += 1;
    else unchanged += 1;
  }

  return { updated, unchanged, failed };
}

async function runFullSync(db, options = {}) {
  const pendingResult = await resolvePending(db, options);
  const refreshResult = await refreshKnown(db, options);
  return { pending: pendingResult, refresh: refreshResult };
}

module.exports = {
  RiotApiError,
  riotFetch,
  getAccountByRiotId,
  getAccountByPuuid,
  applyResolvedAccount,
  updateNameIfChanged,
  resolvePending,
  refreshKnown,
  runFullSync,
  VALID_REGIONS,
};
