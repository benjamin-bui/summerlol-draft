import { useMemo, useRef, useState } from "react";
import { round3 } from "../utils/format";

const WIDTH = 700;
const HEIGHT = 420;
const PAD_L = 55;
const PAD_R = 20;
const PAD_T = 20;
const PAD_B = 45;
const PLOT_W = WIDTH - PAD_L - PAD_R;
const PLOT_H = HEIGHT - PAD_T - PAD_B;

function buildDraftScatterData(draftAnalysis) {
  const picksByTeam = new Map();
  for (const p of draftAnalysis.picks) {
    const key = `${p.year}::${p.tournament}::${p.captain}`;
    if (!picksByTeam.has(key)) picksByTeam.set(key, []);
    picksByTeam.get(key).push(p);
  }
  return draftAnalysis.teamBalance
    .map((team) => {
      const key = `${team.year}::${team.tournament}::${team.captain}`;
      const teamPicks = picksByTeam.get(key);
      if (!teamPicks || teamPicks.length === 0 || team.games === 0) return null;
      const avgDraftValue = round3(teamPicks.reduce((s, p) => s + p.value, 0) / teamPicks.length);
      return {
        captain: team.captain,
        year: team.year,
        tournament: team.tournament,
        avgDraftValue,
        picksEvaluated: teamPicks.length,
        wins: team.wins,
        losses: team.losses,
        games: team.games,
        winRate: team.winRate,
      };
    })
    .filter(Boolean);
}

function colorForIndex(i, n) {
  const hue = Math.round((i * 360) / Math.max(n, 1)) % 360;
  return `hsl(${hue}deg 45% 60%)`;
}

function getGroupKey(p, groupBy) {
  if (groupBy === "captain") return p.captain;
  if (groupBy === "year") return String(p.year);
  if (groupBy === "yearTournament") return `${p.year} : ${p.tournament}`;
  return null;
}

function seasonRank(tournament) {
  const t = String(tournament || "").toLowerCase();
  if (t === "winter") return 0;
  if (t === "summer") return 1;
  return 2;
}

function buildGroupOrder(data, groupBy) {
  if (groupBy === "none") return [null];
  const keys = [...new Set(data.map((p) => getGroupKey(p, groupBy)))];
  if (groupBy === "captain") return keys.sort((a, b) => a.localeCompare(b));
  if (groupBy === "year") return keys.sort((a, b) => Number(b) - Number(a));
  if (groupBy === "yearTournament") {
    return keys.sort((a, b) => {
      const [ay, at] = a.split(" : ");
      const [by, bt] = b.split(" : ");
      if (ay !== by) return Number(by) - Number(ay);
      return seasonRank(at) - seasonRank(bt);
    });
  }
  return keys;
}

function studentTPValue(t, df) {
  if (isNaN(t) || df <= 0) return 1;
  const absT = Math.abs(t);
  if (df > 300) {
    const z = absT;
    const b1 = 0.31938153,
      b2 = -0.356563782,
      b3 = 1.781477937,
      b4 = -1.821255978,
      b5 = 1.330274429;
    const k = 1 / (1 + 0.2316419 * z);
    const poly = k * (b1 + k * (b2 + k * (b3 + k * (b4 + k * b5))));
    const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z);
    return Math.min(1, Math.max(0, 2 * phi * poly));
  }
  const theta = Math.atan(absT / Math.sqrt(df));
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  if (df % 2 === 1) {
    let term = sin * cos;
    let sum = term;
    for (let i = 3; i < df; i += 2) {
      term *= ((i - 1) / i) * cos * cos;
      sum += term;
    }
    const cdf = (2 / Math.PI) * (theta + (df === 1 ? 0 : sum));
    return Math.max(0, 1 - cdf);
  }
  let term = sin;
  let sum = term;
  for (let i = 2; i < df; i += 2) {
    term *= ((i - 1) / i) * cos * cos;
    sum += term;
  }
  return Math.max(0, 1 - sum);
}

function formatPValue(p) {
  if (p < 0.001) return "p < 0.001";
  return `p = ${p.toFixed(3)}`;
}

