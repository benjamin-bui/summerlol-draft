// Lays an elimination stage's series out as a bracket tree.
//
// Input is the stage's series groups from the tournaments summary. Each games
// may carry the editor-assigned `round` (the column heading) and `section`
// ("upper", "lower" or "final"); without them everything is one "upper"
// section whose columns come from the series label / stage text, so an
// unconfigured stage still renders (just less tidily).
//
// Nothing is linked by hand. A line is drawn from match A to match B when the
// team that won A is playing in B and A is the most recent earlier match that
// team played. That reproduces the usual drawing: winners advance along their
// own bracket, losers dropping from upper to lower get no line, and the upper
// and lower finals both feed the grand final.
//
// Layout: columns are rounds in played order. The upper and lower sections are
// right-aligned so their finals share a column, the "final" section follows,
// and each match is vertically centred between the matches that feed it,
// with first-round matches ordered so that connector lines never cross.

export const SECTION_ORDER = ["upper", "lower", "final"];

// A card is two team rows plus a footer of one button per game (and a "Bo3"
// line for a series), so its height depends on its series. The layout spaces
// and centres matches by their real heights.
export const CARD_TEAM_ROW = 28;
export const CARD_FOOTER_PAD = 8;
export const CARD_FOOTER_ROW = 24;

export function bracketCardHeight(group) {
  const rows = group.games.length + (group.bestOf ? 1 : 0);
  return CARD_TEAM_ROW * 2 + CARD_FOOTER_PAD + CARD_FOOTER_ROW * Math.max(1, rows);
}

export const DEFAULT_METRICS = {
  cardWidth: 200,
  columnGap: 40,
  rowGap: 14,
  sectionGap: 26,
  headerHeight: 30,
};

const keyOf = (team) => team.key || team.name;

// Who won a series: game wins per side, winner is whoever has strictly more.
function summarize(group) {
  const games = [...group.games].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const first = games[0];
  if (!first) return null;
  const teams = [
    { key: keyOf(first.team1), name: first.team1.name, wins: 0 },
    { key: keyOf(first.team2), name: first.team2.name, wins: 0 },
  ];
  for (const game of games) {
    const winner = game.winner === "team1" ? game.team1 : game.winner === "team2" ? game.team2 : null;
    if (!winner) continue;
    const side = teams.findIndex((team) => team.key === keyOf(winner));
    if (side >= 0) teams[side].wins += 1;
  }
  const winnerSide = teams[0].wins === teams[1].wins ? null : teams[0].wins > teams[1].wins ? 0 : 1;
  return { games, teams, winnerSide, order: first.order ?? 0 };
}

