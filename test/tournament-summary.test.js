const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildChampionStats,
  computeChampionDiversity,
  buildTournamentSummaries,
  giniCoefficient,
} = require("../src/lib/tournament-summary");
const { championKey } = require("../src/lib/champion-releases");

const resolve = (name) => name;
const ban = (champion) => ({ champion, key: championKey(champion) });

// A game between team A (players a1, a2) and team B (b1, b2).
// picks: [[player, champion, role?], ...]; bans: { team1: [champion...], team2: [...] }
function game({ picks = [], bans = {}, winner = "team1", order = 1 } = {}) {
  const side = (key, ids) => ({
    key,
    name: key,
    avg: 1000,
    avgMu: 1000,
    roster: ids.map((id) => ({
      identityKey: id,
      displayName: id,
      conservativeRating: 1000,
      mu: 1000,
    })),
  });
  return {
    matchKey: `m${order}`,
    year: 2026,
    tournament: "Summer",
    matchStage: "Groups",
    winner,
    predictedWinProbTeam1: 0.5,
    team1: side("A", ["a1", "a2"]),
    team2: side("B", ["b1", "b2"]),
    details: picks.map(([player, champion, role]) => ({
      player,
      champion,
      role: role ?? null,
      kills: 1,
      deaths: 1,
      assists: 1,
    })),
    bans: {
      team1: (bans.team1 || []).map(ban),
      team2: (bans.team2 || []).map(ban),
    },
  };
}
const byChampion = (stats, name) => stats.find((c) => c.champion === name);

test("a champion picked or banned in a game is contested once for that game", () => {
  const { stats, gamesWithDetails, gamesWithBans, gamesWithChampionData } =
    buildChampionStats(
      [
        game({
          picks: [["a1", "Ahri"], ["b1", "Zed"]],
          bans: { team1: ["Yasuo"], team2: ["Lux"] },
          order: 1,
        }),
        game({
          picks: [["a1", "Ahri"], ["b1", "Garen"]],
          bans: { team2: ["Zed"] },
          order: 2,
        }),
      ],
      resolve,
    );
  assert.equal(gamesWithDetails, 2);
  assert.equal(gamesWithBans, 2);
  assert.equal(gamesWithChampionData, 2);

  const ahri = byChampion(stats, "Ahri");
  assert.deepEqual([ahri.games, ahri.bans, ahri.contested], [2, 0, 2]);
  const zed = byChampion(stats, "Zed"); // picked game 1, banned game 2
  assert.deepEqual([zed.games, zed.bans, zed.contested], [1, 1, 2]);
  const yasuo = byChampion(stats, "Yasuo"); // only ever banned
  assert.deepEqual([yasuo.games, yasuo.bans, yasuo.contested], [0, 1, 1]);
  assert.equal(yasuo.winRate, null);
});

test("a ban counts once per game even if both teams (or several rows) list it", () => {
  const { stats } = buildChampionStats(
    [game({ bans: { team1: ["Yasuo", "yasuo"], team2: ["Yasuo"] } })],
    resolve,
  );
  const yasuo = byChampion(stats, "Yasuo");
  assert.equal(yasuo.bans, 1);
  assert.equal(yasuo.contested, 1);
});

test("contested never exceeds games, even for data that picks a banned champion", () => {
  // Can't happen in a real draft -- but if the CSV says it did, the champion
  // is still contested once in that game, not twice.
  const { stats, gamesWithChampionData } = buildChampionStats(
    [game({ picks: [["a1", "Yasuo"]], bans: { team2: ["Yasuo"] } })],
    resolve,
  );
  const yasuo = byChampion(stats, "Yasuo");
  assert.equal(yasuo.contested, 1);
  assert.ok(yasuo.contested / gamesWithChampionData <= 1);
});

test("a game with bans but no pick rows still counts toward champion data", () => {
  const { gamesWithDetails, gamesWithBans, gamesWithChampionData, stats } =
    buildChampionStats(
      [
        game({ picks: [["a1", "Ahri"]], order: 1 }),
        game({ bans: { team1: ["Zed"] }, order: 2 }),
      ],
      resolve,
    );
  assert.equal(gamesWithDetails, 1);
  assert.equal(gamesWithBans, 1);
  assert.equal(gamesWithChampionData, 2);
  assert.equal(byChampion(stats, "Zed").contested, 1);
});

test("with no bans, diversity is the Gini of pick rates -- unchanged from before bans existed", () => {
  const games = [
    game({ picks: [["a1", "Ahri"], ["b1", "Zed"]], order: 1 }),
    game({ picks: [["a1", "Ahri"], ["b1", "Garen"]], order: 2 }),
  ];
  const { stats, gamesWithDetails, gamesWithChampionData } = buildChampionStats(
    games,
    resolve,
  );
  const diversity = computeChampionDiversity(stats, gamesWithChampionData, 2026);

  // Reference: the old definition, Gini over pick rates across the pool.
  const {
    championKeysAvailableIn,
  } = require("../src/lib/champion-releases");
  const pool = new Set(championKeysAvailableIn(2026));
  stats.forEach((c) => pool.add(c.key));
  const picksByKey = new Map(stats.map((c) => [c.key, c.games]));
  const expected = giniCoefficient(
    [...pool].map((k) => (picksByKey.get(k) || 0) / gamesWithDetails),
  );
  assert.equal(diversity.gini, Math.round(expected * 1000) / 1000);
  assert.equal(diversity.championsBanned, 0);
});