function computeRegressionLine(pts) {
  const n = pts.length;
  if (n < 3) return null;
  const meanX = pts.reduce((s, p) => s + p.avgDraftValue, 0) / n;
  const meanY = pts.reduce((s, p) => s + p.winRate, 0) / n;
  let ssXX = 0,
    ssYY = 0,
    ssXY = 0;
  for (const p of pts) {
    const dx = p.avgDraftValue - meanX;
    const dy = p.winRate - meanY;
    ssXX += dx * dx;
    ssYY += dy * dy;
    ssXY += dx * dy;
  }
  if (ssXX === 0) return null;
  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const rSquared = ssYY === 0 ? 0 : Math.min(1, Math.max(0, (ssXY * ssXY) / (ssXX * ssYY)));
  const df = n - 2;
  const ssRes = Math.max(0, ssYY - (ssXY * ssXY) / ssXX);
  const mse = ssRes / df;
  const seSlope = Math.sqrt(mse / ssXX);
  let pValue = 1;
  if (seSlope === 0) {
    pValue = slope === 0 ? 1 : 0;
  } else {
    pValue = studentTPValue(slope / seSlope, df);
  }
  return { slope, intercept, rSquared, pValue, n };
}

function computeDomain(pts) {
  const xs = pts.map((p) => p.avgDraftValue);
  const ys = pts.map((p) => p.winRate);
  const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.1 || 1;
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.1 || 0.05;
  return {
    xMin: Math.min(...xs) - xPad,
    xMax: Math.max(...xs) + xPad,
    yMin: Math.max(0, Math.min(...ys) - yPad),
    yMax: Math.min(1, Math.max(...ys) + yPad),
  };
}

function computeJitteredPositions(points) {
  const groups = new Map();
  for (const p of points) {
    const posKey = `${p.avgDraftValue}:${p.winRate}`;
    if (!groups.has(posKey)) groups.set(posKey, []);
    groups.get(posKey).push(p);
  }
  const jitterOf = new Map();
  for (const group of groups.values()) {
    if (group.length === 1) {
      jitterOf.set(group[0], { dxPx: 0, dyPx: 0 });
      continue;
    }
    const jitterRadiusPx = 7;
    group.forEach((p, i) => {
      const angle = (i / group.length) * 2 * Math.PI;
      jitterOf.set(p, { dxPx: Math.cos(angle) * jitterRadiusPx, dyPx: Math.sin(angle) * jitterRadiusPx });
    });
  }
  return jitterOf;
}

