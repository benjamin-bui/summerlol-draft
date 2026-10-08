// How well pre-game win probabilities matched actual results.
// Input is a tournament's `matches` array (see buildMatches in
// backend/src/lib/tournament-summary.js): each has `winner` ("team1" |
// "team2" | "draw") and `predictedWinProbTeam1`.
//
// Draws are left out throughout -- a probability of winning says nothing
// about a game nobody won.

function decisiveGames(matches) {
  return (matches || [])
    .filter(
      (m) =>
        (m.winner === "team1" || m.winner === "team2") &&
        Number.isFinite(m.predictedWinProbTeam1),
    )
    .map((m) => ({ p: m.predictedWinProbTeam1, team1Won: m.winner === "team1" }));
}

// Brier score = mean squared error of the probability against the 0/1
// outcome. 0 is perfect, 0.25 is what always predicting 50/50 scores, and
// anything above 0.25 is worse than a coin flip. It rewards being right
// AND being appropriately confident, which plain accuracy ignores.
// `skill` re-expresses it relative to that coin flip: 1 - brier / 0.25
// (0% = no better than 50/50, 100% = perfect, negative = worse).
//
// `accuracy` is the share of games the pre-game favorite won; games
// predicted at exactly 50% have no favorite and are skipped there.
export function predictionStats(matches) {
  const games = decisiveGames(matches);
  const n = games.length;
  if (n === 0) return { games: 0, brier: null, skill: null, favoriteGames: 0, favoriteWins: 0, accuracy: null };
  const brier = games.reduce((s, g) => s + (g.p - (g.team1Won ? 1 : 0)) ** 2, 0) / n;
  const withFavorite = games.filter((g) => g.p !== 0.5);
  const favoriteWins = withFavorite.filter((g) => (g.p > 0.5) === g.team1Won).length;
  return {
    games: n,
    brier,
    skill: 1 - brier / 0.25,
    favoriteGames: withFavorite.length,
    favoriteWins,
    accuracy: withFavorite.length ? favoriteWins / withFavorite.length : null,
  };
}

// Wilson score interval for a binomial proportion -- behaves sensibly for the
// small counts (a handful of games per bin) a single tournament produces,
// unlike the normal approximation, which spills outside [0, 1].
export function wilsonInterval(successes, n, z = 1.96) {
  if (n === 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

// Reliability (calibration) curve, seen from each game's favorite: games are
// grouped by how confident the pre-game prediction was (50-60%, 60-70%, ...)
// and each group reports the favorite's ACTUAL win rate next to the average
// prediction. A well-calibrated model sits on the diagonal -- teams given a
// 70% chance win about 70% of the time.
// Looking only from the favorite's side (rather than plotting both teams)
// means every game is counted once, so the n per bin is honest.
export function calibrationBins(matches, { binWidth = 0.1 } = {}) {
  const games = decisiveGames(matches).filter((g) => g.p !== 0.5);
  const bins = [];
  const count = Math.round(0.5 / binWidth);
  for (let i = 0; i < count; i++) {
    bins.push({ lo: 0.5 + i * binWidth, hi: 0.5 + (i + 1) * binWidth, n: 0, wins: 0, sumP: 0 });
  }
  for (const g of games) {
    const favP = Math.max(g.p, 1 - g.p);
    const favWon = (g.p > 0.5) === g.team1Won;
    const i = Math.min(count - 1, Math.floor((favP - 0.5) / binWidth + 1e-9));
    bins[i].n += 1;
    bins[i].sumP += favP;
    if (favWon) bins[i].wins += 1;
  }
  return bins
    .filter((b) => b.n > 0)
    .map((b) => ({
      lo: b.lo,
      hi: b.hi,
      n: b.n,
      wins: b.wins,
      predicted: b.sumP / b.n,
      observed: b.wins / b.n,
      interval: wilsonInterval(b.wins, b.n),
    }));
}
