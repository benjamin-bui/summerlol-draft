import { useMemo } from "react";
import { freedmanDiaconisHistogram } from "../../utils/diversityStats";

const W = 560;
const H = 230;
const M = { top: 12, right: 12, bottom: 46, left: 40 };

// Histogram of every player's champion diversity (Gini-Simpson index), binned
// with the Freedman-Diaconis rule. `distribution` is funFacts.championDiversity.
export default function DiversityHistogram({ distribution }) {
  const hist = useMemo(
    () => freedmanDiaconisHistogram((distribution?.players || []).map((p) => p.diversity)),
    [distribution],
  );
  if (!hist) return <p className="stat-formula">Not enough players with recorded champions yet.</p>;

  const { edges, counts, binWidth, n, method } = hist;
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const lo = edges[0];
  const hi = edges[edges.length - 1];
  const x = (v) => M.left + ((v - lo) / (hi - lo)) * innerW;
  const maxCount = Math.max(...counts);
  const yTop = Math.max(2, maxCount);
  const y = (c) => M.top + innerH - (c / yTop) * innerH;
  const yStep = yTop <= 8 ? 1 : yTop <= 20 ? 2 : 5;
  const yTicks = [];
  for (let c = 0; c <= yTop; c += yStep) yTicks.push(c);
  const labelEvery = edges.length > 14 ? 2 : 1;
  const fmt = (v) => v.toFixed(2);

  return (
    <figure className="diversity-histogram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Histogram of champion diversity across ${n} players`}>
        {yTicks.map((c) => (
          <g key={c}>
            <line x1={M.left} x2={W - M.right} y1={y(c)} y2={y(c)} className="chart-grid" />
            <text x={M.left - 6} y={y(c) + 4} textAnchor="end" className="chart-tick">
              {c}
            </text>
          </g>
        ))}
        {counts.map((c, i) => (
          <rect
            key={i}
            x={x(edges[i]) + 1}
            y={y(c)}
            width={Math.max(1, x(edges[i + 1]) - x(edges[i]) - 2)}
            height={y(0) - y(c)}
            className="chart-bar"
          >
            <title>
              {fmt(edges[i])}–{fmt(edges[i + 1])}: {c} {c === 1 ? "player" : "players"}
            </title>
          </rect>
        ))}
        {edges.map((e, i) =>
          i % labelEvery === 0 ? (
            <text key={e} x={x(e)} y={H - M.bottom + 16} textAnchor="middle" className="chart-tick">
              {fmt(e)}
            </text>
          ) : null,
        )}
        <text x={M.left + innerW / 2} y={H - 6} textAnchor="middle" className="chart-axis-label">
          Champion diversity (Gini–Simpson, higher = more varied)
        </text>
        <text transform={`translate(11 ${M.top + innerH / 2}) rotate(-90)`} textAnchor="middle" className="chart-axis-label">
          Players
        </text>
      </svg>
      <figcaption className="stat-formula">
        {n} players with at least {distribution.minGames} games that have a recorded champion. Bin width {binWidth} ({method}).
      </figcaption>
    </figure>
  );
}
