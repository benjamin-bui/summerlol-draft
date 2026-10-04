/**
 * CLI entrypoint: runs the full Riot sync (resolve pending lookups, then
 * refresh already-known players to catch renames) against the real Riot
 * API. Requires RIOT_API_KEY in the environment.
 *
 */

const path = require("path");
const Database = require("better-sqlite3");
const { runFullSync } = require(
  path.join(__dirname, "..", "lib", "riot-sync.js"),
);
const DB_PATH = path.join(__dirname, "..", "..", "data", "app.db");
const PHASES = {
  pending: { step: "1/3", label: "Resolving pending lookups" },
  refresh: { step: "2/3", label: "Refreshing known Riot IDs" },
  ranked: { step: "3/3", label: "Refreshing ranked stats" },
};

function reportProgress({ phase, event, current, total, label, status }) {
  const phaseInfo = PHASES[phase];
  if (!phaseInfo) return;

  if (event === "start") {
    console.log(`\nStep ${phaseInfo.step}: ${phaseInfo.label} (${total} ${total === 1 ? "player" : "players"})`);
    return;
  }

  if (event === "end") {
    const line = total ? `  Complete: ${total}/${total}` : "  No players to process.";
    if (process.stdout.isTTY) process.stdout.write(`\r${line}\u001b[K\n`);
    else console.log(line);
    return;
  }

  const safeLabel = String(label || "unknown player").replace(/\s+/g, " ").trim();
  const count = `[${current}/${total}]`;
  if (event === "processing") {
    if (process.stdout.isTTY) {
      process.stdout.write(`\r  ${count} Processing ${safeLabel}...\u001b[K`);
    } else console.log(`  ${count} Processing ${safeLabel}...`);
    return;
  }

  if (event === "tick") {
    const result = status === "failed" ? "Failed" : "Finished";
    const line = `  ${count} ${result}: ${safeLabel}`;
    if (process.stdout.isTTY) process.stdout.write(`\r${line}\u001b[K`);
    else if (status === "failed" || current === total || current % 10 === 0) console.log(line);
  }
}

(async () => {
  if (!process.env.RIOT_API_KEY) {
    console.error("RIOT_API_KEY environment variable is not set.");
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  console.log("Running Riot sync...");
  const result = await runFullSync(db, { onProgress: reportProgress });
  db.close();

  console.log("\nPending lookups pass:");
  console.log(`  resolved: ${result.pending.resolved}`);
  console.log(`  failed:   ${result.pending.failed}`);
  console.log(`  attempted: ${result.pending.attempted}`);

  console.log("\nRefresh-known pass:");
  console.log(`  updated (renamed):   ${result.refresh.updated}`);
  console.log(`  unchanged:           ${result.refresh.unchanged}`);
  console.log(`  failed:              ${result.refresh.failed}`);

  console.log("\nRanked stats pass:");
  console.log(`  updated: ${result.ranked.updated}`);
  console.log(`  failed:  ${result.ranked.failed}`);
})();
