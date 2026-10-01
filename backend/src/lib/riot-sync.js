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
 *
 * PROGRESS REPORTING
 * ------------------
 * resolvePending / refreshKnown / refreshRankedStats / runFullSync all take
 * an optional `onProgress` callback in their options object:
 *
 *   onProgress({ phase, event, current, total, label })
 *
 *   phase: 'pending' | 'refresh' | 'ranked'
 *   event: 'start' | 'tick' | 'end'
 *   current/total: row counts within the current phase (only on 'tick'/'end')
 *   label: short human string, e.g. the raw name or player id being processed
 *
 * It's a plain callback (not an EventEmitter) so it stays trivial to pass
 * through nested calls and trivial to no-op in tests — callers who don't
 * pass one get a default no-op and behavior is unchanged.
 */

const RIOT_API_KEY = process.env.RIOT_API_KEY || "";
const DEFAULT_REGION = process.env.RIOT_REGION || "americas";

// Regional routing values account-v1 accepts. NA/BR/LAN/LAS/OCE all route
// through 'americas' — this is Riot's account-v1 routing, NOT platform
// routing (na1/euw1/etc), which is a different, unrelated concept.
const VALID_REGIONS = new Set(["americas", "europe", "asia", "sea"]);

const REGIONAL_TO_PLATFORM = {
  americas: "na1",
  europe: "euw1",
  asia: "kr",
};

function platformHost(regionalRegion) {
  return REGIONAL_TO_PLATFORM[regionalRegion] || regionalRegion;
}

// Default no-op progress callback so every internal call site can invoke
// onProgress(...) unconditionally without an "if (onProgress)" guard.
const noopProgress = () => {};

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
  const currentDisplayName = `${newName}#${newTag}`;
  db.prepare(
    "INSERT OR IGNORE INTO player_aliases (alias, player_id) VALUES (?, ?)",
  ).run(currentDisplayName, playerId);

  // Keep the CSV-backed draft rows in sync with the current Riot ID. The
  // alias table still retains historical spellings for identity resolution,
  // but the data shown/exported as draft data should use the current name.
  const aliases = db
    .prepare("SELECT alias FROM player_aliases WHERE player_id = ?")
    .all(playerId)
    .map((alias) => alias.alias);
  if (aliases.length) {
    const placeholders = aliases.map(() => "?").join(", ");
    db.prepare(
      `UPDATE rows SET Player = ? WHERE Player IN (${placeholders})`,
    ).run(currentDisplayName, ...aliases);
    db.prepare(
      `UPDATE rows SET Captain = ? WHERE Captain IN (${placeholders})`,
    ).run(currentDisplayName, ...aliases);
  }

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
  {
    limit = 500,
    fetchAccountByRiotId = getAccountByRiotId,
    onProgress = noopProgress,
  } = {},
) {
  const rows = db
    .prepare(
      `SELECT raw_name, game_name, tag_line, region FROM pending_lookups
       WHERE game_name IS NOT NULL AND game_name != ''
         AND tag_line IS NOT NULL AND tag_line != ''
       ORDER BY attempts ASC LIMIT ?`,
    )
    .all(limit);

  const total = rows.length;
  onProgress({ phase: "pending", event: "start", total });

  let resolved = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
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
      onProgress({
        phase: "pending",
        event: "tick",
        current: i + 1,
        total,
        label: row.raw_name,
      });
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
    onProgress({
      phase: "pending",
      event: "tick",
      current: i + 1,
      total,
      label: row.raw_name,
    });
  }

  onProgress({ phase: "pending", event: "end", total });
  return { resolved, failed, attempted: rows.length };
}

/**
 * Re-fetches current Riot ID for players who already have a PUUID, to catch
 * renames. `fetchAccountByPuuid` is injectable for testing.
 */
