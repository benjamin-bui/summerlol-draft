const { round3 } = require("./trueskill-matches");

const LOL_RANK_CUTOFFS = [
  { name: "Master", ratingCutoff: 1200 },
  { name: "Diamond", ratingCutoff: 1065 },
  { name: "Emerald", ratingCutoff: 925 },
  { name: "Platinum", ratingCutoff: 800 },
  { name: "Gold", ratingCutoff: 675 },
  { name: "Silver", ratingCutoff: 540 },
  { name: "Bronze", ratingCutoff: 440 },
  { name: "Iron", ratingCutoff: -Infinity },
];

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

module.exports = { computeFunFacts };
