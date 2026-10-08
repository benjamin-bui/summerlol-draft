import { useMemo } from "react";
import { calibrationBins } from "../../utils/predictionStats";

const W = 520;
const H = 300;
const M = { top: 14, right: 16, bottom: 46, left: 46 };
const pctText = (v) => `${Math.round(v * 100)}%`;

// Reliability diagram: dots show how often the pre-game favorite really won,
// grouped by how confident the prediction was. On the dashed diagonal = the
// win probabilities were honest.
export default function CalibrationChart({ matches }) {
  const bins = useMemo(() => calibrationBins(matches), [matches]);
  if (!bins.length) return <p className="stat-formula">No decisive games with a win probability to plot.</p>;

  const lows = bins.map((b) => b.interval.low);
  const yMin = Math.min(0.5, Math.floor(Math.min(...lows) * 10) / 10);
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = (v) => M.left + ((v - 0.5) / 0.5) * innerW;
  const y = (v) => M.top + innerH - ((v - yMin) / (1 - yMin)) * innerH;
  const xTicks = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const yTicks = [];
  for (let v = yMin; v <= 1.0001; v += 0.1) yTicks.push(Number(v.toFixed(1)));
  const radius = (n) => Math.min(13, 4 + Math.sqrt(n) * 1.1);
  const total = bins.reduce((s, b) => s + b.n, 0);

  return (
    <figure className="calibration-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Predicted versus actual win rate of the favorite">
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={M.left - 6} y={y(v) + 4} textAnchor="end" className="chart-tick">
              {pctText(v)}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={`x${v}`} x={x(v)} y={H - M.bottom + 16} textAnchor="middle" className="chart-tick">
            {pctText(v)}
          </text>
        ))}
        <line x1={x(0.5)} y1={y(0.5)} x2={x(1)} y2={y(1)} className="chart-diagonal" />
        <text x={x(0.52)} y={y(0.67)} textAnchor="start" className="chart-note">
          perfectly calibrated
        </text>
        {bins.map((b) => (
          <g key={b.lo}>
            <line x1={x(b.predicted)} x2={x(b.predicted)} y1={y(b.interval.low)} y2={y(b.interval.high)} className="chart-interval" />
            <circle cx={x(b.predicted)} cy={y(b.observed)} r={radius(b.n)} className="chart-dot">
              <title>
                Favorite predicted {pctText(b.lo)}–{pctText(b.hi)}: averaged {pctText(b.predicted)}, actually won {pctText(b.observed)} ({b.wins} of {b.n}{" "}
                {b.n === 1 ? "game" : "games"})
              </title>
            </circle>
          </g>
        ))}
        <text x={M.left + innerW / 2} y={H - 6} textAnchor="middle" className="chart-axis-label">
          Favorite&apos;s predicted win probability
        </text>
        <text transform={`translate(12 ${M.top + innerH / 2}) rotate(-90)`} textAnchor="middle" className="chart-axis-label">
          Favorite&apos;s actual win rate
        </text>
      </svg>
      <figcaption className="stat-formula">
        {total} decisive games grouped into 10-point confidence bands. Larger dot = more games; vertical line = 95% confidence interval. A dot above the
        diagonal means the favorite won more often than predicted.
      </figcaption>
    </figure>
  );
}
