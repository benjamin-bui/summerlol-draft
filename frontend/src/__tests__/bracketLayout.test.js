import { describe, expect, it } from "vitest";
import { DEFAULT_METRICS, bracketCardHeight, layoutBracket } from "../utils/bracketLayout";

const team = (name) => ({ key: name.toLowerCase(), name });
// One single-game series: `winner` is the winning team's name.
function match(order, a, b, winner, extra = {}) {
  const { roundLabel = null, ...gameExtra } = extra;
  return {
    seriesId: null,
    roundLabel,
    bestOf: null,
    games: [{
      matchKey: `m${order}`,
      order,
      stage: null,
      team1: team(a),
      team2: team(b),
      winner: winner === a ? "team1" : "team2",
      ...gameExtra,
    }],
  };
}
const byOrder = (layout, order) => layout.nodes.find((node) => node.order === order);
const edgePairs = (layout) => layout.edges.map((edge) => `${edge.from}>${edge.to}`).sort();
const { cardWidth, columnGap, headerHeight, sectionGap } = DEFAULT_METRICS;

describe("bracket layout", () => {
  it("lays out single elimination with connectors from the winners and centred rounds", () => {
    const layout = layoutBracket([
      match(1, "Alpha", "Beta", "Alpha", { round: "Semifinals" }),
      match(2, "Gamma", "Delta", "Gamma", { round: "Semifinals" }),
      match(3, "Alpha", "Gamma", "Alpha", { round: "Final" }),
    ]);
    expect(edgePairs(layout)).toEqual(["m1>m3", "m2>m3"]);
    const [semi1, semi2, final] = [1, 2, 3].map((order) => byOrder(layout, order));
    expect([semi1.col, semi2.col, final.col]).toEqual([0, 0, 1]);
    expect(final.x).toBe(cardWidth + columnGap);
    // Semis stack below the header row; the final sits midway between them.
    expect(semi1.y).toBe(headerHeight);
    expect(semi2.y).toBeGreaterThan(semi1.y + semi1.h);
    expect(final.y).toBe((semi1.y + semi2.y) / 2);
    expect(layout.headers.map((header) => [header.label, header.y])).toEqual([["Semifinals", 0], ["Final", 0]]);
    expect(layout.width).toBe(2 * cardWidth + columnGap);
    expect(layout.height).toBe(semi2.y + semi2.h);
    // Each connector ends at the middle of its target card.
    const edge = layout.edges.find((item) => item.from === "m1");
    expect(edge.path).toBe(`M ${semi1.x + semi1.w} ${semi1.y + semi1.h / 2} H ${final.x - columnGap / 2} V ${final.y + final.h / 2} H ${final.x}`);
  });

  it("draws double elimination: no line for a team dropping to lower, upper/lower finals feed the grand final", () => {
    const upper = { section: "upper" };
    const lower = { section: "lower" };
    const layout = layoutBracket([
      match(1, "Alpha", "Beta", "Alpha", { ...upper, round: "UB Semifinals" }),
      match(2, "Gamma", "Delta", "Gamma", { ...upper, round: "UB Semifinals" }),
      match(3, "Alpha", "Gamma", "Alpha", { ...upper, round: "UB Final" }),
      match(4, "Beta", "Delta", "Beta", { ...lower, round: "LB Round 1" }),
      match(5, "Beta", "Gamma", "Gamma", { ...lower, round: "LB Final" }),
      match(6, "Alpha", "Gamma", "Alpha", { section: "final", round: "Grand Final" }),
    ]);
    // Losers dropping into the lower bracket (m1/m2/m3 -> m4/m5) have no line.
    expect(edgePairs(layout)).toEqual(["m1>m3", "m2>m3", "m3>m6", "m4>m5", "m5>m6"]);
    const n = (order) => byOrder(layout, order);
    // Both brackets are right-aligned so the finals share a column; the grand
    // final follows in its own column.
    expect([n(3).col, n(5).col, n(6).col]).toEqual([1, 1, 2]);
    expect([n(1).col, n(4).col]).toEqual([0, 0]);
    // The lower bracket sits under the upper one, with its own header row.
    const upperBottom = Math.max(n(1).y + n(1).h, n(2).y + n(2).h);
    expect(n(4).y).toBe(upperBottom + sectionGap + headerHeight);
    expect(layout.headers.find((header) => header.label === "LB Round 1").y).toBe(upperBottom + sectionGap);
    // The grand final is centred between the two finals, headed at the top.
    expect(n(6).y).toBe((n(3).y + n(5).y) / 2);
    expect(layout.headers.find((header) => header.label === "Grand Final").y).toBe(0);
    expect(layout.height).toBeGreaterThanOrEqual(n(5).y + n(5).h);
  });

  it("falls back to series labels in one section when nothing is configured, and never overlaps cards", () => {
    const layout = layoutBracket([
      match(1, "Alpha", "Beta", "Alpha", { roundLabel: "Opening" }),
      match(2, "Gamma", "Delta", "Delta", { roundLabel: "Opening" }),
      match(3, "Epsilon", "Zeta", "Zeta", { roundLabel: "Opening" }),
      match(4, "Alpha", "Delta", "Alpha", { roundLabel: "Finals" }),
    ]);
    expect(layout.headers.map((header) => header.label)).toEqual(["Opening", "Finals"]);
    for (const col of [0, 1]) {
      const ys = layout.nodes.filter((node) => node.col === col).map((node) => node.y).sort((a, b) => a - b);
      ys.forEach((y, i) => i && expect(y - ys[i - 1]).toBeGreaterThanOrEqual(layout.nodes[0].h));
    }
  });

  it("uses game wins for a series, takes its round/section from any game, and draws nothing for a tie", () => {
    const series = {
      seriesId: "s1",
      roundLabel: "Quarterfinal",
      bestOf: 3,
      games: [
        { matchKey: "g2", order: 8, team1: team("Alpha"), team2: team("Beta"), winner: "team1", stage: null },
        { matchKey: "g1", order: 5, team1: team("Alpha"), team2: team("Beta"), winner: "team2", stage: null },
        { matchKey: "g3", order: 9, team1: team("Alpha"), team2: team("Beta"), winner: "team1", stage: null, round: "Round X", section: "lower" },
      ],
    };
    const tied = { seriesId: "s2", roundLabel: null, bestOf: 2, games: [
      { matchKey: "t1", order: 20, team1: team("Gamma"), team2: team("Delta"), winner: "team1", stage: null },
      { matchKey: "t2", order: 21, team1: team("Gamma"), team2: team("Delta"), winner: "team2", stage: null },
    ] };
    const next = match(30, "Gamma", "Alpha", "Alpha");
    const layout = layoutBracket([series, tied, next]);
    const node = layout.nodes.find((item) => item.id === "s1");
    expect(node.teams.map((side) => side.wins)).toEqual([2, 1]);
    expect(node.winnerSide).toBe(0);
    expect(node.order).toBe(5); // placed by its earliest game
    expect([node.section, node.roundName]).toEqual(["lower", "Round X"]);
    // The tied series has no winner, so Gamma's only edge source is missing;
    // Alpha's win in s1 does feed the next match.
    expect(edgePairs(layout)).toEqual(["s1>m30"]);
  });

  it("returns an empty layout for no series", () => {
    expect(layoutBracket([])).toMatchObject({ nodes: [], edges: [], headers: [], width: 0, height: 0 });
  });

  it("orders simultaneous first-round matches by where their winners go, whatever order the data lists them", () => {
    // Four quarterfinals share a match order and arrive scrambled (the source
    // lists simultaneous games newest-first), so data order would cross lines.
    const layout = layoutBracket([
      match(1, "E", "F", "E", { round: "QF" }),
      match(1, "A", "B", "A", { round: "QF" }),
      match(1, "G", "H", "G", { round: "QF" }),
      match(1, "C", "D", "C", { round: "QF" }),
      match(2, "E", "G", "E", { round: "SF" }),
      match(2, "A", "C", "A", { round: "SF" }),
      match(3, "A", "E", "A", { round: "Final" }),
    ].map((series, index) => {
      // Distinct keys: the helper keys by order, which is shared here.
      series.games[0].matchKey = `k${index}`;
      return series;
    }));
    const column = (col) => layout.nodes.filter((node) => node.col === col).sort((a, b) => a.y - b.y);
    const names = (node) => node.teams.map((side) => side.name).join("");
    // Each semifinal's two feeders are neighbours, and no connector crosses:
    // a feeder pair's order follows the order of their targets.
    const quarters = column(0);
    expect(quarters.map(names).map((pair) => ["AB", "CD"].includes(pair) ? "top" : "bottom")).toEqual(["top", "top", "bottom", "bottom"]);
    const semis = column(1);
    const idsAbove = (target) => layout.edges.filter((edge) => edge.to === target.id).map((edge) => edge.from);
    semis.forEach((semi) => {
      const rows = idsAbove(semi).map((id) => quarters.findIndex((node) => node.id === id)).sort();
      expect(rows[1] - rows[0]).toBe(1);
    });
    // Semifinals are centred on their feeders and no two cards in a column overlap.
    semis.forEach((semi) => {
      const ys = idsAbove(semi).map((id) => layout.nodes.find((node) => node.id === id).y);
      expect(semi.y).toBe((ys[0] + ys[1]) / 2);
    });
    quarters.forEach((node, i) => i && expect(node.y - quarters[i - 1].y).toBeGreaterThanOrEqual(node.h));
  });

  it("sizes each card for its own series and still centres and separates cards by their real heights", () => {
    const bo3 = (order, a, b, winner) => ({
      seriesId: `s${order}`, roundLabel: null, bestOf: 3,
      games: [1, 2, 3].map((n) => ({
        matchKey: `s${order}g${n}`, order: order + n / 10, stage: null, round: order === 3 ? "Final" : "Semifinals",
        team1: team(a), team2: team(b), winner: n === 2 ? "team2" : winner === a ? "team1" : "team2",
      })),
    });
    const single = (order, a, b, winner) => match(order, a, b, winner, { round: "Semifinals" });
    const small = bracketCardHeight(single(1, "Alpha", "Beta", "Alpha"));
    const tall = bracketCardHeight(bo3(3, "Alpha", "Gamma", "Alpha"));
    // Two team rows + padding + (one button) vs (three buttons + the Bo3 line).
    expect([small, tall]).toEqual([28 * 2 + 8 + 24, 28 * 2 + 8 + 24 * 4]);

    // Two short semifinals feed a tall Bo3 final.
    const layout = layoutBracket([
      single(1, "Alpha", "Beta", "Alpha"),
      single(2, "Gamma", "Delta", "Gamma"),
      bo3(3, "Alpha", "Gamma", "Alpha"),
    ]);
    const [semi1, semi2, final] = layout.nodes;
    expect([semi1.h, semi2.h, final.h]).toEqual([small, small, tall]);
    // The tall card is centred on the midpoint of its feeders' centres...
    const feederMid = ((semi1.y + semi1.h / 2) + (semi2.y + semi2.h / 2)) / 2;
    expect(final.y + final.h / 2).toBeCloseTo(feederMid);
    expect(Math.min(semi1.y, semi2.y, final.y)).toBeGreaterThanOrEqual(DEFAULT_METRICS.headerHeight);
    expect(semi2.y).toBeGreaterThanOrEqual(semi1.y + semi1.h + DEFAULT_METRICS.rowGap);
    expect(layout.height).toBe(Math.max(...layout.nodes.map((node) => node.y + node.h)));
  });

  it("lowers a section instead of letting a tall card centred on one short feeder rise over the header row", () => {
    const bo3 = {
      seriesId: "f", roundLabel: null, bestOf: 3,
      games: [1, 2, 3].map((n) => ({
        matchKey: `f${n}`, order: 5 + n, stage: null, round: "Final",
        team1: team("Alpha"), team2: team("Beta"), winner: "team1",
      })),
    };
    const feeder = match(1, "Alpha", "Gamma", "Alpha", { round: "Semifinal" });
    const layout = layoutBracket([feeder, bo3]);
    const [semi, final] = layout.nodes;
    expect(final.h).toBeGreaterThan(semi.h);
    expect(final.y).toBe(DEFAULT_METRICS.headerHeight);
    // The connector still runs straight across: both cards share a centre line.
    expect(final.y + final.h / 2).toBeCloseTo(semi.y + semi.h / 2);
  });
});
