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

export const DEFAULT_METRICS = {
  cardWidth: 200,
  cardHeight: 78,
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
    node.h = m.cardHeight;
    node.x = node.col * (m.cardWidth + m.columnGap);
  });
  const columnCount = Math.max(...nodes.map((node) => node.col)) + 1;

  // Vertical placement, one section at a time (upper, lower, final).
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const slot = m.cardHeight + m.rowGap;
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
        let last = null;
        for (const node of sectionNodes.filter((item) => item.col === col)) {
          const feeders = incoming.get(node.id).map((id) => byId.get(id)).filter((feeder) => feeder.y !== undefined);
          let y = feeders.length ? feeders.reduce((sum, feeder) => sum + feeder.y, 0) / feeders.length : sectionTop;
          y = Math.max(y, sectionTop);
          if (last !== null) y = Math.max(y, last + slot);
          node.y = y;
          last = y;
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
      let leaf = 0;
      const place = (node) => {
        const kids = feeders(node);
        if (!kids.length) {
          node.y = sectionTop + leaf * slot;
          leaf += 1;
          return;
        }
        kids.forEach(place);
        node.y = kids.reduce((sum, kid) => sum + kid.y, 0) / kids.length;
      };
      roots.forEach(place);
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
