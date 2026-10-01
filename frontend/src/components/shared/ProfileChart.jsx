import { useEffect, useRef, useState } from "react";
import { getRankTier } from "../../utils/format";

export default function ProfileChart({ history }) {
  const scrollRef = useRef(null);
  const wrapRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!wrapRef.current) return;
    const measure = () => setContainerWidth(Math.max(0, wrapRef.current.clientWidth - 32));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // Default the chart's scroll position to the far right (most recent
    // game) rather than the far left (game 1).
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [history, containerWidth]);

  if (!history.length) {
    return (
      <div ref={wrapRef}>
        <p className="profile-chart-empty">No games recorded yet.</p>
      </div>
    );
  }

  const xMax = history.length;
  const basePxPerGame = 26;
  const targetFilledWidth = 600;
  const height = 260;
  const padL = 45;
  const padR = 15;
  const padT = 15;
  const padB = 30;
  const naturalWidth =
    xMax <= 1
      ? 240
      : (() => {
          const spanCount = xMax - 1;
          const pxPerGame = Math.max(basePxPerGame, targetFilledWidth / spanCount);
          return padL + padR + pxPerGame * spanCount;
        })();
  const width = Math.max(naturalWidth, containerWidth || 0);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const points = history.map((h, i) => ({
    x: i + 1,
    trueskill: h.conservativeRating,
    mu: h.mu,
    sigma: h.sigma,
    outcome: h.outcome,
    opponent: h.opponent,
    year: h.year,
    tournament: h.tournament,
    matchStage: h.matchStage,
  }));

  const yMin = Math.min(...points.map((p) => p.trueskill));
  const yMax = Math.max(...points.map((p) => p.trueskill));
  const yPad = (yMax - yMin) * 0.05 || 1;

  const xScale = (x) => (xMax <= 1 ? padL + plotW / 2 : padL + ((x - 1) / (xMax - 1)) * plotW);
  const yScale = (y) => padT + plotH - ((y - (yMin - yPad)) / (yMax + yPad - (yMin - yPad))) * plotH;

  const badgeSize = 16;
  const badgeOffset = 6;

  const trueskillPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x)} ${yScale(p.trueskill)}`).join(" ");
  const outcomeColor = { win: "#2e7d32", loss: "#c62828" };

  const ticks = 4;
  const gridlines = Array.from({ length: ticks + 1 }, (_, i) => {
    const val = yMin - yPad + (yMax + yPad - (yMin - yPad)) * (i / ticks);
    return { y: yScale(val), label: val.toFixed(1) };
  });

  const segments = [];
  points.forEach((p, i) => {
    const last = segments[segments.length - 1];
    if (last && last.year === p.year && last.tournament === p.tournament) last.endIndex = i;
    else segments.push({ year: p.year, tournament: p.tournament, startIndex: i, endIndex: i });
  });

  const tournamentBoundaries = segments.slice(1).map((seg, idx) => {
    const prevSeg = segments[idx];
    const prevX = xScale(points[prevSeg.endIndex].x);
    const nextX = xScale(points[seg.startIndex].x);
    return (prevX + nextX) / 2;
  });

  const minLabelWidth = 50;
  const xAxisLabels = segments
    .map((seg) => {
      const xStart = xScale(points[seg.startIndex].x);
      const xEnd = xScale(points[seg.endIndex].x);
      if (segments.length > 1 && xEnd - xStart < minLabelWidth) return null;
      return { x: (xStart + xEnd) / 2, text: `${seg.tournament} ${seg.year}` };
    })
    .filter(Boolean);

  return (
    <div ref={wrapRef}>
      <div className="profile-chart-scroll" ref={scrollRef}>
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="profile-chart-svg">
          {gridlines.map((g, i) => (
            <g key={i}>
              <line x1={padL} y1={g.y} x2={width - padR} y2={g.y} stroke="#eee" strokeWidth={1} />
              <text x={padL - 6} y={g.y + 4} textAnchor="end" fontSize={10} fill="#888">
                {g.label}
              </text>
            </g>
          ))}
          {tournamentBoundaries.map((x, i) => (
            <line key={i} x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="#bbb" strokeWidth={1} strokeDasharray="4 3" />
          ))}
          <path d={trueskillPath} fill="none" stroke="#2b6cb0" strokeWidth={2} />
          {points.map((p, i) => (
            <circle key={i} cx={xScale(p.x)} cy={yScale(p.trueskill)} r={3.5} fill={outcomeColor[p.outcome] || "#888"}>
              <title>
                {p.year} {p.tournament}
                {p.matchStage ? ` (${p.matchStage})` : ""} vs {p.opponent}: {p.outcome} (TrueSkill = {p.trueskill}, {"\u03bc"}={p.mu}, {"\u03c3"}={p.sigma})
              </title>
            </circle>
          ))}
          {points.map((p, i) => {
            const tier = getRankTier(p.trueskill);
            const tierName = tier && tier.name ? tier.name.toLowerCase() : "unranked";
            const cx = xScale(p.x);
            const cy = yScale(p.trueskill);
            return (
              <image
                key={i}
                href={`/icons/${tierName}.webp`}
                x={cx - badgeSize / 2}
                y={cy - badgeSize - badgeOffset}
                width={badgeSize}
                height={badgeSize}
              >
                <title>{tier ? tier.name : "Unranked"} Rank</title>
              </image>
            );
          })}
          {xAxisLabels.map((l, i) => (
            <text key={i} x={l.x} y={height - 6} textAnchor="middle" fontSize={10} fill="#888">
              {l.text}
            </text>
          ))}
        </svg>
      </div>
      <div className="profile-chart-legend">
        <span>
          <i style={{ background: "#2e7d32" }} /> win
        </span>
        <span>
          <i style={{ background: "#c62828" }} /> loss
        </span>
      </div>
    </div>
  );
}