async function refreshKnown(
  db,
  {
    limit = 500,
    fetchAccountByPuuid = getAccountByPuuid,
    onProgress = noopProgress,
  } = {},
) {
  const rows = db
    .prepare(
      `SELECT id, puuid, riot_game_name, riot_tag_line, riot_region, name_locked
       FROM players WHERE puuid IS NOT NULL
       ORDER BY last_synced ASC LIMIT ?`,
    )
    .all(limit);

  const total = rows.length;
  onProgress({ phase: "refresh", event: "start", total });

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const region = row.riot_region || DEFAULT_REGION;
    const label = row.riot_game_name
      ? `${row.riot_game_name}#${row.riot_tag_line}`
      : `player ${row.id}`;
    let account;
    try {
      account = await fetchAccountByPuuid(region, row.puuid);
    } catch (err) {
      failed += 1;
      onProgress({
        phase: "refresh",
        event: "tick",
        current: i + 1,
        total,
        label,
      });
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
    onProgress({
      phase: "refresh",
      event: "tick",
      current: i + 1,
      total,
      label,
    });
  }

  onProgress({ phase: "refresh", event: "end", total });
  return { updated, unchanged, failed };
}

// Tracking rank status

const TRACKED_QUEUES = [
  "RANKED_SOLO_5x5",
  "RANKED_FLEX_SR",
  "RANKED_PREMADE_5x5",
];

async function getLeagueEntriesByPuuid(platform, puuid) {
  const path = `${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`;
  return riotFetch(path); // returns Set[LeagueEntryDTO] -- reuses the existing rate-limit/retry wrapper
}

// Writes one row per tracked queue for this player, EVERY sync pass --
// a queue with no matching entry this time gets explicitly written as
// UNRANKED rather than leaving whatever tier/division was there before.
// This is what makes "rank always reflects current state" true even
// for someone who's dropped out of ranked entirely since the last sync.
function upsertRankedStats(db, playerId, queueType, entry) {
  const tier = entry ? entry.tier : "UNRANKED";
  const division = entry ? entry.rank : null;
  const leaguePoints = entry ? entry.leaguePoints : 0;

  db.prepare(
    `
    INSERT INTO player_ranked_stats (player_id, queue_type, tier, division, league_points, synced_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(player_id, queue_type) DO UPDATE SET
      tier = excluded.tier,
      division = excluded.division,
      league_points = excluded.league_points,
      synced_at = excluded.synced_at
  `,
  ).run(playerId, queueType, tier, division, leaguePoints);
}

/**
 * Re-fetches every tracked player's league entries and writes current
 * tier/division/leaguePoints for all three tracked queues. `fetchLeagueEntries`
 * is injectable for testing, same convention as resolvePending/refreshKnown.
 */
async function refreshRankedStats(
  db,
  {
    limit = 500,
    fetchLeagueEntries = getLeagueEntriesByPuuid,
    onProgress = noopProgress,
  } = {},
) {
  const rows = db
    .prepare(
      `SELECT id, puuid, riot_region FROM players WHERE puuid IS NOT NULL ORDER BY id ASC LIMIT ?`,
    )
    .all(limit);

  const total = rows.length;
  onProgress({ phase: "ranked", event: "start", total });

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const region = row.riot_region || DEFAULT_REGION;
    const platform = platformHost(region); // league-v4 is PLATFORM-routed, not regional -- see platformHost above
    const label = `player ${row.id}`;

    let entries;
    try {
      entries = await fetchLeagueEntries(platform, row.puuid);
    } catch (err) {
      failed += 1;
      onProgress({
        phase: "ranked",
        event: "tick",
        current: i + 1,
        total,
        label,
      });
      continue;
    }

    for (const queueType of TRACKED_QUEUES) {
      const entry = entries.find((e) => e.queueType === queueType) || null;
      upsertRankedStats(db, row.id, queueType, entry);
    }
    updated += 1;
    onProgress({
      phase: "ranked",
      event: "tick",
      current: i + 1,
      total,
      label,
    });
  }

  onProgress({ phase: "ranked", event: "end", total });
  return { updated, failed };
}

async function runFullSync(db, options = {}) {
  const pendingResult = await resolvePending(db, options);
  const refreshResult = await refreshKnown(db, options);
  const rankedResult = await refreshRankedStats(db, options);
  return {
    pending: pendingResult,
    refresh: refreshResult,
    ranked: rankedResult,
  };
}

module.exports = {
  RiotApiError,
  riotFetch,
  getAccountByRiotId,
  getAccountByPuuid,
  getLeagueEntriesByPuuid,
  applyResolvedAccount,
  updateNameIfChanged,
  upsertRankedStats,
  resolvePending,
  refreshKnown,
  refreshRankedStats,
  runFullSync,
  VALID_REGIONS,
};
