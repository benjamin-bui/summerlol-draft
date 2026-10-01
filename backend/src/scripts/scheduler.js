/**
 * Automatic periodic Riot sync — runs resolvePending + refreshKnown every
 * 14 days (configurable), so renames/new tags get picked up without
 * anyone needing to remember to run `npm run sync-riot` by hand.
 *
 * The 14-day clock is persisted in the `sync_state` table (not just an
 * in-memory timer), so restarting the container doesn't reset the
 * countdown or cause an immediate re-sync every time it restarts within
 * the window.
 *
 * No-ops entirely (logs a note once, does nothing further) if
 * RIOT_API_KEY isn't set — same as every other Riot-touching piece of
 * this app, it degrades gracefully rather than erroring.
 */

const fs = require("fs");
const path = require("path");
const { runFullSync } = require("../lib/riot-sync");

const SCHEMA_PATH = path.join(__dirname, "..", "db", "identity-schema.sql");
const SYNC_STATE_KEY = "last_full_sync";
const DEFAULT_INTERVAL_DAYS = 14;
// How often to check whether the 14 days have elapsed — doesn't need to
// be frequent, this is just polling a wall-clock condition.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

function ensureSchema(db) {
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf-8"));
}

function getLastSyncTime(db) {
  const row = db
    .prepare("SELECT value FROM sync_state WHERE key = ?")
    .get(SYNC_STATE_KEY);
  return row ? new Date(row.value) : null;
}

function setLastSyncTime(db, date) {
  db.prepare(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SYNC_STATE_KEY, date.toISOString());
}

function isDue(db, intervalDays) {
  const last = getLastSyncTime(db);
  if (!last) return true; // never run before
  const elapsedMs = Date.now() - last.getTime();
  return elapsedMs >= intervalDays * 24 * 60 * 60 * 1000;
}

async function runIfDue(db, intervalDays, runFullSyncFn = runFullSync) {
  if (!isDue(db, intervalDays)) return { ran: false };

  console.log(
    `[scheduler] ${intervalDays}-day interval elapsed (or first run) — running automatic Riot sync...`,
  );
  try {
    const result = await runFullSyncFn(db);
    setLastSyncTime(db, new Date());
    console.log(
      `[scheduler] sync complete — resolved: ${result.pending.resolved}, ` +
        `renamed: ${result.refresh.updated}, failed: ${result.pending.failed + result.refresh.failed}`,
    );
    return { ran: true, result };
  } catch (err) {
    console.error("[scheduler] automatic sync failed:", err.message);
    // deliberately do NOT update last_full_sync on failure, so the next
    // periodic check retries rather than waiting a full 14 days again
    return { ran: false, error: err.message };
  }
}

/**
 * Starts the periodic check. Safe to call even if RIOT_API_KEY isn't set
 * or identity tables don't exist yet — no-ops in both cases rather than
 * throwing, matching the rest of this feature's degrade-gracefully
 * posture. Returns the interval handle (or null if not started), mainly
 * so tests can clearInterval it.
 */
function startPeriodicSync(
  db,
  {
    intervalDays = DEFAULT_INTERVAL_DAYS,
    checkIntervalMs = CHECK_INTERVAL_MS,
    runFullSyncFn = runFullSync,
  } = {},
) {
  if (!process.env.RIOT_API_KEY) {
    console.log(
      "[scheduler] RIOT_API_KEY not set — automatic 14-day sync is disabled.",
    );
    return null;
  }

  ensureSchema(db);

  // Check once at startup (fire-and-forget — don't block server startup
  // on a network call), then on the regular interval after that.
  runIfDue(db, intervalDays, runFullSyncFn);
  const handle = setInterval(
    () => runIfDue(db, intervalDays, runFullSyncFn),
    checkIntervalMs,
  );
  // Don't let this timer keep the process alive on its own if everything
  // else has shut down.
  if (handle.unref) handle.unref();

  console.log(
    `[scheduler] automatic Riot sync scheduled every ${intervalDays} days.`,
  );
  return handle;
}

module.exports = {
  startPeriodicSync,
  runIfDue,
  isDue,
  getLastSyncTime,
  setLastSyncTime,
};
