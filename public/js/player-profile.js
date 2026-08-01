import { escapeHtml, renderNameWithTag, renderTrueSkillValue, renderRankBadge } from "./utils.js";

const playerProfileModal = document.getElementById("playerProfileModal");
const playerProfileCloseBtn = document.getElementById("playerProfileClose");
const playerProfileContent = document.getElementById("playerProfileContent");
const playerProfileTitle = document.getElementById("playerProfileTitle");

function closePlayerProfile() {
  if (!playerProfileModal) return;
  playerProfileModal.classList.remove("open");
  playerProfileModal.setAttribute("aria-hidden", "true");
  playerProfileContent.innerHTML = "Loading…";
}

function buildChartHtml(history) {
  if (!history.length) {
    return '<p class="profile-chart-empty">No games recorded yet.</p>';
  }

  const width = 900;
  const height = 260;
  const padL = 45;
  const padR = 15;
  const padT = 15;
  const padB = 30;
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
  }));

  const xMax = points.length;
  const yMin = Math.min(...points.map((p) => p.trueskill));
  const yMax = Math.max(...points.map((p) => p.trueskill));
  const yPad = (yMax - yMin) * 0.05 || 1;

  const xScale = (x) => padL + ((x - 1) / Math.max(1, xMax - 1)) * plotW;
  const yScale = (y) =>
    padT +
    plotH -
    ((y - (yMin - yPad)) / (yMax + yPad - (yMin - yPad))) * plotH;

  const badgeSize = 16;
  const badgeOffset = 6;

  const badges = points
    .map((p) => {
      const tier = getRankTier(p.trueskill);
      const tierName = tier && tier.name ? tier.name.toLowerCase() : "unranked";
      const iconPath = `/icons/${tierName}.webp`;
      const cx = xScale(p.x);
      const cy = yScale(p.trueskill);
      const imgX = cx - badgeSize / 2;
      const imgY = cy - badgeSize - badgeOffset;

      return `
      <image href="${iconPath}" x="${imgX}" y="${imgY}" width="${badgeSize}" height="${badgeSize}">
        <title>${tier ? tier.name : "Unranked"} Rank</title>
      </image>`;
    })
    .join("");

  const trueskillPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x)} ${yScale(p.trueskill)}`)
    .join(" ");

  const outcomeColor = { win: "#2e7d32", loss: "#c62828" };
  const dots = points
    .map(
      (p) => `
    <circle cx="${xScale(p.x)}" cy="${yScale(p.trueskill)}" r="3.5" fill="${outcomeColor[p.outcome] || "#888"}">
    <title>${escapeHtml(`${p.year} ${p.tournament}${p.matchStage ? " (" + p.matchStage + ")" : ""} vs ${p.opponent}: ${p.outcome} (TrueSkill = ${p.trueskill}, μ=${p.mu}, σ=${p.sigma})`)}</title>
    </circle>`
    )
    .join("");

  const ticks = 4;
  const gridlines = Array.from({ length: ticks + 1 }, (_, i) => {
    const val = yMin - yPad + (yMax + yPad - (yMin - yPad)) * (i / ticks);
    const y = yScale(val);
    return `
      <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#eee" stroke-width="1" />
      <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${val.toFixed(1)}</text>`;
  }).join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" class="draft-scatter-svg">
      ${gridlines}
      <path d="${trueskillPath}" fill="none" stroke="#2b6cb0" stroke-width="2" />
      ${dots}
      ${badges}
      <text x="${padL}" y="${height - 6}" font-size="10" fill="#888">Game 1</text>
      <text x="${width - padR}" y="${height - 6}" text-anchor="end" font-size="10" fill="#888">Game ${xMax}</text>
    </svg>
    <div class="profile-chart-legend">
      <span><i style="background:#2b6cb0"></i> TrueSkill (skill estimate)</span>
      <span><i style="background:#2e7d32"></i> win</span>
      <span><i style="background:#c62828"></i> loss</span>
    </div>`;
}

