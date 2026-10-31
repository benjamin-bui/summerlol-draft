const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRoundRobinGroups } = require("../src/lib/round-robin");
const { buildTournamentSummaries } = require("../src/lib/tournament-summary");

const resolve = (name) => name.toLowerCase();
const nameOf = (key, fallback) => fallback || key;
const side = (name) => ({ key: name.toLowerCase(), name });

// One series group: each result is the winning team name or "draw".
let order = 0;
function series(team1, team2, results, roundLabel = null) {
  return {
    seriesId: `s${order}`,
    roundLabel,
    bestOf: results.length,
    games: results.map((winner) => {
      order += 1;
      return {
        matchKey: `m${order}`,
        order,
        team1: side(team1),
        team2: side(team2),
        winner: winner === "draw" ? "draw" : winner === team1 ? "team1" : "team2",
      };
    }),
  };
}

test("group standings rank by match record, then game difference", () => {
  const { groups, ungrouped } = buildRoundRobinGroups({
    definedGroups: [{ groupId: "g1", name: "Group A", order: 1, teams: ["Alpha", "Beta", "Gamma", "Idle"] }],
    seriesGroups: [
      series("Alpha", "Beta", ["Alpha", "Alpha"]),
      series("Alpha", "Gamma", ["Gamma", "Alpha", "Alpha"]),
      series("Beta", "Gamma", ["Beta", "Beta"]),
    ],
    resolve,
    nameOf,
  });
  assert.equal(ungrouped.length, 0);
  const rows = groups[0].standings;
  // Alpha 2-0, Beta 1-1, Gamma 0-2. A team with no games is still listed, and
  // since fewer match losses sort first it sits above Gamma's 0-2.
  assert.deepEqual(rows.map((row) => [row.name, row.rank, row.matchWins, row.matchLosses]), [
    ["Alpha", 1, 2, 0],
    ["Beta", 2, 1, 1],
    ["Idle", 3, 0, 0],
    ["Gamma", 4, 0, 2],
  ]);
  assert.deepEqual([rows[0].gameWins, rows[0].gameLosses, rows[0].gameDiff], [4, 1, 3]);
  assert.deepEqual(rows[0].vs.gamma, { gamesFor: 2, gamesAgainst: 1, matches: 1, outcome: "win" });
  assert.equal(rows[3].vs.alpha.outcome, "loss");
  assert.equal(rows[0].vs.idle, undefined);
});

test("a split series is a drawn match and drawn games are tracked separately", () => {
  const { groups } = buildRoundRobinGroups({
    definedGroups: [{ groupId: "g1", name: "A", order: 1, teams: ["Alpha", "Beta"] }],
    seriesGroups: [series("Alpha", "Beta", ["Alpha", "Beta"]), series("Alpha", "Beta", ["draw"])],
    resolve,
    nameOf,
  });
  const [alpha] = groups[0].standings;
  assert.deepEqual([alpha.matchWins, alpha.matchDraws, alpha.matchLosses], [0, 2, 0]);
  assert.deepEqual([alpha.gameWins, alpha.gameLosses, alpha.gameDraws], [1, 1, 1]);
  assert.equal(groups[0].hasDraws, true);
  assert.equal(alpha.vs.beta.outcome, "draw");
  assert.equal(alpha.vs.beta.matches, 2);
});

test("series between teams of different groups, or outside any group, are ungrouped", () => {
  const cross = series("Alpha", "Gamma", ["Alpha"]);
  const stranger = series("Alpha", "Zed", ["Zed"]);
  const inside = series("Alpha", "Beta", ["Beta"]);
  const { groups, ungrouped } = buildRoundRobinGroups({
    definedGroups: [
      { groupId: "g2", name: "B", order: 2, teams: ["Gamma"] },
      { groupId: "g1", name: "A", order: 1, teams: ["Alpha", "Beta"] },
    ],
    seriesGroups: [cross, stranger, inside],
    resolve,
    nameOf,
  });
  assert.deepEqual(groups.map((group) => group.name), ["A", "B"]);
  assert.deepEqual(ungrouped, [cross, stranger]);
  assert.deepEqual(groups[0].seriesGroups, [inside]);
  assert.equal(groups[1].standings[0].matchWins + groups[1].standings[0].matchLosses, 0);
});

test("tournament summaries attach round-robin standings and keep other stages unchanged", () => {
  const makeGame = (matchKey, t1, t2, winner) => ({
    matchKey,
    year: 2026,
    tournament: "Summer",
    matchStage: null,
    winner,
    predictedWinProbTeam1: 0.5,
    // With no identity mapping a team's key is its raw name, as in production.
    team1: { key: t1, name: t1, roster: [], avg: 0, avgMu: 0 },
    team2: { key: t2, name: t2, roster: [], avg: 0, avgMu: 0 },
    details: [],
    bans: { team1: [], team2: [] },
  });
  const rr = { stageId: "stage-rr", stage: { stageName: "Groups", stageFormat: "round-robin", stageOrder: 1 } };
  const po = { stageId: "stage-po", stage: { stageName: "Playoffs", stageFormat: "single-elimination", stageOrder: 2 } };
  const games = [
    makeGame("k1", "Alpha", "Beta", "team1"),
    makeGame("k2", "Gamma", "Delta", "team2"),
    makeGame("k3", "Alpha", "Delta", "team1"),
  ];
  const matches = [
    { matchKey: "k1", matchOrder: 1, round: "Week 1", ...rr },
    { matchKey: "k2", matchOrder: 2, ...rr },
    { matchKey: "k3", matchOrder: 3, ...po },
  ];
  const [summary] = buildTournamentSummaries({
    games,
    matches,
    draftRows: [],
    identityMap: new Map(),
    tournamentEntryRatings: [],
    defaultConservativeRating: 0,
    stageGroups: new Map([
      ["stage-rr", [
        { groupId: "ga", name: "Group A", order: 1, teams: ["Alpha", "Beta"] },
        { groupId: "gb", name: "Group B", order: 2, teams: ["Gamma", "Delta"] },
      ]],
      // Groups on a non-round-robin stage are ignored.
      ["stage-po", [{ groupId: "gx", name: "X", order: 1, teams: ["Alpha"] }]],
    ]),
  });
  const [groupsStage, playoffs] = summary.stages;
  assert.equal(groupsStage.roundRobin.groups.length, 2);
  assert.deepEqual(groupsStage.roundRobin.groups[0].standings.map((row) => row.name), ["Alpha", "Beta"]);
  assert.deepEqual(groupsStage.roundRobin.groups[1].standings.map((row) => row.name), ["Delta", "Gamma"]);
  // Grouped series are not duplicated under `groups`.
  assert.deepEqual(groupsStage.groups, []);
  assert.equal(groupsStage.roundRobin.groups[0].seriesGroups[0].games[0].round, "Week 1");
  assert.equal(groupsStage.roundRobin.groups[1].seriesGroups[0].games[0].round, null);
  assert.equal(playoffs.roundRobin, null);
  assert.equal(playoffs.groups.length, 1);
});
