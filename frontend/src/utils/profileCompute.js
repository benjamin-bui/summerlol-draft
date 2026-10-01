import { round3 } from "./format";

export function seasonRankLocal(tournament) {
  const t = String(tournament || "").trim().toLowerCase();
  if (t === "winter") return 0;
  if (t === "summer") return 1;
  return 2;
}

export function tournamentKey(t) {
  return `${t.year}::${t.tournament}`;
}

export function pickPercentile(t) {
  if (t.pickOrder === "Captain" || t.pickOrder == null || !t.totalPicks) return null;
  return (1 - (t.pickOrder - 1) / t.totalPicks) * 100;
}

export function placementPercentile(t) {
  if (t.finalPlacement == null || !t.totalTeams) return null;
  return (1 - (t.finalPlacement - 1) / t.totalTeams) * 100;
}

export function average(values) {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Gini-Simpson diversity index over champion pick shares.
export function computeChampionDiversity(championStats) {
  const played = championStats.filter((c) => c.games > 0);
  const total = played.reduce((s, c) => s + c.games, 0);
  if (!total) return null;
  const sumSquares = played.reduce((s, c) => s + (c.games / total) ** 2, 0);
  return 1 - sumSquares;
}

export function computeCoPlayRecords(history, selfKey) {
  const withMap = new Map();
  const againstMap = new Map();
  for (const entry of history) {
    const isWin = entry.outcome === "win";
    for (const m of entry.ownTeam?.roster || []) {
      if (!m.identityKey || m.identityKey === selfKey) continue;
      if (!withMap.has(m.identityKey)) {
        withMap.set(m.identityKey, { identityKey: m.identityKey, name: m.displayName, games: 0, wins: 0, captainGames: 0 });
      }
      const rec = withMap.get(m.identityKey);
      rec.games += 1;
      if (isWin) rec.wins += 1;
      if (m.displayName === entry.ownTeam?.name) rec.captainGames += 1;
    }
    for (const m of entry.opponentTeam?.roster || []) {
      if (!m.identityKey) continue;
      if (!againstMap.has(m.identityKey)) {
        againstMap.set(m.identityKey, { identityKey: m.identityKey, name: m.displayName, games: 0, wins: 0, captainGames: 0 });
      }
      const rec = againstMap.get(m.identityKey);
      rec.games += 1;
      if (isWin) rec.wins += 1;
      if (m.displayName === entry.opponentTeam?.name) rec.captainGames += 1;
    }
  }
  return { withMap, againstMap };
}

export function pickExtreme(map, mode) {
  const entries = [...map.values()].map((r) => ({ ...r, winRate: r.games ? r.wins / r.games : 0, isCaptain: r.captainGames > 0 }));
  if (!entries.length) return null;
  entries.sort((a, b) => {
    const winDiff = mode === "max" ? b.winRate - a.winRate : a.winRate - b.winRate;
    if (winDiff !== 0) return winDiff;
    if (b.games !== a.games) return b.games - a.games;
    if (b.isCaptain !== a.isCaptain) return (b.isCaptain ? 1 : 0) - (a.isCaptain ? 1 : 0);
    return Math.random() - 0.5;
  });
  return entries[0];
}

export function historyHasBans(history) {
  return history.some((e) => (e.bans?.own?.length || 0) + (e.bans?.opponent?.length || 0) > 0);
}

// Same aggregation the server computes once, career-wide -- reimplemented
// client-side so Champions can be recomputed for whatever filtered subset of
// games (tournament filter and/or played-with/against search) is active.
export function computeChampionStats(historyEntries) {
  const hasBanData = historyHasBans(historyEntries);
  const bannedAgainstByKey = new Map();
  const bannedNameByKey = new Map();
  for (const entry of historyEntries) {
    const seenThisGame = new Set();
    for (const ban of entry.bans?.opponent || []) {
      if (!ban.key || seenThisGame.has(ban.key)) continue;
      seenThisGame.add(ban.key);
      bannedAgainstByKey.set(ban.key, (bannedAgainstByKey.get(ban.key) || 0) + 1);
      if (!bannedNameByKey.has(ban.key)) bannedNameByKey.set(ban.key, ban.champion);
    }
  }

  const championMap = new Map();
  for (const entry of historyEntries) {
    const detail = entry.playerDetails?.[0];
    if (!detail || !detail.champion) continue;
    if (!championMap.has(detail.champion)) {
      championMap.set(detail.champion, { champion: detail.champion, key: detail.championKey || null, games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0 });
    }
    const c = championMap.get(detail.champion);
    c.games += 1;
    if (entry.outcome === "win") c.wins += 1;
    else if (entry.outcome === "loss") c.losses += 1;
    c.kills += detail.kills ?? 0;
    c.deaths += detail.deaths ?? 0;
    c.assists += detail.assists ?? 0;
  }
  const playedKeys = new Set([...championMap.values()].map((c) => c.key));
  for (const [key, name] of bannedNameByKey) {
    if (playedKeys.has(key)) continue;
    championMap.set(`ban-only::${key}`, { champion: name, key, games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0 });
  }
  return [...championMap.values()]
    .map((c) => ({
      ...c,
      winRate: c.games ? round3(c.wins / c.games) : null,
      kda: c.deaths > 0 ? round3((c.kills + c.assists) / c.deaths) : null,
      bannedAgainst: hasBanData ? bannedAgainstByKey.get(c.key) || 0 : null,
    }))
    .sort((a, b) => b.games - a.games || (a.games === 0 ? (b.bannedAgainst ?? 0) - (a.bannedAgainst ?? 0) || a.champion.localeCompare(b.champion) : 0));
}

export function buildCoPlayMaps(history, selfKey) {
  const teammates = new Map();
  const opponents = new Map();
  for (const entry of history) {
    for (const m of entry.ownTeam?.roster || []) {
      if (m.identityKey && m.identityKey !== selfKey) teammates.set(m.identityKey, m.displayName);
    }
    for (const m of entry.opponentTeam?.roster || []) {
      if (m.identityKey) opponents.set(m.identityKey, m.displayName);
    }
  }
  return { teammates, opponents };
}

export function ofTotal(n, total) {
  if (n == null || !total) return "\u2013";
  return `${n} / ${total}`;
}

const compareNumbers = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
export const CHAMPION_SORTS = {
  champion: { label: "Champion", firstDir: "asc", compare: (a, b) => a.champion.localeCompare(b.champion, undefined, { sensitivity: "base" }) },
  games: { label: "Games", firstDir: "desc", compare: (a, b) => compareNumbers(a.games, b.games) },
  winRate: { label: "Win rate", firstDir: "desc", compare: (a, b) => compareNumbers(a.winRate ?? -1, b.winRate ?? -1) },
  kda: { label: "KDA", firstDir: "desc", compare: (a, b) => compareNumbers(a.kda === null ? Infinity : a.kda, b.kda === null ? Infinity : b.kda) },
  bannedAgainst: { label: "Banned against", firstDir: "desc", compare: (a, b) => compareNumbers(a.bannedAgainst ?? -1, b.bannedAgainst ?? -1) },
};

export function sortChampionStats(stats, sort) {
  const column = sort?.column;
  if (!column) return [...stats];
  const sign = sort.dir === "asc" ? 1 : -1;
  const { compare } = CHAMPION_SORTS[column];
  return stats
    .map((champion, index) => ({ champion, index }))
    .sort((x, y) => {
      const a = x.champion,
        b = y.champion;
      const playedFirst = (b.games > 0) - (a.games > 0);
      if (playedFirst) return playedFirst;
      const primary = compare(a, b);
      if (primary) return sign * primary;
      return b.games - a.games || x.index - y.index;
    })
    .map((entry) => entry.champion);
}
