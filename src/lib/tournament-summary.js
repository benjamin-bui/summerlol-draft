// Builds everything the Tournaments tab shows, one entry per tournament
// (year + season) that has at least one recorded game:
//   - team rosters (pick order + entering rank per player, team placement)
//   - per-champion games / win rate / KDA
//   - summary facts (most picked, best/worst win rate, champion diversity,
//     biggest upset)
//   - the tournament's full match list, in play order
//
// Pure functions only -- no DB, no Express -- so it can be unit tested with
// plain objects. server.js does the fetching and passes the results in.

const {
  championKey,
  championKeysAvailableIn,
  releaseYearOf,
} = require("./champion-releases");
const { buildReverseIdentityLookup } = require("./player-identity");

// A champion needs at least this many games in a tournament to be eligible
// for the "winningest" / "losingest" callouts -- a 1-0 record isn't a trend.
const MIN_GAMES_FOR_WIN_RATE_CALLOUTS = 3;

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function seasonOrder(tournament) {
  const t = String(tournament || "")
    .trim()
    .toLowerCase();
  if (t === "winter") return 0;
  if (t === "summer") return 1;
  return 2;
}

function tournamentId(year, tournament) {
  const slug = String(tournament || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${year}-${slug}`;
}

// Gini coefficient of non-negative values: 0 = perfectly even, approaching
// 1 = everything concentrated in one entry. Uses the sorted-rank form,
//   G = 2 * sum(i * x_i) / (n * sum(x)) - (n + 1) / n     (i = 1..n, x ascending)
// which is O(n log n) and equivalent to the mean-absolute-difference
// definition. Returns null when there is nothing to measure (no values, or
// all zero) rather than a misleading 0.
function giniCoefficient(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return null;
  const total = xs.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  let weighted = 0;
  xs.forEach((v, i) => {
    weighted += (i + 1) * v;
  });
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

// The two "most X" callouts share one rule for ties: everyone tied on the
// primary metric AND the tiebreak metric is returned together, so the UI
// can say "Leona, Syndra" instead of arbitrarily crowning one of them.
function topTied(items, compare) {
  if (!items.length) return [];
  const sorted = [...items].sort(compare);
  const best = sorted[0];
  return sorted.filter((item) => compare(item, best) === 0);
}

function summarizeChampionStat(c) {
  return {
    champion: c.champion,
    games: c.games,
    wins: c.wins,
    losses: c.losses,
    winRate: c.winRate,
  };
}

// Aggregates every champion pick in a tournament's games. A pick is
// attributed to a side by finding the picking player on team1's or team2's
// roster, which is what makes a win/loss knowable per pick.
function buildChampionStats(tournamentGames, resolve) {
  const byKey = new Map();
  let gamesWithDetails = 0;

  for (const game of tournamentGames) {
    if (!game.details || game.details.length === 0) continue;
    gamesWithDetails += 1;

    const sideOf = new Map();
    for (const m of game.team1.roster) sideOf.set(m.identityKey, "team1");
    for (const m of game.team2.roster) sideOf.set(m.identityKey, "team2");

    for (const detail of game.details) {
      if (!detail.champion) continue;
      const key = championKey(detail.champion);
      if (!key) continue;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          champion: String(detail.champion).trim(),
          games: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
        });
      }
      const c = byKey.get(key);
      c.games += 1;
      c.kills += detail.kills ?? 0;
      c.deaths += detail.deaths ?? 0;
      c.assists += detail.assists ?? 0;

      const side = sideOf.get(resolve(detail.player));
      if (!side || game.winner === "draw") {
        // Unattributable pick or a drawn game: still a pick, but neither a win nor a loss.
        if (game.winner === "draw" && side) c.draws += 1;
      } else if (game.winner === side) {
        c.wins += 1;
      } else {
        c.losses += 1;
      }
    }
  }

  const stats = [...byKey.values()].map((c) => {
    const decided = c.wins + c.losses + c.draws;
    return {
      ...c,
      winRate: decided ? round3(c.wins / decided) : null,
      // Same "perfect KDA" convention as the player profile: null (shown as
      // "Perfect") instead of Infinity when a champion never died.
      kda: c.deaths > 0 ? round3((c.kills + c.assists) / c.deaths) : null,
    };
  });
  stats.sort(
    (a, b) =>
      b.games - a.games ||
      (b.winRate ?? -1) - (a.winRate ?? -1) ||
      a.champion.localeCompare(b.champion),
  );
  return { stats, gamesWithDetails };
}

// Champion diversity for one tournament: the Gini coefficient of pick rates
// across EVERY champion that could have been picked (released in that year
// or earlier) -- champions nobody picked count as a 0, which is the whole
// point: a tournament where 8 champions get all the picks is far less
// diverse than one spread over 60, even if the "picked" lists look similar.
//
// Returns both the raw Gini (lower = more diverse) and `diversity` =
// 1 - Gini (higher = more diverse), which is what the UI displays.
// Champions that appear in the data but aren't in the
// release table (a brand-new champion, or a typo in the CSV) are added to
// the pool rather than dropped, so every recorded pick is accounted for.
function computeChampionDiversity(stats, gamesWithDetails, year) {
  if (!gamesWithDetails || stats.length === 0) return null;
  const pool = new Set(championKeysAvailableIn(year));
  for (const c of stats) pool.add(c.key);
  const gamesByKey = new Map(stats.map((c) => [c.key, c.games]));
  // pick rate = games the champion was picked in / games with champion data
  const pickRates = [...pool].map(
    (key) => (gamesByKey.get(key) || 0) / gamesWithDetails,
  );
  const gini = giniCoefficient(pickRates);
  if (gini === null) return null;
  return {
    gini: round3(gini),
    // What the UI shows: 1 - Gini, so higher = more diverse (0 = every pick
    // on one champion, 1 = every available champion picked equally).
    // Computed from the unrounded Gini so it never drifts by a rounding step.
    diversity: round3(1 - gini),
    poolSize: pool.size,
    championsPicked: stats.length,
    gamesWithData: gamesWithDetails,
  };
}

function findBiggestUpset(tournamentGames, matchOrderByKey) {
  let best = null;
  let bestProb = Infinity;
  for (const g of tournamentGames) {
    if (g.winner === "draw") continue;
    const winnerSide = g.winner === "team1" ? g.team1 : g.team2;
    const loserSide = g.winner === "team1" ? g.team2 : g.team1;
    const prob =
      g.winner === "team1"
        ? g.predictedWinProbTeam1
        : round3(1 - g.predictedWinProbTeam1);
    // Strict "<" keeps the earliest game on an exact tie.
    if (prob < bestProb) {
      bestProb = prob;
      best = {
        matchKey: g.matchKey,
        matchOrder: matchOrderByKey.get(g.matchKey) ?? null,
        matchStage: g.matchStage,
        winnerKey: winnerSide.key,
        winnerName: winnerSide.name,
        loserKey: loserSide.key,
        loserName: loserSide.name,
        winnerAvg: winnerSide.avg,
        loserAvg: loserSide.avg,
        predictedWinProbForWinner: prob,
      };
    }
  }
  return best;
}

// Entering rank for everyone in a tournament's draft pool (picks +
// captains), by TrueSkill entering that tournament -- the SAME definition
// /api/player/:key uses for a profile's "Entering rank", so the number
// shown here matches the one on that player's page. A tournament where
// nobody has a rating that differs from the starting default (the league's
// very first one) has no signal to rank by and gets no entering ranks.
function computeEntryRanks(
  draftRows,
  tournamentEntryRatings,
  defaultConservativeRating,
) {
  const entryLookup = new Map();
  for (const r of tournamentEntryRatings) {
    entryLookup.set(`${r.identityKey}::${r.year}::${r.tournament}`, r);
  }

  const poolByTournament = new Map();
  for (const row of draftRows) {
    if (!Number.isFinite(row.year)) continue;
    const tKey = `${row.year}::${row.tournament}`;
    if (!poolByTournament.has(tKey)) poolByTournament.set(tKey, new Set());
    poolByTournament.get(tKey).add(row.identityKey);
    poolByTournament.get(tKey).add(row.captainIdentityKey);
  }

  const result = new Map(); // tKey -> { poolSize, byKey: Map(identityKey -> {rank, rating}) }
  for (const [tKey, pool] of poolByTournament.entries()) {
    const [yearStr, tournament] = tKey.split("::");
    const entries = [...pool]
      .map((identityKey) => {
        const e = entryLookup.get(`${identityKey}::${yearStr}::${tournament}`);
        return e
          ? { identityKey, conservativeRating: e.conservativeRating }
          : null;
      })
      .filter(Boolean);
    if (!entries.length) continue;
    const hasSignal = entries.some(
      (e) => e.conservativeRating !== defaultConservativeRating,
    );
    if (!hasSignal) continue;
    const byKey = new Map();
    [...entries]
      .sort((a, b) => b.conservativeRating - a.conservativeRating)
      .forEach((e, i) =>
        byKey.set(e.identityKey, {
          rank: i + 1,
          rating: e.conservativeRating,
        }),
      );
    result.set(tKey, { poolSize: pool.size, byKey });
  }
  return result;
}

function buildTeams({
  tournamentGames,
  tournamentRows,
  entryInfo,
  displayNameOf,
}) {
  // Every team is identified by its captain's identityKey (a team is named
  // after its captain). Membership comes from the rosters the rating engine
  // actually played the games with; the draft rows supply pick order and
  // placement. A team present in the draft but with no games yet falls
  // back to its draft-row roster.
  const teams = new Map();
  const ensureTeam = (captainKey, captainName) => {
    if (!teams.has(captainKey)) {
      teams.set(captainKey, {
        captainKey,
        captainName,
        memberKeys: new Map(), // identityKey -> displayName
        wins: 0,
        losses: 0,
        draws: 0,
      });
    }
    return teams.get(captainKey);
  };

  for (const g of tournamentGames) {
    for (const [side, outcomeIfWon] of [
      [g.team1, "team1"],
      [g.team2, "team2"],
    ]) {
      const team = ensureTeam(side.key, side.name);
      for (const m of side.roster) team.memberKeys.set(m.identityKey, m.displayName);
      if (g.winner === "draw") team.draws += 1;
      else if (g.winner === outcomeIfWon) team.wins += 1;
      else team.losses += 1;
    }
  }

  const pickOrderByTeamAndPlayer = new Map();
  const placementByTeam = new Map();
  for (const row of tournamentRows) {
    const team = ensureTeam(
      row.captainIdentityKey,
      displayNameOf(row.captainIdentityKey, row.captain),
    );
    pickOrderByTeamAndPlayer.set(
      `${row.captainIdentityKey}::${row.identityKey}`,
      row.pickOrder,
    );
    if (Number.isFinite(row.rank) && !placementByTeam.has(row.captainIdentityKey)) {
      placementByTeam.set(row.captainIdentityKey, row.rank);
    }
  }

  // Teams that never appeared in a game get their roster from the draft.
  const teamsWithGames = new Set();
  for (const g of tournamentGames) {
    teamsWithGames.add(g.team1.key);
    teamsWithGames.add(g.team2.key);
  }
  for (const row of tournamentRows) {
    if (teamsWithGames.has(row.captainIdentityKey)) continue;
    const team = teams.get(row.captainIdentityKey);
    team.memberKeys.set(row.identityKey, row.displayName);
    team.memberKeys.set(
      row.captainIdentityKey,
      displayNameOf(row.captainIdentityKey, row.captain),
    );
  }

  const out = [...teams.values()].map((team) => {
    const roster = [...team.memberKeys.entries()].map(([key, displayName]) => {
      const isCaptain = key === team.captainKey;
      const pickOrder = isCaptain
        ? null
        : (pickOrderByTeamAndPlayer.get(`${team.captainKey}::${key}`) ?? null);
      const entry = entryInfo?.byKey.get(key) ?? null;
      return {
        identityKey: key,
        displayName,
        isCaptain,
        pickOrder,
        entryRank: entry ? entry.rank : null,
        entryRating: entry ? entry.rating : null,
      };
    });
    // Captain first, then by pick order; anyone with no recorded pick order last.
    roster.sort((a, b) => {
      if (a.isCaptain !== b.isCaptain) return a.isCaptain ? -1 : 1;
      return (a.pickOrder ?? Infinity) - (b.pickOrder ?? Infinity);
    });
    const gamesPlayed = team.wins + team.losses + team.draws;
    return {
      captainKey: team.captainKey,
      captainName: displayNameOf(team.captainKey, team.captainName),
      placement: placementByTeam.get(team.captainKey) ?? null,
      wins: team.wins,
      losses: team.losses,
      draws: team.draws,
      games: gamesPlayed,
      winRate: gamesPlayed ? round3(team.wins / gamesPlayed) : null,
      roster,
    };
  });

  out.sort(
    (a, b) =>
      (a.placement ?? Infinity) - (b.placement ?? Infinity) ||
      b.wins - a.wins ||
      a.captainName.localeCompare(b.captainName),
  );
  return out;
}

function buildMatches(tournamentGames, matchOrderByKey, resolve) {
  return tournamentGames.map((g) => {
    const detailByKey = new Map();
    for (const d of g.details || []) detailByKey.set(resolve(d.player), d);

    const sideRoster = (side) =>
      side.roster.map((m) => {
        const d = detailByKey.get(m.identityKey);
        return {
          identityKey: m.identityKey,
          displayName: m.displayName,
          conservativeRating: m.conservativeRating,
          mu: m.mu,
          champion: d?.champion ?? null,
          championKey: d?.champion ? championKey(d.champion) : null,
          kills: d?.kills ?? null,
          deaths: d?.deaths ?? null,
          assists: d?.assists ?? null,
        };
      });

    return {
      matchKey: g.matchKey,
      order: matchOrderByKey.get(g.matchKey) ?? null,
      stage: g.matchStage,
      winner: g.winner,
      predictedWinProbTeam1: g.predictedWinProbTeam1,
      hasDetails: (g.details || []).length > 0,
      team1: {
        key: g.team1.key,
        name: g.team1.name,
        avg: g.team1.avg,
        avgMu: g.team1.avgMu,
        roster: sideRoster(g.team1),
      },
      team2: {
        key: g.team2.key,
        name: g.team2.name,
        avg: g.team2.avg,
        avgMu: g.team2.avgMu,
        roster: sideRoster(g.team2),
      },
    };
  });
}

// games:  result.games from computeTrueSkillFromMatches (chronological)
// matches: raw rows from getMatches() -- only used to recover each game's
//          authoritative Match Order, which the rating engine's game
//          objects don't carry
// draftRows: identity-resolved draft rows, each with captainIdentityKey
function buildTournamentSummaries({
  games,
  matches,
  draftRows,
  identityMap,
  tournamentEntryRatings,
  defaultConservativeRating,
}) {
  const resolve = (name) => {
    const identity = identityMap.get(name);
    return identity ? identity.identityKey : name;
  };
  const reverseIdentity = buildReverseIdentityLookup(identityMap);
  const nameOf = (key, fallback) =>
    reverseIdentity.get(key)?.displayName || fallback || key;

  const matchOrderByKey = new Map();
  for (const m of matches || []) matchOrderByKey.set(m.matchKey, m.matchOrder);

  const gamesByTournament = new Map();
  for (const g of games) {
    const tKey = `${g.year}::${g.tournament}`;
    if (!gamesByTournament.has(tKey)) gamesByTournament.set(tKey, []);
    gamesByTournament.get(tKey).push(g);
  }
  const rowsByTournament = new Map();
  for (const row of draftRows) {
    if (!Number.isFinite(row.year)) continue;
    const tKey = `${row.year}::${row.tournament}`;
    if (!rowsByTournament.has(tKey)) rowsByTournament.set(tKey, []);
    rowsByTournament.get(tKey).push(row);
  }
  const entryRanks = computeEntryRanks(
    draftRows,
    tournamentEntryRatings,
    defaultConservativeRating,
  );

  const summaries = [];
  for (const [tKey, tournamentGames] of gamesByTournament.entries()) {
    const [yearStr, tournament] = tKey.split("::");
    const year = parseInt(yearStr, 10);
    const tournamentRows = rowsByTournament.get(tKey) || [];
    const entryInfo = entryRanks.get(tKey) || null;

    const { stats, gamesWithDetails } = buildChampionStats(
      tournamentGames,
      resolve,
    );
    const qualifying = stats.filter(
      (c) => c.games >= MIN_GAMES_FOR_WIN_RATE_CALLOUTS && c.winRate !== null,
    );
    const mostPickedTied = topTied(stats, (a, b) => b.games - a.games);
    const winningestTied = topTied(
      qualifying,
      (a, b) => b.winRate - a.winRate || b.games - a.games,
    );
    const losingestTied = topTied(
      qualifying,
      (a, b) => a.winRate - b.winRate || b.games - a.games,
    );

    // Names that aren't in the release table -- surfaced so a typo in the
    // match-details CSV is visible instead of silently becoming its own champion.
    const unrecognizedChampions = stats
      .filter((c) => releaseYearOf(c.key) === null)
      .map((c) => c.champion);

    summaries.push({
      id: tournamentId(year, tournament),
      year,
      tournament,
      label: `${tournament} ${year}`,
      gamesPlayed: tournamentGames.length,
      teamCount: new Set(
        tournamentGames.flatMap((g) => [g.team1.key, g.team2.key]),
      ).size,
      entryRankPoolSize: entryInfo ? entryInfo.poolSize : null,
      teams: buildTeams({
        tournamentGames,
        tournamentRows,
        entryInfo,
        displayNameOf: nameOf,
      }),
      championStats: stats.map((c) => ({
        key: c.key,
        champion: c.champion,
        games: c.games,
        wins: c.wins,
        losses: c.losses,
        winRate: c.winRate,
        kda: c.kda,
      })),
      championCoverage: {
        gamesWithDetails,
        totalGames: tournamentGames.length,
      },
      unrecognizedChampions,
      summary: {
        minGamesForWinRateCallouts: MIN_GAMES_FOR_WIN_RATE_CALLOUTS,
        mostPicked: mostPickedTied.length
          ? {
              champions: mostPickedTied.map((c) => c.champion),
              games: mostPickedTied[0].games,
              pickRate: round3(mostPickedTied[0].games / gamesWithDetails),
            }
          : null,
        winningest: winningestTied.length
          ? {
              champions: winningestTied.map((c) => c.champion),
              ...summarizeChampionStat(winningestTied[0]),
            }
          : null,
        losingest: losingestTied.length
          ? {
              champions: losingestTied.map((c) => c.champion),
              ...summarizeChampionStat(losingestTied[0]),
            }
          : null,
        diversity: computeChampionDiversity(stats, gamesWithDetails, year),
        biggestUpset: findBiggestUpset(tournamentGames, matchOrderByKey),
      },
      matches: buildMatches(tournamentGames, matchOrderByKey, resolve),
    });
  }

  // Most recent first; within a year, Summer (later) before Winter.
  summaries.sort(
    (a, b) =>
      b.year - a.year || seasonOrder(b.tournament) - seasonOrder(a.tournament),
  );
  return summaries;
}

module.exports = {
  buildTournamentSummaries,
  buildChampionStats,
  computeChampionDiversity,
  computeEntryRanks,
  giniCoefficient,
  findBiggestUpset,
  tournamentId,
  MIN_GAMES_FOR_WIN_RATE_CALLOUTS,
};
