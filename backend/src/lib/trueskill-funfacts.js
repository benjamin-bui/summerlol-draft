const { round3 } = require("./trueskill-matches");

// Rating cutoff for each League rank tier. These are calibrated to the rating
// scale produced by the default TrueSkill beta (mu / 2 = 500; see
// trueskill-matches.js) so each tier covers the same share of players as it did
// before beta moved from 250 to 500: Master ~top 1% (picked so the same three players still count as "ever Master"), Diamond ~top 4.8%,
// Emerald ~top 18%, Platinum ~top 37%, Gold ~top 57%, Silver ~top 79%, Bronze
// ~top 96%. Rounded to multiples of 5. If beta (or the rating engine) changes,
// re-derive these rather than leaving the tiers silently shifted.
const LOL_RANK_CUTOFFS = [
  { name: "Master", ratingCutoff: 1125 },
  { name: "Diamond", ratingCutoff: 995 },
  { name: "Emerald", ratingCutoff: 865 },
  { name: "Platinum", ratingCutoff: 745 },
  { name: "Gold", ratingCutoff: 660 },
  { name: "Silver", ratingCutoff: 550 },
  { name: "Bronze", ratingCutoff: 440 },
  { name: "Iron", ratingCutoff: -Infinity },
];

// ---- Champion diversity across players ----
// Same Gini-Simpson index the player profile page shows next to "Champion
// Diversity" (1 - sum of squared champion pick shares; see
// computeChampionDiversity in frontend/src/utils/profileCompute.js -- keep the
// two in step). Computed here for every player so the Players tab can draw a
// histogram and a profile can say where its owner sits in it.
//
// The index is capped at 1 - 1/n for n games, so a player with 3 recorded
// games can never score above 0.67 however varied they are. Mixing those in
// would make "diversity" mostly a proxy for "games played", so only players
// with at least MIN_DIVERSITY_GAMES games that have a champion on record are
// included in the distribution.
const MIN_DIVERSITY_GAMES = 10;

function computeChampionDiversityDistribution(
  players,
  { minGames = MIN_DIVERSITY_GAMES } = {},
) {
  const entries = [];
  for (const p of players) {
    const counts = new Map();
    let games = 0;
    for (const h of p.history || []) {
      const champion = h.playerDetails?.[0]?.champion;
      if (!champion) continue;
      counts.set(champion, (counts.get(champion) || 0) + 1);
      games += 1;
    }
    if (games < minGames) continue;
    let sumSquares = 0;
    for (const n of counts.values()) sumSquares += (n / games) ** 2;
    entries.push({
      key: p.identityKey,
      games,
      diversity: Math.round((1 - sumSquares) * 10000) / 10000,
    });
  }
  entries.sort((a, b) => a.diversity - b.diversity);
  return { minGames, players: entries };
}

