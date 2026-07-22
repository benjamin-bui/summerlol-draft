-- Player identity schema — additive to the existing `rows` table, which is
-- left completely untouched. Ported from a reference FastAPI project's
-- design (players/player_aliases/pending_lookups/name_history), adapted to
-- sit alongside this app's existing CSV-driven `rows` table rather than
-- replacing it.
--
-- Design: PUUID is the permanent identity key once resolved. `player_aliases`
-- maps every raw spelling ever seen in the "Player" column (e.g. "Rlylost",
-- "rlylost", "Xemacs#4328 (Santiago)") to one canonical player row, so the
-- stats calculation can group by true identity instead of exact string match
-- once resolution has happened — while any alias that hasn't been resolved
-- yet just falls back to being grouped by its raw string, so nothing breaks
-- for players who aren't identified.

CREATE TABLE IF NOT EXISTS players (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    puuid                 TEXT UNIQUE,            -- internal only, never returned by the API
    riot_game_name        TEXT,                   -- current Riot ID name portion
    riot_tag_line         TEXT,                   -- current Riot ID tag portion
    riot_region           TEXT DEFAULT 'americas',-- regional routing used for account-v1
    display_name_override TEXT,                   -- manual correction; always wins over riot_*
    name_locked           INTEGER DEFAULT 0,      -- 1 = sync will not overwrite riot_* fields
    last_synced           TEXT,
    created_at            TEXT DEFAULT (datetime('now'))
);


-- Aliases queued for Riot lookup but not yet resolved (either no
-- game_name/tag_line known yet, or looked up and failed/not found).
CREATE TABLE IF NOT EXISTS pending_lookups (
    raw_name      TEXT PRIMARY KEY,
    game_name     TEXT,
    tag_line      TEXT,
    region        TEXT DEFAULT 'americas',
    attempts      INTEGER DEFAULT 0,
    last_attempt  TEXT,
    last_error    TEXT
);

CREATE TABLE IF NOT EXISTS name_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    old_name    TEXT,
    old_tag     TEXT,
    new_name    TEXT,
    new_tag     TEXT,
    changed_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_player_aliases_player ON player_aliases(player_id);

-- Tiny key-value store for the automatic periodic sync (see
-- data/scheduler.js) to track when it last ran, so a container restart
-- doesn't force an immediate re-sync if the 14-day window hasn't elapsed.
CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);
