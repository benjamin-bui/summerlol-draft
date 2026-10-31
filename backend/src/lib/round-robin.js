// Standings and head-to-head results for the editor-defined groups of a
// round-robin stage (see tournament_stage_groups in tournament-structure.js).
//
// Pure functions only, like tournament-summary.js. The input is the stage's
// existing "series groups" -- one entry per series (or standalone game), each
// with its games -- plus the group definitions the editor saved.
//
// Scoring, matching the Liquipedia group-table convention:
//   - A "match" is a series (or a standalone game). Whoever wins more of its
//     games wins the match; equal game wins is a drawn match (e.g. a Bo2 that
//     splits 1-1).
//   - Standings sort by match wins, then fewer match losses, then game
//     difference, then games won, then name. Head-to-head is not applied; the
//     rank column is simply the sorted position.

function seriesOutcome(group) {
  const games = [...group.games].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const first = games[0];
  if (!first) return null;
  const sides = [first.team1, first.team2];
  const keyOf = (team) => team.key || team.name;
  const gameWins = [0, 0];
  let drawnGames = 0;
  for (const game of games) {
    if (game.winner === "draw") {
      drawnGames += 1;
      continue;
    }
    const winner = game.winner === "team1" ? game.team1 : game.winner === "team2" ? game.team2 : null;
    if (!winner) continue;
    const side = sides.findIndex((team) => keyOf(team) === keyOf(winner));
    if (side >= 0) gameWins[side] += 1;
  }
  return {
    sides: sides.map((team) => ({ key: keyOf(team), name: team.name })),
    gameWins,
    drawnGames,
    // 0 / 1 = that side won the match, null = drawn match.
    winner: gameWins[0] === gameWins[1] ? null : gameWins[0] > gameWins[1] ? 0 : 1,
  };
}

function emptyRecord(team) {
  return {
    key: team.key,
    name: team.name,
    matchWins: 0,
    matchDraws: 0,
    matchLosses: 0,
    gameWins: 0,
    gameLosses: 0,
    gameDraws: 0,
    gameDiff: 0,
    vs: {},
  };
}

// definedGroups: [{ groupId, name, order, teams: [rawTeamName] }]
// seriesGroups:  stage.groups from tournament-summary (series/game groupings)
// resolve:       raw team name -> the key games carry (identityKey or the name)
// nameOf:        (key, fallback) -> display name
//
// Returns { groups, ungrouped }:
//   groups   -- one per defined group, in group order, each with ranked
//               `standings` (every allocated team, played or not) and the
//               series groups that belong to it in `seriesGroups`.
//   ungrouped -- series groups whose two teams are not both in one group.
function buildRoundRobinGroups({ definedGroups, seriesGroups, resolve, nameOf }) {
  const groups = [...definedGroups]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((definition) => {
      const records = new Map();
      for (const raw of definition.teams) {
        const key = resolve(raw);
        records.set(key, emptyRecord({ key, name: nameOf(key, raw) }));
      }
      return { definition, records, seriesGroups: [] };
    });
  const groupOfTeam = new Map();
  for (const group of groups) {
    for (const key of group.records.keys()) groupOfTeam.set(key, group);
  }

  const ungrouped = [];
  for (const seriesGroup of seriesGroups) {
    const outcome = seriesOutcome(seriesGroup);
    if (!outcome) continue;
    const [a, b] = outcome.sides;
    const group = groupOfTeam.get(a.key);
    if (!group || group !== groupOfTeam.get(b.key)) {
      ungrouped.push(seriesGroup);
      continue;
    }
    group.seriesGroups.push(seriesGroup);
    outcome.sides.forEach((side, index) => {
      const own = group.records.get(side.key);
      const opponent = outcome.sides[1 - index];
      const gamesFor = outcome.gameWins[index];
      const gamesAgainst = outcome.gameWins[1 - index];
      own.gameWins += gamesFor;
      own.gameLosses += gamesAgainst;
      own.gameDraws += outcome.drawnGames;
      own.gameDiff += gamesFor - gamesAgainst;
      if (outcome.winner === null) own.matchDraws += 1;
      else if (outcome.winner === index) own.matchWins += 1;
      else own.matchLosses += 1;
      const cell = own.vs[opponent.key] || { gamesFor: 0, gamesAgainst: 0, matches: 0 };
      cell.gamesFor += gamesFor;
      cell.gamesAgainst += gamesAgainst;
      cell.matches += 1;
      own.vs[opponent.key] = cell;
    });
  }

  return {
    groups: groups.map(({ definition, records, seriesGroups: grouped }) => {
      const standings = [...records.values()]
        .sort(
          (x, y) =>
            y.matchWins - x.matchWins ||
            x.matchLosses - y.matchLosses ||
            y.gameDiff - x.gameDiff ||
            y.gameWins - x.gameWins ||
            x.name.localeCompare(y.name),
        )
        .map((record, index) => {
          const vs = {};
          for (const [opponentKey, cell] of Object.entries(record.vs)) {
            vs[opponentKey] = {
              ...cell,
              outcome:
                cell.gamesFor > cell.gamesAgainst ? "win" : cell.gamesFor < cell.gamesAgainst ? "loss" : "draw",
            };
          }
          return { ...record, rank: index + 1, vs };
        });
      return {
        groupId: definition.groupId,
        name: definition.name,
        order: definition.order,
        standings,
        hasDraws: standings.some((row) => row.matchDraws > 0),
        seriesGroups: grouped.sort((x, y) => (x.games[0]?.order ?? 0) - (y.games[0]?.order ?? 0)),
      };
    }),
    ungrouped,
  };
}

module.exports = { buildRoundRobinGroups, seriesOutcome };