export function layoutBracket(seriesGroups, overrides = {}) {
  const m = { ...DEFAULT_METRICS, ...overrides };
  const nodes = [];
  seriesGroups.forEach((group, index) => {
    const summary = summarize(group);
    if (!summary) return;
    const assigned = summary.games.find((game) => game.round);
    const section = summary.games.find((game) => SECTION_ORDER.includes(game.section))?.section || "upper";
    nodes.push({
      id: group.seriesId || summary.games[0].matchKey || `series-${index}`,
      group,
      h: bracketCardHeight(group),
      ...summary,
      section,
      roundName: assigned?.round || group.roundLabel || summary.games[0].stage || "Games",
    });
  });
  nodes.sort((a, b) => a.order - b.order);
  if (!nodes.length) return { nodes: [], edges: [], headers: [], width: 0, height: 0, metrics: m };

  // Connectors: the winner's previous match -> the match they play next.
  const edges = [];
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  nodes.forEach((node) => {
    for (const team of node.teams) {
      let previous = null;
      for (const candidate of nodes) {
        if (candidate.order >= node.order) break;
        if (candidate.teams.some((side) => side.key === team.key)) previous = candidate;
      }
      if (previous && previous.winnerSide !== null && previous.teams[previous.winnerSide].key === team.key) {
        edges.push({ from: previous.id, to: node.id });
        incoming.get(node.id).push(previous.id);
      }
    }
  });

  // Rounds per section in played order, then each round's column.
  const sections = SECTION_ORDER.filter((name) => nodes.some((node) => node.section === name));
  const roundsOf = new Map(
    sections.map((name) => [
      name,
      [...new Set(nodes.filter((node) => node.section === name).map((node) => node.roundName))],
    ]),
  );
  const bracketColumns = Math.max(roundsOf.get("upper")?.length || 0, roundsOf.get("lower")?.length || 0);
  const columnOf = (node) => {
    const rounds = roundsOf.get(node.section);
    const index = rounds.indexOf(node.roundName);
    return node.section === "final" ? bracketColumns + index : bracketColumns - rounds.length + index;
  };
  nodes.forEach((node) => {
    node.col = columnOf(node);
    node.w = m.cardWidth;
    node.x = node.col * (m.cardWidth + m.columnGap);
  });
  const columnCount = Math.max(...nodes.map((node) => node.col)) + 1;

  // Vertical placement, one section at a time (upper, lower, final).
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const headers = [];
  let top = m.headerHeight;
  let bottom = top;
  for (const section of sections) {
    const sectionNodes = nodes.filter((node) => node.section === section);
    const sectionTop = section === "final" ? m.headerHeight : top;
    if (section === "final") {
      // The final section is placed left to right, each match centred on
      // whatever feeds it (usually the upper and lower finals, already placed).
      const columns = [...new Set(sectionNodes.map((node) => node.col))].sort((a, b) => a - b);
      for (const col of columns) {
        let lastBottom = null;
        for (const node of sectionNodes.filter((item) => item.col === col)) {
          const feeders = incoming.get(node.id).map((id) => byId.get(id)).filter((feeder) => feeder.y !== undefined);
          let y = feeders.length
            ? feeders.reduce((sum, feeder) => sum + feeder.y + feeder.h / 2, 0) / feeders.length - node.h / 2
            : sectionTop;
          y = Math.max(y, sectionTop);
          if (lastBottom !== null) y = Math.max(y, lastBottom + m.rowGap);
          node.y = y;
          lastBottom = y + node.h;
        }
      }
    } else {
      // Upper/lower: a tidy tree. The data lists simultaneous matches in an
      // arbitrary order, so rather than trust it, order the first-round
      // matches by walking the tree back from the section's last matches
      // (each match's feeders sit next to each other), then centre every
      // match on its feeders.
      const inSection = new Set(sectionNodes.map((node) => node.id));
      const feeders = (node) =>
        incoming.get(node.id).filter((id) => inSection.has(id)).map((id) => byId.get(id)).sort((x, y) => x.order - y.order);
      const hasOutgoing = new Set(edges.filter((edge) => inSection.has(edge.to)).map((edge) => edge.from));
      const roots = sectionNodes.filter((node) => !hasOutgoing.has(node.id)).sort((x, y) => x.order - y.order);
      let cursor = sectionTop;
      const place = (node) => {
        const kids = feeders(node);
        if (!kids.length) {
          node.y = cursor;
          cursor += node.h + m.rowGap;
          return;
        }
        kids.forEach(place);
        node.y = kids.reduce((sum, kid) => sum + kid.y + kid.h / 2, 0) / kids.length - node.h / 2;
      };
      roots.forEach(place);
      // Centring a tall card on short feeders can poke above the section or
      // into its neighbour; nudge down just enough, column by column.
      const lift = sectionTop - Math.min(...sectionNodes.map((node) => node.y));
      if (lift > 0) sectionNodes.forEach((node) => { node.y += lift; });
      for (const col of new Set(sectionNodes.map((node) => node.col))) {
        let lastBottom = null;
        for (const node of sectionNodes.filter((item) => item.col === col).sort((x, y) => x.y - y.y)) {
          if (lastBottom !== null) node.y = Math.max(node.y, lastBottom + m.rowGap);
          lastBottom = node.y + node.h;
        }
      }
    }
    const sectionBottom = Math.max(...sectionNodes.map((node) => node.y + node.h));
    bottom = Math.max(bottom, sectionBottom);
    if (section !== "final") top = sectionBottom + m.sectionGap + m.headerHeight;
    // Column headings: above this section's first row, or at the very top for
    // the final section so it reads as the end of the whole bracket.
    for (const roundName of roundsOf.get(section)) {
      const col = columnOf(sectionNodes.find((node) => node.roundName === roundName));
      headers.push({
        key: `${section}-${roundName}`,
        label: roundName,
        x: col * (m.cardWidth + m.columnGap),
        y: sectionTop - m.headerHeight,
        w: m.cardWidth,
      });
    }
  }

  const resolvedEdges = edges.map(({ from, to }) => {
    const source = byId.get(from);
    const target = byId.get(to);
    const x1 = source.x + source.w;
    const y1 = source.y + source.h / 2;
    const x2 = target.x;
    const y2 = target.y + target.h / 2;
    const mid = x2 - m.columnGap / 2;
    return { from, to, path: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}` };
  });

  return {
    nodes,
    edges: resolvedEdges,
    headers,
    width: columnCount * (m.cardWidth + m.columnGap) - m.columnGap,
    height: bottom,
    metrics: m,
  };
}

export function suggestBracketPlacements(seriesGroups, format) {
  if (!["single-elimination", "double-elimination"].includes(format)) return null;
  const { nodes } = layoutBracket(seriesGroups);
  if (!nodes.length || nodes.some((node) => node.winnerSide === null)) return null;

  const teams = new Map();
  for (const node of nodes) {
    for (const team of node.teams) teams.set(team.key, team);
  }
  const placements = new Map();
  const assign = (team, placement) => {
    if (placements.has(team.key)) return false;
    placements.set(team.key, { key: team.key, name: team.name, placement });
    return true;
  };
  const assignTied = (teams, firstPlacement) => {
    const averagePlacement = firstPlacement + (teams.length - 1) / 2;
    return teams.every((team) => assign(team, averagePlacement));
  };
  const losersByColumn = (matches) => {
    const groups = new Map();
    for (const node of matches) {
      const loser = node.teams[1 - node.winnerSide];
      if (!groups.has(node.col)) groups.set(node.col, new Map());
      groups.get(node.col).set(loser.key, loser);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, group]) => [...group.values()]);
  };

  if (format === "single-elimination") {
    const finalColumn = Math.max(...nodes.map((node) => node.col));
    const finalNodes = nodes.filter((node) => node.col === finalColumn);
    if (finalNodes.length !== 1) return null;
    const finalNode = finalNodes[0];
    const champion = finalNode.teams[finalNode.winnerSide];
    if (!assign(champion, 1)) return null;
    let nextPlacement = 2;
    for (const eliminated of losersByColumn(nodes)) {
      if (!assignTied(eliminated, nextPlacement)) return null;
      nextPlacement += eliminated.length;
    }
  } else {
    const finalNodes = nodes.filter((node) => node.section === "final");
    const lowerNodes = nodes.filter((node) => node.section === "lower");
    if (!finalNodes.length || !lowerNodes.length) return null;
    const finalColumn = Math.max(...finalNodes.map((node) => node.col));
    const lastFinalNodes = finalNodes.filter((node) => node.col === finalColumn);
    if (lastFinalNodes.length !== 1) return null;
    const finalNode = lastFinalNodes[0];
    if (!assign(finalNode.teams[finalNode.winnerSide], 1)) return null;
    if (!assign(finalNode.teams[1 - finalNode.winnerSide], 2)) return null;
    let nextPlacement = 3;
    for (const eliminated of losersByColumn(lowerNodes)) {
      if (!assignTied(eliminated, nextPlacement)) return null;
      nextPlacement += eliminated.length;
    }
  }

  if (placements.size !== teams.size) return null;
  return [...placements.values()].sort((a, b) => a.placement - b.placement || a.name.localeCompare(b.name));
}

export function suggestRoundPlacements(seriesGroups, participants = []) {
  const teams = new Map();
  for (const team of participants) {
    if (team?.key == null) continue;
    teams.set(team.key, {
      key: team.key,
      name: team.name || String(team.key),
      wins: Number.isFinite(team.wins) ? team.wins : 0,
      progress: 0,
      hasRecordedWins: Number.isFinite(team.wins),
    });
  }

  const groups = (seriesGroups || []).filter((group) => group.games?.length);
  const roundOrders = new Map();
  const roundForGroup = new Map();
  for (const group of groups) {
    const first = group.games[0];
    const order = Math.min(...group.games.map((game) => Number(game.order) || 0));
    const stageLabel = first.stage;
    const stageIsRound = typeof stageLabel === "string" && /\b(round|week|day)\s*\d+|\b(?:r|w)\d+\b/i.test(stageLabel);
    const label = first.round || group.games.find((game) => game.round)?.round || group.roundLabel || (stageIsRound ? stageLabel : null);
    const roundKey = label ? `label:${String(label).trim().toLowerCase()}` : `order:${order}`;
    roundOrders.set(roundKey, Math.min(roundOrders.get(roundKey) ?? Infinity, order));
    roundForGroup.set(group, roundKey);

    const sides = [first.team1, first.team2];
    for (const side of sides) {
      if (side?.key == null || teams.has(side.key)) continue;
      teams.set(side.key, { key: side.key, name: side.name || String(side.key), wins: 0, progress: 0, hasRecordedWins: false });
    }

    const gameWins = [0, 0];
    for (const game of group.games) {
      if (game.winner === "team1" || game.winner === 0) gameWins[0] += 1;
      else if (game.winner === "team2" || game.winner === 1) gameWins[1] += 1;
    }
    if (gameWins[0] !== gameWins[1]) {
      const winner = teams.get(sides[gameWins[0] > gameWins[1] ? 0 : 1]?.key);
      if (winner && !winner.hasRecordedWins) winner.wins += 1;
    }
  }

  const roundRank = new Map(
    [...roundOrders.entries()]
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([key], index) => [key, index + 1]),
  );
  for (const group of groups) {
    const progress = roundRank.get(roundForGroup.get(group));
    for (const side of [group.games[0].team1, group.games[0].team2]) {
      const team = teams.get(side?.key);
      if (team) team.progress = Math.max(team.progress, progress);
    }
  }

  const ranked = [...teams.values()].sort(
    (a, b) => b.progress - a.progress || b.wins - a.wins || a.name.localeCompare(b.name),
  );
  const placements = [];
  for (let start = 0; start < ranked.length;) {
    let end = start + 1;
    while (
      end < ranked.length &&
      ranked[end].progress === ranked[start].progress &&
      ranked[end].wins === ranked[start].wins
    ) end += 1;
    const placement = ((start + 1) + end) / 2;
    for (const team of ranked.slice(start, end)) placements.push({ key: team.key, name: team.name, placement });
    start = end;
  }
  return placements;
}

export function combineStagePlacements(stageResults) {
  const latestStageByTeam = new Map();
  for (const stage of stageResults || []) {
    for (const team of stage.placements || []) {
      const current = latestStageByTeam.get(team.key);
      if (!current || stage.order > current.order) {
        latestStageByTeam.set(team.key, { ...team, order: stage.order });
      }
    }
  }
  const ranked = [...latestStageByTeam.values()].sort(
    (a, b) => b.order - a.order || a.placement - b.placement || a.name.localeCompare(b.name),
  );
  const placements = [];
  for (let start = 0; start < ranked.length;) {
    let end = start + 1;
    while (end < ranked.length && ranked[end].order === ranked[start].order && ranked[end].placement === ranked[start].placement) end += 1;
    const placement = ((start + 1) + end) / 2;
    for (const team of ranked.slice(start, end)) placements.push({ key: team.key, name: team.name, placement });
    start = end;
  }
  return placements;
}
