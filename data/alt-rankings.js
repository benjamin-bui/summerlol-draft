/**
 * Two alternative player-ranking methodologies, both operating on the
 * same resolved rows /api/stats uses (post identity-resolution, post
 * years-filtering) — see server.js. Neither applies recency (EWMA)
 * weighting or the risk-aversion parameter; both are simple equal-weight
 * averages over whatever years are currently included. That's a
 * deliberate scope decision (not requested), not an oversight — ask if
 * you want half-life weighting folded into these too.
 *
 * Both follow the same null-handling convention as the main
 * computeGroupStats: every appearance counts toward `n`, but only
 * appearances where the metric could actually be computed contribute to
 * the averaged score. A player with zero computable appearances still
 * shows up with a null score rather than being silently dropped.
 */

function round2(x) {
  return Math.round(x * 100) / 100;
}

// ==================== Expected ROI by pick order ====================

/**
 * The "expected ROI curve": for each exact pick order seen in the data,
 * the historical average placement (Rank) of everyone ever picked at
 * that position. This is an empirical curve, not a theoretical/linear
 * one — if pick order 3 has historically performed unusually well
 * compared to pick order 2, the curve reflects that directly rather
 * than assuming a smooth relationship.
 */
function computeROICurve(rows) {
  const byPickOrder = {};
  for (const row of rows) {
    if (!Number.isFinite(row.pickOrder) || !Number.isFinite(row.rank)) continue;
    if (!byPickOrder[row.pickOrder]) byPickOrder[row.pickOrder] = [];
    byPickOrder[row.pickOrder].push(row.rank);
  }

  return Object.keys(byPickOrder)
    .map(Number)
    .sort((a, b) => a - b)
    .map((pickOrder) => {
      const ranks = byPickOrder[pickOrder];
      const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
      return { pickOrder, expectedRank: round2(avgRank), n: ranks.length };
    });
}

/**
 * Per-player ROI value: for each appearance, (expected rank for that
 * pick order) − (actual rank). Positive means they placed better than
 * historically expected for where they were picked — i.e. good value.
 * Averaged across a player's appearances (unweighted).
 */
function computeROIPlayers(rows, curve) {
  const expectedByPickOrder = {};
  curve.forEach((c) => {
    expectedByPickOrder[c.pickOrder] = c.expectedRank;
  });

  const groups = {};
  for (const row of rows) {
    const key = row.identityKey;
    if (!groups[key]) {
      groups[key] = { entries: [], displayName: row.displayName, profileUrl: row.profileUrl, identified: row.identified };
    }

    let surplus = null;
    if (
      Number.isFinite(row.pickOrder) &&
      Number.isFinite(row.rank) &&
      expectedByPickOrder[row.pickOrder] !== undefined
    ) {
      surplus = expectedByPickOrder[row.pickOrder] - row.rank;
    }
    groups[key].entries.push({ surplus, pickOrder: row.pickOrder, rank: row.rank });
  }

  const result = Object.values(groups).map(({ entries, displayName, profileUrl, identified }) => {
    const n = entries.length;
    const valid = entries.filter((e) => e.surplus !== null);

    let roiValue = null;
    let avgPickOrder = null;
    let avgRank = null;
    if (valid.length > 0) {
      roiValue = valid.reduce((a, e) => a + e.surplus, 0) / valid.length;
      avgPickOrder = valid.reduce((a, e) => a + e.pickOrder, 0) / valid.length;
      avgRank = valid.reduce((a, e) => a + e.rank, 0) / valid.length;
    }

    return {
      group: displayName,
      profileUrl,
      identified,
      n,
      roiValue: roiValue === null ? null : round2(roiValue),
      avgPickOrder: avgPickOrder === null ? null : round2(avgPickOrder),
      avgRank: avgRank === null ? null : round2(avgRank)
    };
  });

  result.sort((a, b) => {
    if (a.roiValue === null) return 1;
    if (b.roiValue === null) return -1;
    return b.roiValue - a.roiValue;
  });
  return result;
}

// ==================== Overall z-score ====================
// Originally tier-based (picks grouped into tiers of size = captain
// count, z-scored within each tier). Dropped the tiering: in a standard
// snake draft, every tier draws from the exact same underlying
// distribution of outcomes (each captain picks exactly once per round,
// and Rank is the captain/team's outcome — identical across all of that
// captain's picks regardless of which tier they landed in). Verified
// directly against the real data: every tier's pooled rank multiset was
// literally identical, season by season. So tier-scoping added
// computation without adding any actual differentiation — a single
// pooled z-score is simpler and mathematically equivalent.

/**
 * One overall average Rank and sample std dev (n-1) across every
 * appearance with a valid Rank, regardless of pick order/tier/year
 * (years-filtering already happened before this is called).
 */
function computeOverallStats(rows) {
  const ranks = rows.map((r) => r.rank).filter((r) => Number.isFinite(r));
  const n = ranks.length;
  if (n === 0) return { n: 0, avgRank: null, sd: null };

  const avg = ranks.reduce((a, b) => a + b, 0) / n;
  const sqDiffSum = ranks.reduce((a, r) => a + (r - avg) ** 2, 0);
  const sd = n > 1 ? Math.sqrt(sqDiffSum / (n - 1)) : 0;
  return { n, avgRank: round2(avg), sd: round2(sd) };
}

/**
 * Per-player z-score: for each appearance, (overall avg rank − actual
 * rank) / overall sd — positive means better than the pooled average
 * placement. Averaged across a player's appearances (unweighted).
 */
function computeOverallZScores(rows, overallStats) {
  const groups = {};
  for (const row of rows) {
    const key = row.identityKey;
    if (!groups[key]) {
      groups[key] = { entries: [], displayName: row.displayName, profileUrl: row.profileUrl, identified: row.identified };
    }

    let z = null;
    if (Number.isFinite(row.rank) && overallStats.sd !== null && overallStats.sd > 0) {
      z = (overallStats.avgRank - row.rank) / overallStats.sd;
    }
    groups[key].entries.push({ z });
  }

  const result = Object.values(groups).map(({ entries, displayName, profileUrl, identified }) => {
    const n = entries.length;
    const valid = entries.filter((e) => e.z !== null);
    const zScore = valid.length > 0 ? valid.reduce((a, e) => a + e.z, 0) / valid.length : null;

    return {
      group: displayName,
      profileUrl,
      identified,
      n,
      zScore: zScore === null ? null : round2(zScore)
    };
  });

  result.sort((a, b) => {
    if (a.zScore === null) return 1;
    if (b.zScore === null) return -1;
    return b.zScore - a.zScore;
  });
  return result;
}

module.exports = {
  computeROICurve,
  computeROIPlayers,
  computeOverallStats,
  computeOverallZScores
};
