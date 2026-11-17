import { ROLES, ROLE_LABELS } from "./format";
import { seasonRankLocal } from "./profileCompute";

export const UNRECORDED_ROLE = "__unrecorded__";

export function tournamentFilterKey(entry) {
  return `${entry.year}::${entry.tournament}`;
}

export function getPlayerGameFilterOptions(players) {
  const tournaments = new Map();
  const roles = new Set();
  let hasUnrecordedRole = false;

  for (const player of players) {
    for (const game of player.history || []) {
      tournaments.set(tournamentFilterKey(game), {
        year: game.year,
        tournament: game.tournament,
      });
      const role = game.playerDetails?.[0]?.role;
      if (ROLES.includes(role)) roles.add(role);
      else hasUnrecordedRole = true;
    }
  }

  return {
    tournaments: [...tournaments.values()].sort(
      (a, b) => b.year - a.year || seasonRankLocal(b.tournament) - seasonRankLocal(a.tournament),
    ),
    roles: [...roles].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b)),
    hasUnrecordedRole,
  };
}

export function filterPlayerHistory(history, tournamentKey, role) {
  return (history || []).filter((game) => {
    if (tournamentKey && tournamentFilterKey(game) !== tournamentKey) return false;
    if (role) {
      const gameRole = game.playerDetails?.[0]?.role;
      if (role === UNRECORDED_ROLE ? ROLES.includes(gameRole) : gameRole !== role) return false;
    }
    return true;
  });
}

export function summarizePlayerGames(history, minimumDiversityGames = 10) {
  const tournaments = new Set();
  const championGames = new Map();
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let championGamesPlayed = 0;

  for (const game of history) {
    tournaments.add(tournamentFilterKey(game));
    if (game.outcome === "win") wins++;
    else if (game.outcome === "loss") losses++;
    else if (game.outcome === "draw") draws++;

    const champion = game.playerDetails?.[0]?.champion;
    if (champion) {
      championGamesPlayed++;
      championGames.set(champion, (championGames.get(champion) || 0) + 1);
    }
  }

  const diversity = championGamesPlayed >= minimumDiversityGames
    ? 1 - [...championGames.values()].reduce((sum, count) => sum + (count / championGamesPlayed) ** 2, 0)
    : null;

  return {
    games: history.length,
    tournaments: tournaments.size,
    wins,
    losses,
    draws,
    latestGameTournament: history.length
      ? `${history[history.length - 1].tournament || ""} ${history[history.length - 1].year || ""}`.trim()
      : null,
    championDiversity: diversity,
    championDiversityGames: diversity == null ? null : championGamesPlayed,
  };
}

export function roleFilterLabel(role) {
  return role === UNRECORDED_ROLE ? "Not recorded" : ROLE_LABELS[role] || role;
}
