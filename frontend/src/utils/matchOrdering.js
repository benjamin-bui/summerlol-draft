import { seasonRankLocal } from "./profileCompute";

const matchOrderOf = (match, index) => {
  const order = Number(match.matchOrder ?? match.match_order ?? match.order);
  return Number.isFinite(order) ? order : index;
};

const stageKeyOf = (match) =>
  match.stageId || match.stage_id ||
  `${match.stageOrder ?? match.stage_order ?? ""}::${match.stageName || match.stage_name || match.stage?.stageName || ""}`;

const roundKeyOf = (match) => {
  const round = match.round || match.seriesRound || match.series_round || null;
  return round ? `${match.section || ""}::${round.trim().toLowerCase()}` : null;
};

function numericRoundLabel(label) {
  const match = String(label).trim().match(/^(.*?)(\d+)\s*$/);
  return match ? { prefix: match[1].trim().toLowerCase(), number: Number(match[2]) } : null;
}

function eliminationRoundRank(label) {
  const normalized = String(label).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/(roundof)?32|r32/.test(normalized)) return 1;
  if (/(roundof)?16|r16/.test(normalized)) return 2;
  if (/(quarterfinal|quarters|qf)/.test(normalized)) return 3;
  if (/(semifinal|semis|sf)/.test(normalized)) return 4;
  if (/(final)/.test(normalized)) return 5;
  return null;
}

export function sortMatchesByTournamentStructure(matches) {
  const decorated = matches.map((match, index) => ({
    match,
    index,
    order: matchOrderOf(match, index),
    stageKey: stageKeyOf(match),
    stageOrder: Number(match.stageOrder ?? match.stage_order ?? match.stage?.stageOrder),
    roundKey: roundKeyOf(match),
    roundLabel: match.round || match.seriesRound || match.series_round || null,
  }));
  const entriesByStage = new Map();
  for (const item of decorated) {
    const key = `${item.match.year}::${item.match.tournament}::${item.stageKey}`;
    if (!entriesByStage.has(key)) entriesByStage.set(key, []);
    entriesByStage.get(key).push(item);
  }
  for (const entries of entriesByStage.values()) {
    if (!entries.length || entries.some((item) => !item.roundKey)) continue;
    // Round labels have no ordinal field, so unknown labels retain recorded order.
    const rounds = new Map();
    for (const item of entries) {
      if (!rounds.has(item.roundKey)) {
        rounds.set(item.roundKey, { key: item.roundKey, label: item.roundLabel, order: item.order });
      } else {
        rounds.get(item.roundKey).order = Math.min(rounds.get(item.roundKey).order, item.order);
      }
    }
    const roundGroups = [...rounds.values()];
    const parsedLabels = roundGroups.map((round) => numericRoundLabel(round.label));
    const numericPrefixes = new Set(parsedLabels.filter(Boolean).map((round) => round.prefix));
    const allNumeric = parsedLabels.every(Boolean) && numericPrefixes.size === 1;
    const reverseNumericOrder = allNumeric && parsedLabels[0].prefix.includes("round of");
    const eliminationRanks = roundGroups.map((round) => eliminationRoundRank(round.label));
    const allEliminationRounds = eliminationRanks.every((rank) => rank !== null);
    roundGroups.sort((a, b) => {
      if (allNumeric) {
        const difference = numericRoundLabel(a.label).number - numericRoundLabel(b.label).number;
        return (reverseNumericOrder ? -difference : difference) ||
          a.order - b.order;
      }
      if (allEliminationRounds) {
        return eliminationRoundRank(a.label) - eliminationRoundRank(b.label) ||
          a.order - b.order;
      }
      return a.order - b.order;
    });
    const orderByRound = new Map(roundGroups.map((round, index) => [round.key, index]));
    for (const item of entries) item.roundOrder = orderByRound.get(item.roundKey);
  }

  decorated.sort((a, b) => {
    const yearDifference = Number(a.match.year || 0) - Number(b.match.year || 0);
    if (yearDifference) return yearDifference;
    const seasonDifference = seasonRankLocal(a.match.tournament) - seasonRankLocal(b.match.tournament);
    if (seasonDifference) return seasonDifference;
    const tournamentDifference = String(a.match.tournament || "").localeCompare(String(b.match.tournament || ""));
    if (tournamentDifference) return tournamentDifference;
    if (Number.isFinite(a.stageOrder) && Number.isFinite(b.stageOrder) && a.stageOrder !== b.stageOrder) {
      return a.stageOrder - b.stageOrder;
    }
    if (a.stageKey === b.stageKey) {
      if (a.roundOrder !== undefined && b.roundOrder !== undefined && a.roundOrder !== b.roundOrder) {
        return a.roundOrder - b.roundOrder;
      }
    }
    return a.order - b.order || a.index - b.index;
  });

  return decorated.map(({ match }) => match);
}