function renderPlayerProfileContent(player) {
  const title = player?.group || player?.identityKey || "Player";
  const titleIdx = title.lastIndexOf("#");
  const titleHtml =
    titleIdx === -1
      ? escapeHtml(title)
      : `${escapeHtml(title.slice(0, titleIdx))}<br><span class="stat-formula">${escapeHtml(title.slice(titleIdx))}</span>`;

  const summaryRows = [
    `<div class="profile-summary">`,
    `<span><strong>${titleHtml}</strong></span>`,
    `<span>${player?.identified ? "Identified" : "Unidentified"}</span>`,
    player?.profileUrl
      ? `<a href="${escapeHtml(player.profileUrl)}" target="_blank" rel="noopener noreferrer">Open op.gg</a>`
      : "",
    `</div>`,
  ]
    .filter(Boolean)
    .join("");

  const statsRows = [
    `<div class="profile-summary">`,
    `<span>Games: ${player?.games ?? "–"}</span>`,
    `<span>Wins: ${player?.wins ?? "–"}</span>`,
    `<span>Losses: ${player?.losses ?? "–"}</span>`,
    `</div>`,
  ].join("");

  const ratingRows = [
    `<div class="profile-summary">`,
    `<span>TrueSkill: ${renderRankBadge(player.conservativeRating)} ${player?.conservativeRating ?? "–"} <span class="stat-formula">(μ ${player?.mu ?? "–"} − ${player?.conservativeK ?? 1}σ)</span></span>`,
    `<span>μ: ${player?.mu ?? "–"}</span>`,
    `<span>σ: ${player?.sigma ?? "–"}</span>`,
    `</div>`,
  ].join("");

  const history = player?.history || [];
  const historyRows = history
    .map((entry, idx) => {
      const outcomeClass =
        entry.outcome === "win"
          ? "outcome-win"
          : entry.outcome === "loss"
            ? "outcome-loss"
            : "outcome-draw";
      const rosterId = `roster-detail-${idx}`;

      const rosterList = (team) =>
        (team?.roster || [])
          .map(
            (m) =>
              `<li>${escapeHtml(m.displayName)} <span class="roster-rating">${renderTrueSkillValue(m.conservativeRating)}</span></li>`,
          )
          .join("");

      const changeClass =
        entry.ratingChange > 0
          ? "outcome-win"
          : entry.ratingChange < 0
            ? "outcome-loss"
            : "";
      const changeLabel = entry.ratingChange > 0 ? `+${entry.ratingChange}` : `${entry.ratingChange}`;

      return `<tr>
      <td><button class="roster-toggle" data-target="${rosterId}" aria-expanded="false">▶</button></td>
      <td>${escapeHtml(entry.year ?? "–")}</td>
      <td>${escapeHtml(entry.tournament || "–")}${entry.matchStage ? ` <span class="match-stage">(${escapeHtml(entry.matchStage)})</span>` : ""}</td>
      <td>${escapeHtml(entry.ownTeam?.name || "–")}</td>
      <td>${escapeHtml(entry.opponent || "–")}</td>
      <td class="${outcomeClass}">${escapeHtml(entry.outcome || "–")}</td>
      <td>${Math.round((entry.predictedWinProb ?? 0) * 100)}%</td>
      <td>${entry.ownTeam?.avgConservativeRating ?? "–"}</td>
      <td>${entry.opponentTeam?.avgConservativeRating ?? "–"}</td>
      <td>${renderTrueSkillValue(entry.conservativeRating)}</td>
      <td class="${changeClass}">${changeLabel}</td>
      <td>${entry.mu ?? "–"}</td>
      <td>${entry.sigma ?? "–"}</td>
    </tr>
    <tr id="${rosterId}" class="roster-detail-row" hidden>
      <td colspan="12">
        <div class="roster-detail">
          <div>
            <strong>${escapeHtml(entry.ownTeam?.name || "Your team")} - </strong> avg TrueSkill: ${entry.ownTeam?.avgConservativeRating ?? "–"} (${entry.ownTeam?.avgMu ?? "-"})
            <ul>${rosterList(entry.ownTeam)}</ul>
          </div>
          <div>
            <strong>${escapeHtml(entry.opponentTeam?.name || "Opponent")} - </strong> avg TrueSkill: ${entry.opponentTeam?.avgConservativeRating ?? "–"} (${entry.opponentTeam?.avgMu ?? "-"})
            <ul>${rosterList(entry.opponentTeam)}</ul>
          </div>
        </div>
      </td>
    </tr>`;
    })
    .join("");

  playerProfileTitle.textContent = title;
  return [
    summaryRows,
    statsRows,
    ratingRows,
    buildChartHtml(history),
    historyRows
      ? `<table class="profile-history-table"><thead><tr><th>Match Details</th><th>Year</th><th>Tournament</th><th>Captain</th><th>Opponent</th><th>Result</th><th>Pred. Win %</th><th>Your Team Avg</th><th>Opp Avg</th><th>TrueSkill</th><th>Change</th><th>μ</th><th>σ</th></tr></thead><tbody>${historyRows}</tbody></table>`
      : "<p>No match history available.</p>",
  ].join("");
}

export async function openPlayerProfile(identityKey) {
  if (!identityKey || !playerProfileModal) return;
  playerProfileModal.classList.add("open");
  playerProfileModal.setAttribute("aria-hidden", "false");
  playerProfileContent.innerHTML = "Loading…";

  try {
    const res = await fetch(`/api/player/${encodeURIComponent(identityKey)}`);
    if (!res.ok) throw new Error("Player profile not found");
    const player = await res.json();
    playerProfileContent.innerHTML = renderPlayerProfileContent(player);
  } catch (err) {
    playerProfileContent.innerHTML = `<p>${escapeHtml(err.message || "Unable to load player profile")}</p>`;
  }
}

export function initPlayerProfile() {
  playerProfileCloseBtn?.addEventListener("click", closePlayerProfile);
  playerProfileModal?.addEventListener("click", (event) => {
    if (
      event.target.classList.contains("player-profile-backdrop") ||
      event.target.dataset.close === "true"
    ) {
      closePlayerProfile();
    }
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest(".player-link[data-player-key]");
    if (!link) return;
    event.preventDefault();
    openPlayerProfile(link.dataset.playerKey);
  });

  document.addEventListener("click", (e) => {
    const toggle = e.target.closest(".roster-toggle");
    if (!toggle) return;
    const target = document.getElementById(toggle.dataset.target);
    if (!target) return;
    const isOpen = !target.hidden;
    target.hidden = isOpen;
    toggle.setAttribute("aria-expanded", String(!isOpen));
    toggle.textContent = isOpen ? "▶" : "▼";
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && playerProfileModal?.classList.contains("open")) {
      closePlayerProfile();
    }
  });
}
