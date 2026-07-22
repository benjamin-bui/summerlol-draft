const { round3 } = require('./trueskill-matches');

const LOL_RANK_CUTOFFS = [
  { name: 'Master', percentile: 99.153 },
  { name: 'Diamond', percentile: 95.531 },
  { name: 'Emerald', percentile: 83.895 },
  { name: 'Platinum', percentile: 66.230 },
  { name: 'Gold', percentile: 42.280 },
  { name: 'Silver', percentile: 20.373 },
  { name: 'Bronze', percentile: 3.692 }
];

function computeFunFacts(result, { rankCutoffs = LOL_RANK_CUTOFFS } = {}) {
  const { players, games } = result;

  // ---- Percentile cutoffs, labeled by LoL rank equivalent ----
  const sorted = [...players].map((p) => p.conservativeRating).sort((a, b) => a - b);
  const percentileCutoffs = rankCutoffs.map(({ name, percentile }) => {
    if (sorted.length === 0) return { name, percentile, ratingCutoff: null };
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
    return { name, percentile: round3(percentile), ratingCutoff: sorted[idx] };
  });


// ---- Biggest upset: lowest predicted win probability among winners of decisive games ----
const decisive = games.filter((g) => g.winner !== 'draw');
const winnerPredictedProb = (g) => (g.winner === 'team1' ? g.predictedWinProbTeam1 : round3(1 - g.predictedWinProbTeam1));

const biggestUpset = decisive.length
  ? decisive.reduce((best, g) => (winnerPredictedProb(g) < winnerPredictedProb(best) ? g : best))
  : null;
const biggestUpsetFact = biggestUpset ? formatUpset(biggestUpset) : null;


  // ---- Longest win streak (per player, chronological history already ordered) ----
  let longestStreak = null;
  for (const p of players) {
    let current = 0, best = 0;
    for (const h of p.history) {
      current = h.outcome === 'win' ? current + 1 : 0;
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
    const [first, second] = [g.team1, g.team2].sort((a, b) => a.key.localeCompare(b.key));
    const rivalryKey = `${first.key}::${second.key}`;
    if (!rivalries.has(rivalryKey)) {
      rivalries.set(rivalryKey, {
        teamAKey: first.key, teamAName: first.name,
        teamBKey: second.key, teamBName: second.name,
        gamesPlayed: 0, teamAWins: 0, teamBWins: 0, draws: 0
      });
    }
    const r = rivalries.get(rivalryKey);
    r.gamesPlayed += 1;
    if (g.winner === 'draw') r.draws += 1;
    else {
      const winnerKey = g.winner === 'team1' ? g.team1.key : g.team2.key;
      if (winnerKey === r.teamAKey) r.teamAWins += 1;
      else r.teamBWins += 1;
    }
  }
  const mostActiveRivalry = rivalries.size
    ? [...rivalries.values()].reduce((best, r) => (r.gamesPlayed > best.gamesPlayed ? r : best))
    : null;

  // ---- Longest losing streak (mirror of the win-streak loop above) ----
  let longestLossStreak = null;
  for (const p of players) {
    let current = 0, best = 0;
    for (const h of p.history) {
      current = h.outcome === 'loss' ? current + 1 : 0;
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
        peakRating = { displayName: p.group, conservativeRating: h.conservativeRating, year: h.year, tournament: h.tournament };
      }
    }
  }

  // ---- Most games played ----
  const mostGames = players.length
    ? players.reduce((best, p) => (p.games > best.games ? p : best))
    : null;

  return {
    percentileCutoffs,
    biggestUpset: biggestUpsetFact,
    longestStreak,
    longestLossStreak,
    peakRating,
    mostGamesPlayed: mostGames ? { displayName: mostGames.group, games: mostGames.games } : null,
    mostActiveRivalry
  };
}

function formatUpset(g) {
  const winnerSide = g.winner === 'team1' ? g.team1 : g.team2;
  const loserSide = g.winner === 'team1' ? g.team2 : g.team1;
  const predictedWinProbForWinner = g.winner === 'team1' ? g.predictedWinProbTeam1 : round3(1 - g.predictedWinProbTeam1);
  const mvp = winnerSide.changes.length
    ? winnerSide.changes.reduce((best, c) => (c.ratingChange > best.ratingChange ? c : best))
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
    mvpRatingChange: mvp?.ratingChange ?? null
  };
}

module.exports = { computeFunFacts };
