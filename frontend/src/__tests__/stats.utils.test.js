import { describe, expect, it } from "vitest";
import { diversityPercentile, freedmanDiaconisHistogram, quantile } from "../utils/diversityStats";
import { calibrationBins, predictionStats, wilsonInterval } from "../utils/predictionStats";

describe("quantile", () => {
  it("interpolates like numpy's default", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
    expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25);
    expect(quantile([5], 0.5)).toBe(5);
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe("freedmanDiaconisHistogram", () => {
  const values = Array.from({ length: 40 }, (_, i) => 0.4 + (i / 39) * 0.5);
  it("conserves every value and uses contiguous snapped edges", () => {
    const h = freedmanDiaconisHistogram(values);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(40);
    expect(h.edges.length).toBe(h.counts.length + 1);
    for (let i = 1; i < h.edges.length; i++) expect(h.edges[i] - h.edges[i - 1]).toBeCloseTo(h.binWidth, 6);
    expect(h.edges[0]).toBeLessThanOrEqual(0.4);
    expect(h.edges.at(-1)).toBeGreaterThanOrEqual(0.9);
    expect(h.method).toMatch(/Freedman/);
  });
  it("matches the FD formula for evenly spread data (h = 2*IQR*n^-1/3, rounded to 0.005)", () => {
    const h = freedmanDiaconisHistogram(values);
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const raw = 2 * (q3 - q1) * Math.cbrt(1 / 40);
    expect(Math.abs(h.binWidth - raw)).toBeLessThanOrEqual(0.0026);
  });
  it("puts a value sitting exactly on the top edge in the last bin", () => {
    const h = freedmanDiaconisHistogram([0.5, 0.55, 0.6, 0.6, 0.65, 0.7]);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(6);
    expect(h.counts.at(-1)).toBeGreaterThan(0);
  });
  it("falls back when the IQR is zero and handles degenerate input", () => {
    const h = freedmanDiaconisHistogram([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.9]);
    expect(h.method).toMatch(/square-root/);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(7);
    expect(freedmanDiaconisHistogram([0.5])).toBeNull();
    expect(freedmanDiaconisHistogram([0.5, 0.5]).counts.reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("diversityPercentile", () => {
  const dist = {
    minGames: 10,
    players: [0.3, 0.5, 0.6, 0.7, 0.9].map((diversity, i) => ({ key: `p${i}`, games: 12, diversity })),
  };
  it("is the share of OTHER players with a strictly lower score, rounded down", () => {
    // p3 (0.7) vs the other four: 0.3, 0.5, 0.6 are lower -> 3/4 = 75%
    expect(diversityPercentile(dist, "p3", 0.7, 12).percentile).toBe(75);
    expect(diversityPercentile(dist, "p4", 0.9, 12).percentile).toBe(100);
    expect(diversityPercentile(dist, "p0", 0.3, 12).percentile).toBe(0);
    // someone not in the distribution: 4 of 5 lower than 0.8 -> 80%
    expect(diversityPercentile(dist, "zzz", 0.8, 12).percentile).toBe(80);
    // 2 of 3 = 66.67% must read 66, not 67
    const small = { minGames: 1, players: [0.1, 0.2, 0.9].map((diversity, i) => ({ key: `q${i}`, games: 5, diversity })) };
    expect(diversityPercentile(small, "me", 0.5, 5).percentile).toBe(66);
  });
  it("refuses to rank someone with too few games, and tolerates a missing distribution", () => {
    expect(diversityPercentile(dist, "p3", 0.7, 9)).toMatchObject({ percentile: null, reason: "too-few-games", minGames: 10 });
    expect(diversityPercentile(dist, "p3", null, 0)).toMatchObject({ percentile: null });
    expect(diversityPercentile(undefined, "p3", 0.7, 12)).toBeNull();
  });
});

const m = (p, winner) => ({ predictedWinProbTeam1: p, winner });

describe("predictionStats", () => {
  it("computes Brier score, skill vs a coin flip, and favorite accuracy", () => {
    const s = predictionStats([m(0.8, "team1"), m(0.7, "team2"), m(0.5, "team1")]);
    // (0.2^2 + 0.7^2 + 0.5^2) / 3
    expect(s.brier).toBeCloseTo((0.04 + 0.49 + 0.25) / 3, 10);
    expect(s.skill).toBeCloseTo(1 - s.brier / 0.25, 10);
    expect(s.games).toBe(3);
    // the 50/50 game has no favorite
    expect(s.favoriteGames).toBe(2);
    expect(s.favoriteWins).toBe(1);
    expect(s.accuracy).toBe(0.5);
  });
  it("scores a constant 50% forecast exactly 0.25 and ignores draws", () => {
    const s = predictionStats([m(0.5, "team1"), m(0.5, "team2"), m(0.9, "draw")]);
    expect(s.brier).toBeCloseTo(0.25);
    expect(s.skill).toBeCloseTo(0);
    expect(s.games).toBe(2);
    expect(s.accuracy).toBeNull();
  });
  it("handles no games", () => {
    expect(predictionStats([]).brier).toBeNull();
  });
});

describe("calibrationBins", () => {
  it("groups by favorite confidence and counts each game once", () => {
    const bins = calibrationBins([
      m(0.65, "team1"), // favorite team1 wins
      m(0.35, "team2"), // favorite team2 (65%) wins
      m(0.62, "team2"), // favorite loses
      m(0.85, "team1"),
      m(0.5, "team1"), // no favorite -> skipped
    ]);
    expect(bins.map((b) => [b.lo.toFixed(1), b.n, b.wins])).toEqual([
      ["0.6", 3, 2],
      ["0.8", 1, 1],
    ]);
    expect(bins[0].observed).toBeCloseTo(2 / 3);
    expect(bins[0].predicted).toBeCloseTo((0.65 + 0.65 + 0.62) / 3);
  });
  it("puts a 100% favorite in the top bin", () => {
    const bins = calibrationBins([m(1, "team1")]);
    expect(bins[0].lo).toBeCloseTo(0.9);
  });
});

describe("wilsonInterval", () => {
  it("stays inside [0,1] and brackets the observed rate", () => {
    const w = wilsonInterval(3, 3);
    expect(w.high).toBeLessThanOrEqual(1);
    expect(w.low).toBeGreaterThan(0.4);
    const z = wilsonInterval(0, 4);
    expect(z.low).toBe(0);
    expect(wilsonInterval(5, 10).low).toBeLessThan(0.5);
    expect(wilsonInterval(5, 10).high).toBeGreaterThan(0.5);
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});
