// Statistics for the champion-diversity histogram (Players tab fun facts) and
// the percentile shown when hovering a player's Champion Diversity score.
// Pure functions; the distribution itself comes from the backend
// (computeChampionDiversityDistribution in trueskill-funfacts.js).

// Quantile of an ascending-sorted array, linear interpolation between
// closest ranks (the "type 7" definition used by R's default and numpy).
export function quantile(sortedAsc, q) {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

// Histogram with the Freedman-Diaconis bin width, h = 2 * IQR * n^(-1/3).
// FD is a good fit here: it is driven by the interquartile range, so a couple
// of one-trick or extremely varied outliers don't stretch the bins the way
// they would with Sturges' rule or a range-based width.
//
// Presentation tweaks on top of the textbook rule:
//   - h is rounded to a multiple of 0.005 (never below 0.01) and edges are
//     snapped to multiples of h, so axis labels read 0.60, 0.65, ... rather
//     than 0.5873, 0.6419, ...
//   - if the IQR is 0 (most values identical) FD degenerates; fall back to
//     the square-root rule on the data range.
//   - bins are capped at maxBins so a large league can't produce a comb.
// Bins are half-open [lo, hi) except the last, which includes its upper edge.
export function freedmanDiaconisHistogram(values, { maxBins = 40 } = {}) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = xs.length;
  if (n < 2) return null;
  const min = xs[0];
  const max = xs[n - 1];
  const range = max - min;
  const iqr = quantile(xs, 0.75) - quantile(xs, 0.25);

  let method = "Freedman\u2013Diaconis";
  let width = 2 * iqr * Math.cbrt(1 / n);
  if (!(width > 0)) {
    method = "square-root rule (IQR is 0)";
    width = range > 0 ? range / Math.ceil(Math.sqrt(n)) : 0.05;
  }
  width = Math.max(0.01, Math.round(width / 0.005) * 0.005);
  if (range / width > maxBins) width = Math.ceil(range / maxBins / 0.005) * 0.005;

  const decimals = 3;
  const snap = (x) => Number(x.toFixed(decimals));
  const start = snap(Math.floor(min / width + 1e-9) * width);
  let binCount = Math.max(1, Math.ceil((max - start) / width - 1e-9));
  if (start + binCount * width <= max - 1e-9) binCount += 1;
  const edges = Array.from({ length: binCount + 1 }, (_, i) => snap(start + i * width));
  const counts = new Array(binCount).fill(0);
  for (const v of xs) {
    const i = Math.min(binCount - 1, Math.max(0, Math.floor((v - start) / width + 1e-9)));
    counts[i] += 1;
  }
  return { edges, counts, binWidth: snap(width), n, method };
}

// Where `value` sits among everyone else in the distribution.
//   distribution: { minGames, players: [{ key, games, diversity }] } from the API
//   selfKey:      the viewed player's identityKey (excluded from the comparison
//                 so nobody is ranked against themselves)
//   games:        how many champion-recorded games `value` was computed from
// Returns { percentile, others, minGames } where percentile is the whole-number
// share of the other qualifying players with a strictly lower score (rounded
// DOWN, so "higher than 97%" is never an overstatement), or
// { percentile: null, reason } when it can't be computed honestly.
export function diversityPercentile(distribution, selfKey, value, games) {
  if (!distribution || !Array.isArray(distribution.players)) return null;
  const { minGames, players } = distribution;
  if (value == null) return { percentile: null, reason: "no-data", minGames };
  if (games < minGames) return { percentile: null, reason: "too-few-games", games, minGames };
  const others = players.filter((p) => p.key !== selfKey);
  if (others.length === 0) return { percentile: null, reason: "no-others", minGames };
  const lower = others.filter((p) => p.diversity < value - 1e-9).length;
  return { percentile: Math.floor((lower / others.length) * 100), others: others.length, minGames };
}