function computeFunFacts(result, { rankCutoffs = LOL_RANK_CUTOFFS } = {}) {
  const { players, games } = result;

  // ---- Percentile cutoffs, labeled by LoL rank equivalent ----
  const sorted = [...players]
    .map((p) => p.conservativeRating)
    .sort((a, b) => a - b);
  const staticCutoffs = rankCutoffs.map(({ name, ratingCutoff }) => {
    if (sorted.length === 0) return { name, ratingCutoff, percentile: 0 };

    // Count how many players fall below this static rating cutoff
    const countBelow = sorted.filter((rating) => rating < ratingCutoff).length;
    const percentile = (countBelow / sorted.length) * 100;

    return { name, ratingCutoff, percentile: round3(percentile) };
  });

  // ---- Biggest upset: lowest predicted win probability among winners of decisive games ----
  const decisive = games.filter((g) => g.winner !== "draw");
  const winnerPredictedProb = (g) =>
    g.winner === "team1"
      ? g.predictedWinProbTeam1
      : round3(1 - g.predictedWinProbTeam1);

  const biggestUpset = decisive.length
    ? decisive.reduce((best, g) =>
        winnerPredictedProb(g) < winnerPredictedProb(best) ? g : best,
      )
    : null;
  const biggestUpsetFact = biggestUpset ? formatUpset(biggestUpset) : null;

  // ---- Longest win streak (per player, chronological history already ordered) ----
  let longestStreak = null;
  for (const p of players) {
    let current = 0,
      best = 0;
    for (const h of p.history) {
      current = h.outcome === "win" ? current + 1 : 0;
      if (current > best) best = current;
    }
    if (!longestStreak || best > longestStreak.streak) {
      longestStreak = { displayName: p.group, streak: best };
    }
  }

  // ---- Most active rivalry: captain pair with the most games played
  // against each other. Keyed by team, not by individual player -- "team1
  // vs team2" from the games array already IS the rivalry unit (a captain's
  // roster changes player-by-player year to year, but the captain matchup
  // is the stable thing worth calling a "rivalry"). Key is built with the
  // two team identityKeys sorted so "A vs B" and "B vs A" collapse into
  // one entry instead of two.
  const rivalries = new Map(); // sortedKey -> { teamAName, teamBName, teamAKey, teamBKey, wins: {[key]: n}, draws: n }
  for (const g of games) {
    if (!g.team1?.key || !g.team2?.key) continue;
    const [first, second] = [g.team1, g.team2].sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    const rivalryKey = `${first.key}::${second.key}`;
    if (!rivalries.has(rivalryKey)) {
      rivalries.set(rivalryKey, {
        teamAKey: first.key,
        teamAName: first.name,
        teamBKey: second.key,
        teamBName: second.name,
        gamesPlayed: 0,
        teamAWins: 0,
        teamBWins: 0,
        draws: 0,
      });
    }
    const r = rivalries.get(rivalryKey);
    r.gamesPlayed += 1;
    if (g.winner === "draw") r.draws += 1;
    else {
      const winnerKey = g.winner === "team1" ? g.team1.key : g.team2.key;
      if (winnerKey === r.teamAKey) r.teamAWins += 1;
      else r.teamBWins += 1;
    }
  }
  const mostActiveRivalry = rivalries.size
    ? [...rivalries.values()].reduce((best, r) =>
        r.gamesPlayed > best.gamesPlayed ? r : best,
      )
    : null;

  // ---- Longest losing streak (mirror of the win-streak loop above) ----
  let longestLossStreak = null;
  for (const p of players) {
    let current = 0,
      best = 0;
    for (const h of p.history) {
      current = h.outcome === "loss" ? current + 1 : 0;
      if (current > best) best = current;
    }
    if (!longestLossStreak || best > longestLossStreak.streak) {
      longestLossStreak = { displayName: p.group, streak: best };
    }
  }

  // ---- Highest TrueSkill ever reached, at any point in history ----
  let peakRating = null;
  for (const p of players) {
    for (const h of p.history) {
      if (!peakRating || h.conservativeRating > peakRating.conservativeRating) {
        peakRating = {
          displayName: p.group,
          conservativeRating: h.conservativeRating,
          year: h.year,
          tournament: h.tournament,
        };
      }
    }
  }

  // ---- Lowest TrueSkill ever reached, at any point in history ----
  let troughRating = null;
  for (const p of players) {
    for (const h of p.history) {
      if (
        !troughRating ||
        h.conservativeRating < troughRating.conservativeRating
      ) {
        troughRating = {
          displayName: p.group,
          conservativeRating: h.conservativeRating,
          year: h.year,
          tournament: h.tournament,
        };
      }
    }
  }

  // ---- Most games played ----
  const mostGames = players.length
    ? players.reduce((best, p) => (p.games > best.games ? p : best))
    : null;

  const cutoffMaster = rankCutoffs.find(
    (c) => c.name === "Master",
  )?.ratingCutoff;
  const everMaster = players.filter((p) =>
    p.history.some((h) => h.conservativeRating >= cutoffMaster),
  );

  return {
    staticCutoffs,
    biggestUpset: biggestUpsetFact,
    longestStreak,
    longestLossStreak,
    peakRating,
    troughRating,
    mostGamesPlayed: mostGames
      ? { displayName: mostGames.group, games: mostGames.games }
      : null,
    mostActiveRivalry,
    everMaster,
    championDiversity: computeChampionDiversityDistribution(players),
  };
}

function formatUpset(g) {
  const winnerSide = g.winner === "team1" ? g.team1 : g.team2;
  const loserSide = g.winner === "team1" ? g.team2 : g.team1;
  const predictedWinProbForWinner =
    g.winner === "team1"
      ? g.predictedWinProbTeam1
      : round3(1 - g.predictedWinProbTeam1);
  const mvp = winnerSide.changes.length
    ? winnerSide.changes.reduce((best, c) =>
        c.ratingChange > best.ratingChange ? c : best,
      )
    : null;
  return {
    year: g.year,
    tournament: g.tournament,
    winnerName: winnerSide.name,
    loserName: loserSide.name,
    winnerAvgBefore: winnerSide.avg,
    loserAvgBefore: loserSide.avg,
    predictedWinProbForWinner,
    mvpName: mvp?.displayName ?? null,
    mvpRatingChange: mvp?.ratingChange ?? null,
  };
}

module.exports = {
  computeFunFacts,
  computeChampionDiversityDistribution,
  MIN_DIVERSITY_GAMES,
};
