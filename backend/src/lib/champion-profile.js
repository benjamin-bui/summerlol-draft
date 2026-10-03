// Builds the data behind a champion's profile page: every game in which the
// champion was picked, in chronological order, as one history entry per
// (game, picking player).
//
// An entry has exactly the shape of an entry in a player's own `history` (see
// computeTrueSkillFromMatches), seen from the picking player's side -- so the
// client can reuse the player-profile history table unchanged -- plus:
//   player             who picked the champion: { identityKey, displayName }
//   teamChampions      the other champions the picker's team played that game
//   opponentChampions  the champions the opposing team played that game
//   laneOpponent       the opposing player in the same role, as
//                      { champion, key, role, kills, deaths, assists }, or null
//                      when the role is unknown or no opponent has that role
// Each champion in those two lists is { champion, key, role }. They feed the
// "win rate with / against other champions" summary, and are computed here
// (rather than in the browser) because mapping a match-details row to a team
// needs the same alias -> identityKey resolution the rest of the server uses.
//
// Pure: no DB, no Express. `games` and `players` are the `games` and `players`
// of a computeTrueSkillFromMatches() result.

const { championKey } = require("./champion-releases");

function summarizeChampion(detail) {
  return {
    champion: detail.champion,
    key: detail.championKey || championKey(detail.champion),
    role: detail.role || null,
  };
}

function buildChampionProfile({ key, games, players, resolve }) {
  // `${identityKey}::${matchKey}` -> that player's history entry for the game.
  // matchKey is unique per game; gameIndex is the fallback for any history
  // entry that predates it.
  const entryId = (identityKey, entry) =>
    `${identityKey}::${entry.matchKey ?? `row${entry.gameIndex}`}`;
  const entries = new Map();
  for (const player of players) {
    for (const entry of player.history) {
      entries.set(entryId(player.identityKey, entry), entry);
    }
  }

  let champion = null;
  let gamesBanned = 0;
  const history = [];
  const seen = new Set();

  // `games` is already in play order, so the history comes out chronological.
  for (const game of games) {
    const sideOf = new Map(); // identityKey -> 1 | 2
    for (const member of game.team1.roster) sideOf.set(member.identityKey, 1);
    for (const member of game.team2.roster) sideOf.set(member.identityKey, 2);

    const bannedHere = [
      ...(game.bans?.team1 || []),
      ...(game.bans?.team2 || []),
    ].find((ban) => (ban.key || championKey(ban.champion)) === key);
    if (bannedHere) {
      gamesBanned += 1;
      champion = champion || String(bannedHere.champion).trim();
    }

    const details = (game.details || []).filter((d) => d.champion);
    for (const detail of details) {
      if ((detail.championKey || championKey(detail.champion)) !== key) continue;
      champion = String(detail.champion).trim();

      const identityKey = resolve(detail.player);
      const side = sideOf.get(identityKey);
      const id = entryId(identityKey, { matchKey: game.matchKey, gameIndex: game.csvRowIndex });
      const base = entries.get(id);
      if (!base || !side || seen.has(id)) continue;
      seen.add(id);

      const teamChampions = [];
      const opponentChampions = [];
      for (const other of details) {
        if (other === detail) continue;
        const otherSide = sideOf.get(resolve(other.player));
        if (otherSide === side) teamChampions.push(summarizeChampion(other));
        else if (otherSide) opponentChampions.push(summarizeChampion(other));
      }

      // Roles are only comparable when recorded; if two opponents somehow
      // share a role, the first one listed is used.
      const laneDetail = detail.role
        ? details.find(
            (other) =>
              other.role === detail.role &&
              sideOf.get(resolve(other.player)) === (side === 1 ? 2 : 1),
          )
        : null;
      const laneOpponent = laneDetail
        ? {
            ...summarizeChampion(laneDetail),
            kills: laneDetail.kills ?? null,
            deaths: laneDetail.deaths ?? null,
            assists: laneDetail.assists ?? null,
          }
        : null;

      const own = side === 1 ? game.team1 : game.team2;
      history.push({
        ...base,
        player: {
          identityKey,
          displayName:
            own.roster.find((m) => m.identityKey === identityKey)?.displayName ||
            identityKey,
        },
        teamChampions,
        opponentChampions,
        laneOpponent,
      });
    }
  }

  const wins = history.filter((e) => e.outcome === "win").length;
  const losses = history.filter((e) => e.outcome === "loss").length;
  return {
    key,
    champion,
    games: history.length,
    wins,
    losses,
    draws: history.length - wins - losses,
    gamesBanned,
    history,
  };
}

module.exports = { buildChampionProfile };