export default function DraftScatterChart({ analysis }) {
  const data = useMemo(() => buildDraftScatterData(analysis), [analysis]);
  const fullDomain = useMemo(() => computeDomain(data), [data]);
  const [domain, setDomain] = useState(fullDomain);
  const [groupBy, setGroupBy] = useState("none");
  const [selectedKey, setSelectedKey] = useState(null);
  const [selectedGroupKey, setSelectedGroupKey] = useState(null);
  const [tooltip, setTooltip] = useState(null); // { x, y, point }
  const [dragRect, setDragRect] = useState(null);
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const dragStartRef = useRef(null);

  function xScale(x) {
    return PAD_L + ((x - domain.xMin) / (domain.xMax - domain.xMin)) * PLOT_W;
  }
  function yScale(y) {
    return PAD_T + PLOT_H - ((y - domain.yMin) / (domain.yMax - domain.yMin)) * PLOT_H;
  }

  function colorFor(p) {
    if (groupBy === "none") return "var(--accent)";
    const order = buildGroupOrder(data, groupBy);
    const key = getGroupKey(p, groupBy);
    return colorForIndex(order.indexOf(key), order.length);
  }

  const visiblePoints = data.filter(
    (p) => p.avgDraftValue >= domain.xMin && p.avgDraftValue <= domain.xMax && p.winRate >= domain.yMin && p.winRate <= domain.yMax,
  );
  const jitterOf = computeJitteredPositions(visiblePoints);
  const groupOrder = buildGroupOrder(data, groupBy);

  const sortedForPaint = [...visiblePoints].sort((a, b) => {
    const aKey = `${a.year}::${a.tournament}::${a.captain}`;
    const bKey = `${b.year}::${b.tournament}::${b.captain}`;
    const aHi = aKey === selectedKey || (selectedGroupKey && getGroupKey(a, groupBy) === selectedGroupKey);
    const bHi = bKey === selectedKey || (selectedGroupKey && getGroupKey(b, groupBy) === selectedGroupKey);
    return (aHi ? 1 : 0) - (bHi ? 1 : 0);
  });

  const regression = computeRegressionLine(data);
  const xTicks = 5,
    yTicks = 5;

  function svgPoint(evt) {
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / WIDTH, rect.height / HEIGHT);
    const renderedWidth = WIDTH * scale;
    const renderedHeight = HEIGHT * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    return { x: (evt.clientX - rect.left - offsetX) / scale, y: (evt.clientY - rect.top - offsetY) / scale };
  }

  function handleOverlayPointerDown(e) {
    dragStartRef.current = svgPoint(e);
    setDragRect({ x: dragStartRef.current.x, y: dragStartRef.current.y, w: 0, h: 0 });
  }
  function handleSvgPointerMove(e) {
    if (!dragStartRef.current) return;
    const cur = svgPoint(e);
    const x = Math.min(dragStartRef.current.x, cur.x);
    const y = Math.min(dragStartRef.current.y, cur.y);
    setDragRect({ x, y, w: Math.abs(cur.x - dragStartRef.current.x), h: Math.abs(cur.y - dragStartRef.current.y) });
  }
  function handleSvgPointerUp(e) {
    if (!dragStartRef.current) return;
    const cur = svgPoint(e);
    const x1 = Math.min(dragStartRef.current.x, cur.x),
      x2 = Math.max(dragStartRef.current.x, cur.x);
    const y1 = Math.min(dragStartRef.current.y, cur.y),
      y2 = Math.max(dragStartRef.current.y, cur.y);
    dragStartRef.current = null;
    setDragRect(null);
    if (x2 - x1 < 8 || y2 - y1 < 8) return;
    const invX = (px) => domain.xMin + ((px - PAD_L) / PLOT_W) * (domain.xMax - domain.xMin);
    const invY = (py) => domain.yMin + ((PAD_T + PLOT_H - py) / PLOT_H) * (domain.yMax - domain.yMin);
    setDomain({
      xMin: invX(x1),
      xMax: invX(x2),
      yMin: Math.max(0, invY(y2)),
      yMax: Math.min(1, invY(y1)),
    });
  }

  function resetZoom() {
    setDomain(fullDomain);
    setSelectedKey(null);
    setSelectedGroupKey(null);
  }

  const regressionLine = regression
    ? (() => {
        const y1 = regression.slope * domain.xMin + regression.intercept;
        const y2 = regression.slope * domain.xMax + regression.intercept;
        return { x1: xScale(domain.xMin), y1: yScale(y1), x2: xScale(domain.xMax), y2: yScale(y2) };
      })()
    : null;

  return (
    <div className="draft-scatter-container" ref={containerRef} style={{ position: "relative" }}>
      <div className="draft-scatter-groupby">
        <label>Color by: </label>
        <select
          value={groupBy}
          onChange={(e) => {
            setGroupBy(e.target.value);
            setSelectedKey(null);
            setSelectedGroupKey(null);
          }}
        >
          <option value="none">Ungrouped</option>
          <option value="captain">Captain</option>
          <option value="year">Year</option>
          <option value="yearTournament">Year : Tournament</option>
        </select>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        className="draft-scatter-svg"
        onPointerMove={handleSvgPointerMove}
        onPointerUp={handleSvgPointerUp}
      >
        <defs>
          <clipPath id="draftScatterPlotClip">
            <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} />
          </clipPath>
        </defs>
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const val = domain.xMin + (domain.xMax - domain.xMin) * (i / xTicks);
          const x = xScale(val);
          return (
            <g key={`x${i}`}>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + PLOT_H} stroke="var(--border)" strokeWidth={1} />
              <text x={x} y={HEIGHT - PAD_B + 16} textAnchor="middle" fontSize={10} fill="var(--muted)">
                {val.toFixed(1)}
              </text>
            </g>
          );
        })}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const val = domain.yMin + (domain.yMax - domain.yMin) * (i / yTicks);
          const y = yScale(val);
          return (
            <g key={`y${i}`}>
              <line x1={PAD_L} y1={y} x2={PAD_L + PLOT_W} y2={y} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize={10} fill="var(--muted)">
                {Math.round(val * 100)}%
              </text>
            </g>
          );
        })}
        <line x1={PAD_L} y1={PAD_T + PLOT_H} x2={PAD_L + PLOT_W} y2={PAD_T + PLOT_H} stroke="var(--muted)" strokeWidth={1} />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + PLOT_H} stroke="var(--muted)" strokeWidth={1} />
        <text x={PAD_L + PLOT_W / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
          Draft IQ (avg pick value)
        </text>
        <text
          x={14}
          y={PAD_T + PLOT_H / 2}
          textAnchor="middle"
          fontSize={11}
          fill="var(--muted)"
          transform={`rotate(-90 14 ${PAD_T + PLOT_H / 2})`}
        >
          Win Rate
        </text>
        {regressionLine && (
          <line
            x1={regressionLine.x1}
            y1={regressionLine.y1}
            x2={regressionLine.x2}
            y2={regressionLine.y2}
            stroke="var(--muted)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            clipPath="url(#draftScatterPlotClip)"
          />
        )}
        {regression && (
          <text x={PAD_L + PLOT_W - 6} y={PAD_T + 14} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--muted)">
            {"R\u00b2"} = {regression.rSquared.toFixed(3)} ({formatPValue(regression.pValue)})
          </text>
        )}
        <rect
          className="scatter-zoom-overlay"
          x={PAD_L}
          y={PAD_T}
          width={PLOT_W}
          height={PLOT_H}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onPointerDown={handleOverlayPointerDown}
        />
        {sortedForPaint.map((p) => {
          const pointKey = `${p.year}::${p.tournament}::${p.captain}`;
          const groupKey = getGroupKey(p, groupBy);
          const isSelectedPoint = pointKey === selectedKey;
          const isDimmed = (selectedKey && !isSelectedPoint) || (selectedGroupKey && groupKey !== selectedGroupKey);
          const r = 4 + Math.sqrt(p.games);
          const fillColor = colorFor(p);
          const jitter = jitterOf.get(p) || { dxPx: 0, dyPx: 0 };
          const cx = xScale(p.avgDraftValue) + jitter.dxPx;
          const cy = yScale(p.winRate) + jitter.dyPx;
          return (
            <circle
              key={pointKey}
              cx={cx}
              cy={cy}
              r={isSelectedPoint ? r + 2 : r}
              fill={fillColor}
              fillOpacity={isDimmed ? 0.08 : 0.5}
              stroke={isSelectedPoint ? "var(--text)" : fillColor}
              strokeOpacity={isDimmed ? 0.15 : isSelectedPoint ? 1 : 0.75}
              strokeWidth={isSelectedPoint ? 2.5 : 1.25}
              style={{ cursor: "pointer" }}
              onPointerEnter={(e) => {
                const rect = containerRef.current.getBoundingClientRect();
                setTooltip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12, point: p });
              }}
              onPointerMove={(e) => {
                const rect = containerRef.current.getBoundingClientRect();
                setTooltip((prev) => (prev ? { ...prev, x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12 } : prev));
              }}
              onPointerLeave={() => setTooltip(null)}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedGroupKey(null);
                setSelectedKey((prev) => (prev === pointKey ? null : pointKey));
              }}
            />
          );
        })}
        {dragRect && (
          <rect x={dragRect.x} y={dragRect.y} width={dragRect.w} height={dragRect.h} fill="var(--accent)" fillOpacity={0.15} stroke="var(--accent)" strokeWidth={1} style={{ pointerEvents: "none" }} />
        )}
      </svg>
      <div className="draft-scatter-controls">
        <button className="scatter-reset-btn" type="button" onClick={resetZoom}>
          Reset zoom / selection
        </button>
        <span className="draft-scatter-hint">Drag to zoom {"\u00b7"} click a point or legend entry to highlight</span>
      </div>
      {groupBy !== "none" && (
        <div className="draft-scatter-legend">
          {groupOrder.map((key, i) => (
            <button
              key={key}
              type="button"
              className={`legend-item${selectedGroupKey && selectedGroupKey !== key ? " dimmed" : ""}`}
              onClick={() => {
                setSelectedKey(null);
                setSelectedGroupKey((prev) => (prev === key ? null : key));
              }}
            >
              <i style={{ background: colorForIndex(i, groupOrder.length) }} />
              {key}
            </button>
          ))}
        </div>
      )}
      {tooltip && (
        <div className="draft-scatter-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <strong>{tooltip.point.captain}</strong> <span style={{ color: "var(--muted)" }}>
            ({tooltip.point.tournament} {tooltip.point.year})
          </span>
          <br />
          Draft value: {tooltip.point.avgDraftValue > 0 ? "+" : ""}
          {tooltip.point.avgDraftValue} ({tooltip.point.picksEvaluated} picks)
          <br />
          Record: {tooltip.point.wins}W {tooltip.point.losses}L ({Math.round(tooltip.point.winRate * 100)}%)
        </div>
      )}
    </div>
  );
}
