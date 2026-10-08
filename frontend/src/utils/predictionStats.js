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
//
// `skill` is the Brier SKILL score against that coin flip, 1 - brier / 0.25,
// which is what the UI shows because it reads the right way round: 0 = no
// better than always saying 50/50, 1 = perfect, and a negative value means
// worse than a coin flip. It is deliberately NOT clamped at 0 -- hiding a
// model that does worse than guessing would be misleading.
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