test("diversity uses contest rate: a never-picked but always-banned champion counts as contested", () => {
  const picks = [["a1", "Ahri"], ["b1", "Zed"]];
  const noBans = buildChampionStats(
    [game({ picks, order: 1 }), game({ picks, order: 2 })],
    resolve,
  );
  const withBans = buildChampionStats(
    [
      game({ picks, bans: { team1: ["Yasuo"] }, order: 1 }),
      game({ picks, bans: { team1: ["Yasuo"] }, order: 2 }),
    ],
    resolve,
  );
  const before = computeChampionDiversity(noBans.stats, noBans.gamesWithChampionData, 2026);
  const after = computeChampionDiversity(withBans.stats, withBans.gamesWithChampionData, 2026);

  // Independent reference: Gini over (games picked or banned in) / games,
  // across the whole 2026 pool. Yasuo is banned in both games, so it sits at
  // the same 100% contest rate as the two picked champions.
  const { championKeysAvailableIn } = require("../src/lib/champion-releases");
  const pool = championKeysAvailableIn(2026);
  const contestRate = (contested) => pool.map((k) => (contested[k] || 0) / 2);
  const expected = giniCoefficient(contestRate({ ahri: 2, zed: 2, yasuo: 2 }));
  assert.equal(after.gini, Math.round(expected * 1000) / 1000);
  assert.equal(after.championsPicked, 2);
  assert.equal(after.championsBanned, 1);
  assert.equal(after.championsContested, 3);
  // More champions carrying the same demand = more evenly spread = lower Gini.
  assert.ok(after.gini < before.gini);
});

function summarize(games) {
  return buildTournamentSummaries({
    games,
    matches: games.map((g, i) => ({ matchKey: g.matchKey, matchOrder: i + 1 })),
    draftRows: [],
    identityMap: new Map(),
    tournamentEntryRatings: [],
    defaultConservativeRating: 0,
  })[0];
}

test("Most Banned / Most Contested are null when no bans are recorded", () => {
  const t = summarize([game({ picks: [["a1", "Ahri"]] })]);
  assert.equal(t.summary.mostBanned, null);
  assert.equal(t.summary.mostContested, null);
  assert.equal(t.championCoverage.gamesWithBans, 0);
});

test("Most Banned and Most Contested, with ties returned together", () => {
  const t = summarize([
    game({
      picks: [["a1", "Ahri"], ["b1", "Garen"]],
      bans: { team1: ["Yasuo"], team2: ["Zed"] },
      order: 1,
    }),
    game({
      picks: [["a1", "Ahri"], ["b1", "Lux"]],
      bans: { team1: ["Yasuo"], team2: ["Zed"] },
      order: 2,
    }),
    game({
      picks: [["a1", "Ahri"], ["b1", "Lux"]],
      bans: { team1: ["Thresh"] },
      order: 3,
    }),
  ]);
  // Yasuo and Zed each banned in 2 of the 3 games with bans.
  assert.deepEqual(t.summary.mostBanned.champions.sort(), ["Yasuo", "Zed"]);
  assert.equal(t.summary.mostBanned.bans, 2);
  assert.equal(t.summary.mostBanned.banRate, 0.667);
  // Ahri was picked in all 3 games -> most contested, once per game.
  assert.deepEqual(t.summary.mostContested.champions, ["Ahri"]);
  assert.equal(t.summary.mostContested.contested, 3);
  assert.equal(t.summary.mostContested.contestRate, 1);
  // Most picked is unaffected by bans and ignores ban-only champions.
  assert.deepEqual(t.summary.mostPicked.champions, ["Ahri"]);
  // Ban-only champions are in the champion table with no win rate.
  const yasuo = t.championStats.find((c) => c.champion === "Yasuo");
  assert.deepEqual([yasuo.games, yasuo.bans, yasuo.contested, yasuo.winRate], [0, 2, 2, null]);
  assert.equal(t.championCoverage.gamesWithBans, 3);
});

test("each match lists the bans of its own two teams", () => {
  const t = summarize([
    game({ bans: { team1: ["Yasuo"], team2: ["Zed", "Lux"] } }),
  ]);
  const m = t.matches[0];
  assert.equal(m.hasBans, true);
  assert.deepEqual(m.team1.bans.map((b) => b.champion), ["Yasuo"]);
  assert.deepEqual(m.team2.bans.map((b) => b.champion), ["Zed", "Lux"]);
  assert.equal(m.team1.bans[0].championKey, "yasuo");
});

test("each match roster entry carries the player's role (null when none recorded)", () => {
  const t = summarize([
    game({ picks: [["a1", "Ahri", "Mid"], ["a2", "Ashe"], ["b1", "Zed", "Jungle"]] }),
  ]);
  const roles = (side) => Object.fromEntries(side.roster.map((p) => [p.identityKey, p.role]));
  assert.deepEqual(roles(t.matches[0].team1), { a1: "Mid", a2: null });
  assert.deepEqual(roles(t.matches[0].team2), { b1: "Jungle", b2: null });
});
