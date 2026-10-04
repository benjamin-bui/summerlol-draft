const test = require("node:test");
const assert = require("node:assert/strict");
const {
  refreshKnown,
  refreshRankedStats,
  resolvePending,
} = require("../src/lib/riot-sync");

function fakeDb() {
  return {
    prepare(sql) {
      return {
        all() {
          if (sql.includes("pending_lookups")) {
            return [{ raw_name: "newplayer#na1", game_name: "New Player", tag_line: "NA1" }];
          }
          if (sql.includes("ORDER BY last_synced")) {
            return [{ id: 1, puuid: "puuid-1", riot_game_name: "Known", riot_tag_line: "NA1" }];
          }
          return [{ id: 2, puuid: "puuid-2", riot_game_name: "Ranked", riot_tag_line: "NA1", display_name_override: null }];
        },
        run() {},
      };
    },
  };
}

test("sync phases report the player being processed before each request", async () => {
  const events = [];
  const requests = [];
  const db = fakeDb();
  const options = { onProgress: (event) => events.push(event) };
  const failRequest = (phase) => async () => {
    requests.push({ phase, event: events.at(-1) });
    throw new Error("offline");
  };

  await resolvePending(db, {
    ...options,
    fetchAccountByRiotId: failRequest("pending"),
  });
  await refreshKnown(db, {
    ...options,
    fetchAccountByPuuid: failRequest("refresh"),
  });
  await refreshRankedStats(db, {
    ...options,
    fetchLeagueEntries: failRequest("ranked"),
  });

  assert.deepEqual(
    requests.map(({ phase, event }) => ({ phase, event: event.event, label: event.label })),
    [
      { phase: "pending", event: "processing", label: "newplayer#na1" },
      { phase: "refresh", event: "processing", label: "Known#NA1" },
      { phase: "ranked", event: "processing", label: "Ranked#NA1" },
    ],
  );
  assert.deepEqual(
    events.filter((event) => event.event === "tick").map((event) => event.status),
    ["failed", "failed", "failed"],
  );
});