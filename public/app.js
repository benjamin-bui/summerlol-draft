// ==================== Theme toggle ====================
// Dark is the original look; light is the new addition. Default follows
// the OS/browser color-scheme preference; an explicit manual choice
// (stored in localStorage) overrides that from then on. Applied
// immediately (not inside the async init below) so there's no flash of
// the wrong theme while data is still loading.

const THEME_STORAGE_KEY = "lol-draft-theme";
const themeToggleBtn = document.getElementById("themeToggle");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleBtn.textContent = theme === "light" ? "☀️" : "🌙";
}

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

(function initTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
    return;
  }
  // No explicit choice saved yet — follow the system preference.
  const prefersLight =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(prefersLight ? "light" : "dark");
})();

// If the user hasn't manually overridden the theme, keep following the
// system preference live (e.g. their OS switches at sunset).
if (window.matchMedia) {
  window
    .matchMedia("(prefers-color-scheme: light)")
    .addEventListener("change", (e) => {
      if (localStorage.getItem(THEME_STORAGE_KEY)) return; // manual override wins
      applyTheme(e.matches ? "light" : "dark");
    });
}

themeToggleBtn.addEventListener("click", () => {
  const next = currentTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  localStorage.setItem(THEME_STORAGE_KEY, next);
});

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Splits a "Name#Tag" style string into a bold name + muted tag
// subtitle. Falls back to showing the whole string as the name with no
// subtitle if there's no '#' to split on (unidentified/tagless names).
function renderNameWithTag(fullName) {
  const idx = fullName.lastIndexOf("#");
  if (idx === -1)
    return `<span class="player-name">${escapeHtml(fullName)}</span>`;
  const name = fullName.slice(0, idx);
  const tag = fullName.slice(idx);
  return `<span class="player-name">${escapeHtml(name)}</span><span class="player-tag">${escapeHtml(tag)}</span>`;
}
function renderPlayerCell(row) {
  const fullName = row.group || row.displayName || "";
  const identityKey = row.identityKey || row._playerIdentityKey || null;
  const nameHtml = renderNameWithTag(fullName);
  if (identityKey) {
    return `<a href="#" class="player-link" data-player-key="${escapeHtml(identityKey)}" title="View profile">${nameHtml}</a>`;
  }
  if (row.profileUrl) {
    return `<a href="${escapeHtml(row.profileUrl)}" target="_blank" rel="noopener noreferrer" class="player-link" title="View on op.gg">${nameHtml}</a>`;
  }
  return nameHtml;
}
// TrueSkill Fun Facts
function renderFunFactsHtml(ff) {
  if (!ff) return "";
  const pctRows = ff.staticCutoffs
    .map((p) => {
      const cutoffDisplay = Number.isFinite(p.ratingCutoff)
        ? p.ratingCutoff
        : "–";
      const badgeHtml = renderRankBadge(p.name);
      return `<tr><td class="rank-cell">${badgeHtml} <span>${escapeHtml(p.name)}</span></td><td>${p.percentile}%</td><td>${cutoffDisplay}</td></tr>`;
    })
    .join("");

  const facts = [];
  if (ff.biggestUpset) {
    const u = ff.biggestUpset;
    facts.push(
      `<strong>Biggest upset:</strong> ${escapeHtml(u.winnerName)} (avg ${u.winnerAvgBefore}) over ${escapeHtml(u.loserName)} (avg ${u.loserAvgBefore}) in ${u.tournament} ${u.year} - only a ${Math.round(u.predictedWinProbForWinner * 100)}% predicted chance. ${u.mvpName ? `${escapeHtml(u.mvpName)} swung ${u.mvpRatingChange > 0 ? "+" : ""}${u.mvpRatingChange} TrueSkill.` : ""}`,
    );
  }
  if (ff.longestStreak) {
    facts.push(
      `<strong>Longest win streak:</strong> ${escapeHtml(ff.longestStreak.displayName)}, ${ff.longestStreak.streak} games`,
    );
  }
  if (ff.longestLossStreak) {
    facts.push(
      `<strong>Longest losing streak:</strong> ${escapeHtml(ff.longestLossStreak.displayName)}, ${ff.longestLossStreak.streak} games`,
    );
  }
  if (ff.peakRating) {
    facts.push(
      `<strong>Highest TrueSkill ever reached:</strong> ${escapeHtml(ff.peakRating.displayName)}, ${ff.peakRating.conservativeRating} (${ff.peakRating.tournament} ${ff.peakRating.year})`,
    );
  }
  // if (ff.troughRating) {
  //   facts.push(`<strong>Lowest TrueSkill ever reached:</strong> ${escapeHtml(ff.troughRating.displayName)}, ${ff.troughRating.conservativeRating} (${ff.troughRating.tournament} ${ff.troughRating.year})`);
  // }
  if (ff.mostGamesPlayed) {
    facts.push(
      `<strong>Most games played:</strong> ${escapeHtml(ff.mostGamesPlayed.displayName)}, ${ff.mostGamesPlayed.games} games`,
    );
  }
  if (ff.mostActiveRivalry) {
    const r = ff.mostActiveRivalry;
    facts.push(
      `<strong>Most active rivalry:</strong> ${escapeHtml(r.teamAName)} vs ${escapeHtml(r.teamBName)}, ${r.gamesPlayed} games played (${r.teamAWins}-${r.teamBWins})`,
    );
  }
  if (ff.everMaster) {
    const playerList = ff.everMaster
      .map((p) => escapeHtml(p.group || p.displayName))
      .join(", ");
    facts.push(
      `<strong>Ever hit Master rank (${ff.everMaster.length}):</strong> ${playerList}`,
    );
  }

  return `
    <div class="fun-facts-box">
      <button class="fun-facts-toggle" aria-expanded="false">▶ Fun facts</button>
      <div class="fun-facts-body" hidden>
        <h4>TrueSkill percentile cutoffs (League of Legends rank equivalent)</h4>
        <table class="fun-facts-table"><thead><tr><th>Rank</th><th>Percentile</th><th>Rating cutoff</th></tr></thead>
          <tbody>${pctRows}</tbody></table>
        <ul class="fun-facts-list">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>
      </div>
    </div>`;
}

document.addEventListener("click", (e) => {
  const toggle = e.target.closest(".fun-facts-toggle");
  if (!toggle) return;
  const body = toggle.nextElementSibling;
  const isOpen = !body.hidden;
  body.hidden = isOpen;
  toggle.setAttribute("aria-expanded", String(!isOpen));
  toggle.textContent = (isOpen ? "▶" : "▼") + " Fun facts";
});
// Modal Player Profile
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
  const conservativeK = player?.conservativeK ?? 3;

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
      const changeLabel =
        entry.ratingChange > 0
          ? `+${entry.ratingChange}`
          : `${entry.ratingChange}`;

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

// Returns an inline SVG (as a string, to fit the innerHTML-based render
// above) plotting TrueSkill over each game in order.

function buildChartHtml(history) {
  if (!history.length) {
    return '<p class="profile-chart-empty">No games recorded yet.</p>';
  }

  const width = 900,
    height = 260,
    padL = 45,
    padR = 15,
    padT = 15,
    padB = 30;
  const plotW = width - padL - padR,
    plotH = height - padT - padB;

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

  const xScale = (x) => padL + ((x - 1) / Math.max(1, xMax - 1)) * plotW;
  const yScale = (y) =>
    padT +
    plotH -
    ((y - (yMin - yPad)) / (yMax + yPad - (yMin - yPad))) * plotH;

  const xMax = points.length;
  const yMin = Math.min(...points.map((p) => p.trueskill));
  const yMax = Math.max(...points.map((p) => p.trueskill));
  const yPad = (yMax - yMin) * 0.05 || 1;

  // Define size and spacing for the badges
  const badgeSize = 16;
  const badgeOffset = 6; // How many pixels above the dot the badge should float

  const badges = points
    .map((p) => {
      // Re-use your existing logic to determine the tier
      const tier = getRankTier(p.trueskill);
      const tierName = tier && tier.name ? tier.name.toLowerCase() : "unranked";
      const iconPath = `/icons/${tierName}.webp`;

      // Calculate center of the dot
      const cx = xScale(p.x);
      const cy = yScale(p.trueskill);

      // SVG <image> x/y coordinates map to the top-left corner of the image
      const imgX = cx - badgeSize / 2;
      const imgY = cy - badgeSize - badgeOffset;

      return `
      <image href="${iconPath}" x="${imgX}" y="${imgY}" width="${badgeSize}" height="${badgeSize}">
        <title>${tier ? tier.name : "Unranked"} Rank</title>
      </image>
    `;
    })
    .join("");

  const trueskillPath = points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x)} ${yScale(p.trueskill)}`,
    )
    .join(" ");

  const outcomeColor = { win: "#2e7d32", loss: "#c62828" };
  const dots = points
    .map(
      (p) => `
    <circle cx="${xScale(p.x)}" cy="${yScale(p.trueskill)}" r="3.5" fill="${outcomeColor[p.outcome] || "#888"}">
    <title>${escapeHtml(`${p.year} ${p.tournament}${p.matchStage ? " (" + p.matchStage + ")" : ""} vs ${p.opponent}: ${p.outcome} (TrueSkill = ${p.trueskill}, μ=${p.mu}, σ=${p.sigma})`)}</title>
    </circle>
  `,
    )
    .join("");

  const ticks = 4;
  const gridlines = Array.from({ length: ticks + 1 }, (_, i) => {
    const val = yMin - yPad + (yMax + yPad - (yMin - yPad)) * (i / ticks);
    const y = yScale(val);
    return `
      <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#eee" stroke-width="1" />
      <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${val.toFixed(1)}</text>
    `;
  }).join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" class="draft-scatter-svg">
      ${gridlines}
      <path d="${trueskillPath}" fill="none" stroke="#2b6cb0" stroke-width="2" />
      ${dots}
      ${badges} <!-- ADDED HERE -->
      <text x="${padL}" y="${height - 6}" font-size="10" fill="#888">Game 1</text>
      <text x="${width - padR}" y="${height - 6}" text-anchor="end" font-size="10" fill="#888">Game ${xMax}</text>
    </svg>
    <div class="profile-chart-legend">
      <span><i style="background:#2b6cb0"></i> TrueSkill (skill estimate)</span>
      <span><i style="background:#2e7d32"></i> win</span>
      <span><i style="background:#c62828"></i> loss</span>
    </div>
  `;
}

async function openPlayerProfile(identityKey) {
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

function renderPlayerCell(row) {
  const name = escapeHtml(row.group || row.displayName || "");
  const identityKey = row.identityKey || row._playerIdentityKey || null;
  if (identityKey) {
    return `<a href="#" class="player-link" data-player-key="${escapeHtml(identityKey)}">${name}</a>`;
  }
  if (row.profileUrl) {
    return `<a href="${escapeHtml(row.profileUrl)}" target="_blank" rel="noopener noreferrer" class="player-link" title="View on op.gg">${name}</a>`;
  }
  return name;
}

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

playerProfileCloseBtn?.addEventListener("click", closePlayerProfile);
playerProfileModal?.addEventListener("click", (event) => {
  if (
    event.target.classList.contains("player-profile-backdrop") ||
    event.target.dataset.close === "true"
  ) {
    closePlayerProfile();
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    playerProfileModal?.classList.contains("open")
  ) {
    closePlayerProfile();
  }
});

// ==================== Column configuration ====================

function formatCell(value, col) {
  if (value === null || value === undefined) return "–";
  if (col.type === "number" && typeof value === "number") {
    if (col.percentage) return (value * 100).toFixed(col.decimals) + "%";
    return value.toFixed(col.decimals);
  }
  return String(value);
}

// ==================== Generic sort helper ====================

function sortRows(rows, columns, sortColumn, sortDirection) {
  const col = columns.find((c) => c.key === sortColumn);
  const dir = sortDirection === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortColumn === "latestGameTournament") {
      const parseTournamentValue = (row) => {
        const raw = String(row.latestGameTournament || "").trim();
        const match = raw.match(/^(winter|summer)\s*(\d{4})?$/i);
        if (!match) return { year: 0, seasonRank: 2, raw };
        return {
          year: parseInt(match[2] || "0", 10),
          seasonRank: match[1].toLowerCase() === "winter" ? 0 : 1,
          raw,
        };
      };
      const av = parseTournamentValue(a);
      const bv = parseTournamentValue(b);
      if (av.year !== bv.year) return dir * (bv.year - av.year);
      if (av.seasonRank !== bv.seasonRank) return av.seasonRank - bv.seasonRank;
      return dir * String(av.raw).localeCompare(String(bv.raw));
    }

    const av =
      col && typeof col.sortValue === "function"
        ? col.sortValue(a)
        : a[sortColumn];
    const bv =
      col && typeof col.sortValue === "function"
        ? col.sortValue(b)
        : b[sortColumn];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "number" || typeof bv === "number") {
      return dir * (Number(av) - Number(bv));
    }
    if (col && col.type === "string")
      return dir * String(av).localeCompare(String(bv));
    if (typeof av === "string" || typeof bv === "string") {
      return dir * String(av).localeCompare(String(bv));
    }
    return dir * (av - bv);
  });
}

// ==================== Per-column filters (regex for strings, inequality for numbers) ====================
// filterState shape: { [colKey]: { type: 'regex', pattern } | { type: 'gt'|'lt', value } | { type: 'between', min, max } }

function rowPassesFilter(row, col, filter) {
  if (!filter) return true;
  const value = row[col.key];

  if (filter.type === "checkbox") {
    if (!filter.values || filter.values.length === 0) return true;
    return filter.values.includes(String(value ?? ""));
  }

  if (filter.type === "regex") {
    if (!filter.pattern) return true;
    try {
      const re = new RegExp(filter.pattern, "i");
      return re.test(String(value ?? ""));
    } catch {
      return true; // invalid regex already blocked at input time; fail open just in case
    }
  }
  // Numeric filters: a row with no value can't satisfy any comparison
  if (value === null || value === undefined || Number.isNaN(value))
    return false;

  if (filter.type === "gt")
    return filter.value !== null && value > filter.value;
  if (filter.type === "lt")
    return filter.value !== null && value < filter.value;
  if (filter.type === "between") {
    if (filter.min === null || filter.max === null) return true;
    return value >= filter.min && value <= filter.max;
  }
  return true;
}

function applyColumnFilters(rows, columns, filterState) {
  const activeCols = columns.filter((c) => filterState[c.key]);
  if (activeCols.length === 0) return rows;
  return rows.filter((row) =>
    activeCols.every((col) => rowPassesFilter(row, col, filterState[col.key])),
  );
}

// Builds the inner HTML for a column's filter popover, based on its type.
function filterPopoverInnerHTML(col, rows, filterState) {
  if (col.type === "string" && col.filterType === "checkbox") {
    const values = [
      ...new Set(
        rows
          .map((row) => row[col.key])
          .filter(
            (value) =>
              value !== null &&
              value !== undefined &&
              String(value).trim() !== "",
          ),
      ),
    ].map((value) => String(value));

    const orderedValues = values.sort((a, b) => {
      const parseTournamentValue = (value) => {
        const raw = String(value || "").trim();
        const match = raw.match(/^(winter|summer)\s*(\d{4})?$/i);
        if (!match) return { year: 0, seasonRank: 2, raw };
        return {
          year: parseInt(match[2] || "0", 10),
          seasonRank: match[1].toLowerCase() === "summer" ? 0 : 1,
          raw,
        };
      };
      const av = parseTournamentValue(a);
      const bv = parseTournamentValue(b);
      if (av.year !== bv.year) return bv.year - av.year;
      if (av.seasonRank !== bv.seasonRank) return av.seasonRank - bv.seasonRank;
      return String(av.raw).localeCompare(String(bv.raw));
    });

    const optionsHtml = orderedValues.length
      ? orderedValues
          .map((value) => {
            const checked = filterState[col.key]?.values?.includes(value)
              ? "checked"
              : "";
            return `<label class="filter-option"><input type="checkbox" class="filter-checkbox-option" value="${escapeHtml(value)}" ${checked} /> ${escapeHtml(value)}</label>`;
          })
          .join("")
      : '<div class="filter-empty">No values</div>';

    return `
      <label>Select values</label>
      <div class="filter-checkbox-list">${optionsHtml}</div>
      <div class="filter-popover-actions">
        <button type="button" class="filter-clear-btn">Clear</button>
      </div>`;
  }
  if (col.type === "string") {
    // Free-text/regex filter -- default for open-ended string columns
    // like Player, Captain, Team 1, Team 2, Result.
    const existing = filterState[col.key]?.pattern || "";
    return `
      <label>Filter (regex, case-insensitive)</label>
      <input type="text" class="filter-regex-input" placeholder="e.g. voidliss" value="${escapeHtml(existing)}" />
      <div class="filter-popover-actions">
        <button type="button" class="filter-clear-btn">Clear</button>
      </div>`;
  }
  const placeholder = col.percentage ? "e.g. 50 for 50%" : "value";
  const minPlaceholder = col.percentage ? "min %" : "min";
  const maxPlaceholder = col.percentage ? "max %" : "max";
  return `
    <label>Filter${col.percentage ? " (enter as a percentage, e.g. 50 for 50%)" : ""}</label>
    <select class="filter-op-select">
      <option value="gt">Greater than</option>
      <option value="lt">Less than</option>
      <option value="between">Between</option>
    </select>
    <div class="filter-value-single">
      <input type="number" step="any" class="filter-value-input" placeholder="${placeholder}" />
    </div>
    <div class="filter-value-between between-inputs hidden">
      <input type="number" step="any" class="filter-min-input" placeholder="${minPlaceholder}" />
      <input type="number" step="any" class="filter-max-input" placeholder="${maxPlaceholder}" />
    </div>
    <div class="filter-popover-actions">
      <button type="button" class="filter-clear-btn">Clear</button>
    </div>`;
}

// Wires up a single column's filter popover (already inserted into the DOM
// inside `th`). Calls onChange() whenever the filter state changes, which
// should re-render the table BODY only — never rebuild the header, or
// popovers lose focus/state mid-interaction.
function wireFilterPopover(
  th,
  col,
  popover,
  filterState,
  onChange,
  closeAllPopovers,
) {
  const icon = th.querySelector(".filter-icon");

  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = popover.classList.contains("hidden");
    closeAllPopovers();
    if (isHidden) {
      const rect = th.getBoundingClientRect();
      const popoverWidth = 240; // matches .filter-popover's min-width
      const clampedLeft = Math.min(
        rect.left,
        window.innerWidth - popoverWidth - 12,
      );
      popover.style.top = `${rect.bottom + 4}px`;
      popover.style.left = `${Math.max(8, clampedLeft)}px`;
      popover.classList.remove("hidden");
    }
  });
  popover.addEventListener("click", (e) => e.stopPropagation());

  function setActive(isActive) {
    icon.classList.toggle("active", isActive);
  }

  if (col.type === "string" && col.filterType === "checkbox") {
    const checkboxes = [...popover.querySelectorAll(".filter-checkbox-option")];
    const clearBtn = popover.querySelector(".filter-clear-btn");

    function updateFromCheckboxes() {
      const values = checkboxes
        .filter((box) => box.checked)
        .map((box) => box.value);
      if (values.length > 0) {
        filterState[col.key] = { type: "checkbox", values };
        setActive(true);
      } else {
        delete filterState[col.key];
        setActive(false);
      }
      onChange();
    }

    checkboxes.forEach((box) =>
      box.addEventListener("change", updateFromCheckboxes),
    );
    clearBtn.addEventListener("click", () => {
      checkboxes.forEach((box) => {
        box.checked = false;
      });
      delete filterState[col.key];
      setActive(false);
      onChange();
    });
  } else if (col.type === "string") {
    const input = popover.querySelector(".filter-regex-input");
    const clearBtn = popover.querySelector(".filter-clear-btn");

    function updateFromInput() {
      const pattern = input.value.trim();
      if (pattern === "") {
        delete filterState[col.key];
        setActive(false);
        input.classList.remove("invalid");
        onChange();
        return;
      }
      try {
        new RegExp(pattern, "i"); // validate before storing -- bad regex shouldn't silently filter everything out
        filterState[col.key] = { type: "regex", pattern };
        input.classList.remove("invalid");
        setActive(true);
      } catch {
        input.classList.add("invalid");
        // don't update filterState with an invalid pattern -- keep last-good filter active
      }
      onChange();
    }

    input.addEventListener("input", updateFromInput);
    clearBtn.addEventListener("click", () => {
      input.value = "";
      delete filterState[col.key];
      setActive(false);
      input.classList.remove("invalid");
      onChange();
    });
  } else {
    const opSelect = popover.querySelector(".filter-op-select");
    const singleWrap = popover.querySelector(".filter-value-single");
    const betweenWrap = popover.querySelector(".filter-value-between");
    const valueInput = popover.querySelector(".filter-value-input");
    const minInput = popover.querySelector(".filter-min-input");
    const maxInput = popover.querySelector(".filter-max-input");
    const clearBtn = popover.querySelector(".filter-clear-btn");

    function updateFromInputs() {
      // Percentage columns display value*100 with a "%" suffix, but the
      // underlying stored value (and what rowPassesFilter compares
      // against) is still the raw 0-1 fraction — so a value typed here
      // (in percentage terms, matching what's displayed) needs converting
      // back down before it's stored as a filter threshold.
      const scale = col.percentage ? 0.01 : 1;
      const op = opSelect.value;
      if (op === "between") {
        const min =
          minInput.value === "" ? null : parseFloat(minInput.value) * scale;
        const max =
          maxInput.value === "" ? null : parseFloat(maxInput.value) * scale;
        if (min !== null && max !== null) {
          filterState[col.key] = { type: "between", min, max };
          setActive(true);
        } else {
          delete filterState[col.key];
          setActive(false);
        }
      } else {
        const val =
          valueInput.value === "" ? null : parseFloat(valueInput.value) * scale;
        if (val !== null) {
          filterState[col.key] = { type: op, value: val };
          setActive(true);
        } else {
          delete filterState[col.key];
          setActive(false);
        }
      }
      onChange();
    }

    opSelect.addEventListener("change", () => {
      const isBetween = opSelect.value === "between";
      singleWrap.classList.toggle("hidden", isBetween);
      betweenWrap.classList.toggle("hidden", !isBetween);
      updateFromInputs();
    });
    valueInput.addEventListener("input", updateFromInputs);
    minInput.addEventListener("input", updateFromInputs);
    maxInput.addEventListener("input", updateFromInputs);
    clearBtn.addEventListener("click", () => {
      valueInput.value = "";
      minInput.value = "";
      maxInput.value = "";
      opSelect.value = "gt";
      singleWrap.classList.remove("hidden");
      betweenWrap.classList.add("hidden");
      delete filterState[col.key];
      setActive(false);
      onChange();
    });
  }
}

// Tracks all open popovers across both tables so opening one can close
// the rest, and clicking anywhere outside closes whatever's open. Also
// used to clean up stale popovers by "owner" (rankings/raw) when a
// header gets rebuilt, since portaled popovers are no longer removed
// automatically by clearing the header row's innerHTML.
const allPopovers = [];
document.addEventListener("click", () => {
  allPopovers.forEach((p) => p.classList.add("hidden"));
});
// Popovers escape the table's overflow box via fixed positioning (see
// wireFilterPopover), but that means scrolling anywhere would leave one
// open in the wrong spot if we didn't also close it — closing on any
// scroll is simpler and more robust than continuously repositioning.
// Capture:true is required since scroll events don't bubble, but they
// are still observable during the capture phase.
window.addEventListener(
  "scroll",
  () => allPopovers.forEach((p) => p.classList.add("hidden")),
  true,
);

function closeAllPopovers() {
  allPopovers.forEach((p) => p.classList.add("hidden"));
}

function removePopoversOwnedBy(owner) {
  for (let i = allPopovers.length - 1; i >= 0; i--) {
    if (allPopovers[i].dataset.owner === owner) {
      allPopovers[i].remove();
      allPopovers.splice(i, 1);
    }
  }
}

// Builds a full <th> element for one column, including sort click
// handling and (if filterable) a filter icon + popover. `owner` tags the
// popover so removePopoversOwnedBy() can clean up stale ones when this
// table's header gets rebuilt (e.g. on a column-visibility change).
function buildHeaderCell(
  col,
  sortColumn,
  sortDirection,
  filterState,
  onFilterChange,
  owner,
  rows,
) {
  const th = document.createElement("th");
  th.dataset.sort = col.key;
  if (!col.sortable) th.classList.add("not-sortable");
  if (col.key === sortColumn)
    th.classList.add(sortDirection === "asc" ? "sorted-asc" : "sorted-desc");

  const labelSpan = document.createElement("span");
  labelSpan.textContent = col.label;
  th.appendChild(labelSpan);

  if (col.filterable !== false) {
    const icon = document.createElement("span");
    icon.className = "filter-icon";
    icon.textContent = "▾";
    if (filterState[col.key]) icon.classList.add("active");
    th.appendChild(icon);

    // Appended to document.body (not `th`) and positioned `fixed` so it
    // escapes the table container's overflow clipping entirely — see the
    // comment in wireFilterPopover for why that clipping happens.
    const popover = document.createElement("div");
    popover.className = "filter-popover hidden";
    popover.dataset.owner = owner;
    popover.innerHTML = filterPopoverInnerHTML(col, rows, filterState);
    document.body.appendChild(popover);
    allPopovers.push(popover);

    wireFilterPopover(
      th,
      col,
      popover,
      filterState,
      onFilterChange,
      closeAllPopovers,
    );
  }

  return th;
}

// Freezes contiguous run of columns flagged `sticky: true`
function applyStickyColumns(
  headerRowEl,
  bodyEl,
  visibleColumns,
  hasToggleCol = false,
) {
  const runStart = visibleColumns.findIndex((c) => c.sticky);
  if (runStart === -1) return;

  let runEnd = runStart;
  while (
    runEnd + 1 < visibleColumns.length &&
    visibleColumns[runEnd + 1].sticky
  ) {
    runEnd++;
  }

  const headerCells = [...headerRowEl.children];
  const domOffset = hasToggleCol ? 1 : 0;
  // Toggle column is only pinned when the sticky run itself starts at
  // column 0 -- otherwise it's just another leading non-sticky column
  // that scrolls away normally, same as any other.
  const toggleIsSticky = hasToggleCol && runStart === 0;

  // The sticky run ALWAYS docks flush at the container's true left edge
  // (left: 0px for the first column in the run) -- non-sticky leading
  // columns scroll fully away and get clipped by overflow-x, they never
  // contribute any offset to where the run pins.
  let cumulativeLeft = 0;
  if (toggleIsSticky && headerCells[0]) {
    headerCells[0].classList.add("sticky-col");
    headerCells[0].style.left = "0px";
    cumulativeLeft = headerCells[0].getBoundingClientRect().width;
  }

  for (let i = runStart; i <= runEnd; i++) {
    const th = headerCells[i + domOffset];
    if (!th) continue;
    th.classList.add("sticky-col");
    if (i === runEnd) th.classList.add("sticky-col-last");
    th.style.left = `${cumulativeLeft}px`;
    cumulativeLeft += th.getBoundingClientRect().width;
  }

  [...bodyEl.children].forEach((tr) => {
    if (tr.classList.contains("roster-detail-row")) return;
    const cells = [...tr.children];
    let left = 0;
    if (toggleIsSticky && cells[0]) {
      cells[0].classList.add("sticky-col");
      cells[0].style.left = "0px";
      left = cells[0].getBoundingClientRect().width;
    }
    for (let i = runStart; i <= runEnd; i++) {
      const td = cells[i + domOffset];
      if (!td) continue;
      td.classList.add("sticky-col");
      if (i === runEnd) td.classList.add("sticky-col-last");
      td.style.left = `${left}px`;
      left += td.getBoundingClientRect().width;
    }
  });
}

// ==================== Tabs ====================

const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

function setActiveTab(tabName) {
  tabButtons.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.tab === tabName),
  );
  tabPanels.forEach((panel) =>
    panel.classList.toggle("active", panel.id === `tab-${tabName}`),
  );
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveTab(btn.dataset.tab);
    scheduleUrlUpdate();
  });
});

// Converts every value in a genuinely-numeric column from string to a
// real JS number, once, right when the raw data loads. Fixes two bugs at
// the source rather than patching symptoms: sortRows' numeric path was
// only ever reached when typeof already said "number" — since every raw
// value arrives as a string from SQLite/CSV, that check silently always
// fell through to string comparison ("1", "10", "2"... instead of
// 1, 2, 10...). Same root cause would eventually bite the gt/lt/between
// filters too. Checking ALL rows (not just the first) also avoids
// misclassifying a column when just the first row happens to be blank
// or coincidentally numeric-looking.
function coerceNumericColumns(columns, rows) {
  columns.forEach((colName) => {
    let sawValue = false;
    const allNumericOrBlank = rows.every((row) => {
      const val = row[colName];
      if (val === null || val === undefined || val === "") return true;
      sawValue = true;
      return !Number.isNaN(parseFloat(val)) && String(val).trim() !== "";
    });

    if (allNumericOrBlank && sawValue) {
      rows.forEach((row) => {
        const val = row[colName];
        row[colName] =
          val === null || val === undefined || val === ""
            ? null
            : parseFloat(val);
      });
    }
  });
}

// ==================== Reusable sortable/filterable/column-toggleable table ====================
// Starting point for any future tab that's basically "a table of players/rows
// with some computed metric" — which is most of what this app is.
// Rankings and Raw Data predate this and aren't using it (they have
// some tab-specific quirks — Rankings' derived Est. Order columns,
// Raw Data's dynamic per-dataset column discovery — that made retrofitting
// riskier than it was worth for two already-working tabs), but there's
// no reason a new one couldn't.
//
// Usage:
//   const table = createTabTable({
//     columns: [...],              // same column-def shape used throughout this file
//     headerRowEl, bodyEl,          // <tr> inside <thead>, <tbody> element
//     columnsBtnEl, columnsPanelEl, // the Columns ▾ button + its dropdown container
//     ownerKey: 'someUniqueName',   // tags this table's popovers for cleanup — must be
//                                   // unique across every table on the page
//     defaultSortColumn: 'someKey',
//     emptyMessage: 'optional custom empty-state text'
//   });
//   table.setData(arrayOfRowObjects); // replaces data, re-sorts/filters/renders
function createTabTable({
  columns,
  headerRowEl,
  bodyEl,
  columnsBtnEl,
  columnsPanelEl,
  ownerKey,
  defaultSortColumn,
  defaultSortDirection = "desc",
  emptyMessage = "No rows match the active filters",
  expandable,
}) {
  const state = {
    data: [],
    sortColumn: defaultSortColumn,
    sortDirection: defaultSortDirection,
    hiddenColumns: new Set(
      columns.filter((c) => c.defaultHidden).map((c) => c.key),
    ),
    filters: {},
    externalFilter: null,
  };

  columns
    .filter((c) => c.hideable)
    .forEach((col) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !state.hiddenColumns.has(col.key);
      checkbox.dataset.col = col.key;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.hiddenColumns.delete(col.key);
        else state.hiddenColumns.add(col.key);
        rebuildHeader();
        renderBody();
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(col.label));
      columnsPanelEl.appendChild(label);
    });

  columnsBtnEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = columnsPanelEl.classList.contains("hidden");
    closeAllPopovers();
    columnsPanelEl.classList.toggle("hidden");
    if (isHidden) columnsPanelEl.classList.remove("hidden");
  });
  columnsPanelEl.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () =>
    columnsPanelEl.classList.add("hidden"),
  );

  function visibleColumns() {
    return columns.filter((c) => !state.hiddenColumns.has(c.key));
  }

  function updateSortIndicators() {
    [...headerRowEl.children].forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === state.sortColumn) {
        th.classList.add(
          state.sortDirection === "asc" ? "sorted-asc" : "sorted-desc",
        );
      }
    });
  }

  function rebuildHeader() {
    removePopoversOwnedBy(ownerKey);
    headerRowEl.innerHTML = "";
    if (expandable) {
      const toggleTh = document.createElement("th");
      toggleTh.classList.add("not-sortable");
      headerRowEl.appendChild(toggleTh);
    }
    visibleColumns().forEach((col) => {
      const th = buildHeaderCell(
        col,
        state.sortColumn,
        state.sortDirection,
        state.filters,
        () => {
          renderBody();
        },
        ownerKey,
        state.data,
      );
      th.addEventListener("click", () => {
        if (!col.sortable) return;
        if (state.sortColumn === col.key) {
          state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
        } else {
          state.sortColumn = col.key;
          state.sortDirection = col.key === "group" ? "asc" : "desc";
        }
        updateSortIndicators();
        renderBody();
      });
      headerRowEl.appendChild(th);
    });
    refreshStickyColumns();
  }

  function renderBody() {
    const cols = visibleColumns();
    const colspan = cols.length + (expandable ? 1 : 0);
    let filtered = applyColumnFilters(state.data, columns, state.filters);
    if (state.externalFilter) filtered = filtered.filter(state.externalFilter);
    const sorted = sortRows(
      filtered,
      columns,
      state.sortColumn,
      state.sortDirection,
    );

    if (sorted.length === 0) {
      bodyEl.innerHTML = `<tr><td colspan="${colspan}" class="empty">${escapeHtml(emptyMessage)}</td></tr>`;
      return;
    }

    bodyEl.innerHTML = sorted
      .map((row, i) => {
        const cells = cols
          .map((col) => {
            if (col.playerLink || col.key === "group") {
              const playerRow = col.playerLink
                ? {
                    group: row[col.key],
                    profileUrl: row._playerProfileUrl,
                    identityKey: row._playerIdentityKey,
                  }
                : row;
              return `<td class="group-name">${renderPlayerCell(playerRow)}</td>`;
            }
            const val = col.key === "rank" ? i + 1 : row[col.key];
            const cls = col.className
              ? ` class="${col.className}"`
              : col.key === "rank"
                ? ' class="rank"'
                : "";
            if (col.render) return `<td${cls}>${col.render(val, row)}</td>`;
            return `<td${cls}>${escapeHtml(formatCell(val, col))}</td>`;
          })
          .join("");

        if (!expandable) return `<tr>${cells}</tr>`;

        const detailId = `${ownerKey}-detail-${i}`;
        return `<tr>
          <td><button class="roster-toggle" data-target="${detailId}" aria-expanded="false">▶</button></td>
          ${cells}
        </tr>
        <tr id="${detailId}" class="roster-detail-row" hidden>
          <td colspan="${colspan}">${expandable.getDetailHtml(row)}</td>
        </tr>`;
      })
      .join("");
    refreshStickyColumns();
  }
  function refreshStickyColumns() {
    applyStickyColumns(headerRowEl, bodyEl, visibleColumns(), !!expandable);
  }
  rebuildHeader(); // header only depends on columns/hidden-state, safe to build immediately

  return {
    setData(newData) {
      state.data = newData;
      rebuildHeader();
      renderBody();
    },
    setExternalFilter(predicateFn) {
      state.externalFilter = predicateFn; // pass null to clear
      renderBody();
    },
  };
}
// Splits pasted/uploaded text into individual name strings -- accepts
// newline-separated (a column pasted straight from Excel/Sheets) or
// comma-separated (a single CSV row/column), trims blank entries either
// way.
function parseNameList(text) {
  return text
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Identifies player list for each tournament
function seasonRankLocal(tournament) {
  const t = String(tournament || "")
    .trim()
    .toLowerCase();
  if (t === "winter") return 0;
  if (t === "summer") return 1;
  return 2;
}

function buildPastDraftOptions(optgroupEl) {
  optgroupEl.innerHTML = "";
  if (!latestTrueskillPlayers) return;
  const combos = new Set();
  latestTrueskillPlayers.forEach((p) => {
    (p.history || []).forEach((h) => combos.add(`${h.year}::${h.tournament}`));
  });
  [...combos]
    .sort((a, b) => {
      const [ay, at] = a.split("::"),
        [by, bt] = b.split("::");
      if (ay !== by) return by - ay;
      return seasonRankLocal(at) - seasonRankLocal(bt);
    })
    .forEach((combo) => {
      const [year, tournament] = combo.split("::");
      const opt = document.createElement("option");
      opt.value = `past::${combo}`;
      opt.textContent = `${tournament} ${year}`;
      optgroupEl.appendChild(opt);
    });
}

async function buildAdminPresetOptions(optgroupEl) {
  optgroupEl.innerHTML = "";
  try {
    const res = await fetch("/api/presets");
    const data = await res.json();
    data.presets.forEach((preset) => {
      const opt = document.createElement("option");
      opt.value = `admin::${preset.id}`;
      opt.textContent = preset.label;
      optgroupEl.appendChild(opt);
    });
  } catch (err) {
    /* no presets dir yet */
  }
}
// Everyone (captains + players) with at least one recorded game that
// year+tournament -- since captains are always force-included on their
// own roster and always play, this naturally covers both.
function namesForPastDraft(year, tournament) {
  const names = new Set();
  (latestTrueskillPlayers || []).forEach((p) => {
    const played = (p.history || []).some(
      (h) => String(h.year) === String(year) && h.tournament === tournament,
    );
    if (played) names.add(p.group);
  });
  return [...names];
}
function namesForPastDraftCaptains(year, tournament) {
  const captainNames = new Set();
  (latestTrueskillPlayers || []).forEach((p) => {
    (p.history || []).forEach((h) => {
      if (
        String(h.year) === String(year) &&
        h.tournament === tournament &&
        h.ownTeam?.name
      ) {
        captainNames.add(h.ownTeam.name);
      }
    });
  });
  return [...captainNames];
}
// Matches loosely against BOTH the resolved display name and the raw
// identityKey -- a pasted roster might use the exact in-game name
// (which could still be an unresolved identityKey if that player was
// never matched to a Riot account) or the resolved display name. Case
// and surrounding whitespace are ignored; this is intentionally an
// EXACT match otherwise (no partial/fuzzy matching), since a substring
// match risks silently pulling in the wrong player on a short name.
function buildNameMatcher(names) {
  const normalized = new Set(names.map((n) => n.trim().toLowerCase()));
  const bareNameOf = (s) => {
    const idx = s.lastIndexOf("#");
    return (idx === -1 ? s : s.slice(0, idx)).trim().toLowerCase();
  };
  return {
    matches(player) {
      const candidates = [player.group, player.identityKey].filter(Boolean);
      return candidates.some(
        (c) =>
          normalized.has(c.trim().toLowerCase()) ||
          normalized.has(bareNameOf(c)),
      );
    },
    checkCoverage(players) {
      const matchedNames = new Set();
      players.forEach((p) => {
        [p.group, p.identityKey].filter(Boolean).forEach((s) => {
          const norm = s.trim().toLowerCase();
          if (normalized.has(norm)) matchedNames.add(norm);
        });
      });
      const unmatched = [...normalized].filter((n) => !matchedNames.has(n));
      return {
        matchedCount: matchedNames.size,
        totalCount: normalized.size,
        unmatched,
      };
    },
  };
}

function applyNameFilter(rawText) {
  const names = parseNameList(rawText);
  const summaryEl = document.getElementById("nameFilterSummary");

  if (names.length === 0) {
    trueskillTable.setExternalFilter(null);
    summaryEl.textContent = "";
    return;
  }

  const matcher = buildNameMatcher(names);
  const playersForCoverageCheck = latestTrueskillPlayers || [];
  const { matchedCount, totalCount, unmatched } = matcher.checkCoverage(
    playersForCoverageCheck,
  );

  trueskillTable.setExternalFilter((row) => matcher.matches(row));

  summaryEl.textContent = unmatched.length
    ? `Matched ${matchedCount}/${totalCount}. Unmatched: ${unmatched.join(", ")}`
    : `Matched all ${matchedCount} names.`;
  summaryEl.className = unmatched.length
    ? "name-filter-summary has-misses"
    : "name-filter-summary";
}

document.getElementById("nameFilterApplyBtn").addEventListener("click", () => {
  const text = document.getElementById("nameFilterInput").value;
  applyNameFilter(text);
});

document.getElementById("nameFilterClearBtn").addEventListener("click", () => {
  document.getElementById("nameFilterInput").value = "";
  document.getElementById("nameFilterFile").value = "";
  trueskillTable.setExternalFilter(null);
  document.getElementById("nameFilterSummary").textContent = "";
});

document
  .getElementById("nameFilterFile")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    document.getElementById("nameFilterInput").value = text; // mirror into the textarea so it's visible/editable
    applyNameFilter(text);
  });

// ====================Rank Tier====================
// Determines categorical rank from numeric TrueSKill and displays corresponding icon
let globalRankTiers = null;

function getRankTier(rating) {
  if (rating === null || rating === undefined || Number.isNaN(rating))
    return null;
  if (!globalRankTiers || globalRankTiers.length === 0) return null;

  const tier = globalRankTiers.find((t) => rating >= t.ratingCutoff);

  return tier || { name: "Iron", ratingCutoff: 0 };
}

function renderRankBadge(input) {
  let tierName = "unranked";
  let displayName = "Unranked";

  if (typeof input === "string") {
    // Passed a tier name directly (e.g. 'Iron', 'Master')
    tierName = input.toLowerCase();
    displayName = input;
  } else if (typeof input === "object" && input?.name) {
    // Passed a tier object directly (e.g. { name: 'Iron' })
    tierName = input.name.toLowerCase();
    displayName = input.name;
  } else if (typeof input === "number" && !Number.isNaN(input)) {
    // Passed a numeric rating (e.g. 1050)
    const tier = getRankTier(input);
    tierName = tier.name.toLowerCase();
    displayName = tier?.name || "Unranked";
  }

  return `<img src="/icons/${tierName}.webp" alt="${escapeHtml(displayName)} rank badge" class="rank-badge" />`;
}

// Combines the badge with the formatted number -- used anywhere a raw
// TrueSkill/conservativeRating value is displayed.
function renderTrueSkillValue(rating, mu) {
  if (rating === null || rating === undefined) return "–";

  const formatRating = (n) =>
    `<span class="rating-number">${Math.round(n)}</span>`;

  if (mu === null || mu === undefined || isNaN(mu)) {
    return `<span class="trueskill-cell">${renderRankBadge(rating)}${formatRating(rating)}</span>`;
  }
  return `<span class="trueskill-cell">${renderRankBadge(rating)}${formatRating(rating)} (${formatRating(mu)})</span>`;
}

// Works on other league of legends api derived rank
function renderSoloQueueRank(rank) {
  if (!rank || !rank.tier || rank.tier === "UNRANKED") return ""
  const tierName = rank.tier.toLowerCase();
  const isApex = ["CHALLENGER", "GRANDMASTER", "MASTER"].includes(
    rank.tier.toUpperCase(),
  );
  const divisionPart = isApex ? " " : ` ${rank.division}`;

  return `<span class="trueskill-cell">${renderRankBadge(tierName)} ${divisionPart} · ${rank.leaguePoints} LP</span>`;
}
const RANK_TIER_ORDER = [
  "CHALLENGER",
  "GRANDMASTER",
  "MASTER",
  "DIAMOND",
  "EMERALD",
  "PLATINUM",
  "GOLD",
  "SILVER",
  "BRONZE",
  "IRON",
];
const DIVISION_ORDER = { I: 0, II: 1, III: 2, IV: 3 };

function soloQueueSortValueClient(rank) {
  if (!rank || !rank.tier || rank.tier === "UNRANKED") return -1;
  const tierIdx = RANK_TIER_ORDER.indexOf(rank.tier.toUpperCase());
  const divIdx = DIVISION_ORDER[rank.division] ?? 4;
  return (
    (RANK_TIER_ORDER.length - tierIdx) * 10000 -
    divIdx * 100 +
    (rank.leaguePoints || 0)
  );
}
// ==================== trueskill tab ====================

const TRUESKILL_COLUMNS = [
  {
    key: "rank",
    label: "#",
    sortable: false,
    hideable: false,
    filterable: false,
  },
  {
    key: "group",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    className: "group-name",
    type: "string",
    sticky: true,
  },
  {
    key: "latestGameTournament",
    label: "Latest Tournament",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => {
      const raw = String(row.latestGameTournament || "").trim();
      const match = raw.match(/^(winter|summer)\s*(\d{4})?$/i);
      if (!match) return 2_000_000;
      const seasonRank = match[1].toLowerCase() === "summer" ? 0 : 1;
      const year = parseInt(match[2] || "0", 10);
      return seasonRank * 1_000_000 + year;
    },
  },
  {
    key: "conservativeRating",
    label: "TrueSkill",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
    render: renderTrueSkillValue,
  },
  {
    key: "soloQueueRank",
    label: "Solo Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => soloQueueSortValueClient(row.soloQueueRank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "flexQueueRank",
    label: "Flex Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => soloQueueSortValueClient(row.flexQueueRank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "premade5x5Rank",
    label: "5x5 Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    defaultHidden: true,
    sortValue: (row) => soloQueueSortValueClient(row.premade5x5Rank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "mu",
    label: "μ",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
    defaultHidden: true,
  },
  {
    key: "sigma",
    label: "σ",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
  },
  {
    key: "games",
    label: "Games",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "tournaments",
    label: "Tournaments",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "wins",
    label: "Wins",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "losses",
    label: "Losses",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "winrate",
    label: "Win Rate %",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    sortValue: (row) => {
      if (!row.games || row.games === 0) return 0;
      return row.wins / row.games;
    },
    render: (val, row) => {
      const games = row.games || 0;
      const wins = row.wins || 0;
      if (games === 0) return "0.0%";
      return ((wins / games) * 100).toFixed(1) + "%";
    },
  },
];

const trueskillTable = createTabTable({
  columns: TRUESKILL_COLUMNS,
  headerRowEl: document.getElementById("trueskillHeaderRow"),
  bodyEl: document.getElementById("trueskillBody"),
  columnsBtnEl: document.getElementById("trueskillColumnsBtn"),
  columnsPanelEl: document.getElementById("trueskillColumnsPanel"),
  ownerKey: "trueskill",
  defaultSortColumn: "conservativeRating",
});

let trueskillLoaded = false;
let latestTrueskillPlayers = [];

async function loadtrueskillData(forceRefresh) {
  if (trueskillLoaded && !forceRefresh) return;
  const res = await fetch(`/api/trueskill`);
  const data = await res.json();
  latestTrueskillPlayers = data.players;
  buildPastDraftOptions(document.getElementById("pastDraftsOptgroup"));
  globalRankTiers = data.funFacts.staticCutoffs;
  document.getElementById("trueskill-fun-facts").innerHTML = renderFunFactsHtml(
    data.funFacts,
  );
  trueskillTable.setData(data.players);
  trueskillLoaded = true;
}

document
  .getElementById("nameFilterPresetSelect")
  .addEventListener("change", async (e) => {
    const val = e.target.value;
    if (!val) return;
    const textarea = document.getElementById("nameFilterInput");

    if (val.startsWith("past::")) {
      const [, year, tournament] = val.split("::");
      textarea.value = namesForPastDraft(year, tournament).join("\n");
    } else if (val.startsWith("admin::")) {
      const id = val.slice("admin::".length);
      const res = await fetch(`/api/presets/${encodeURIComponent(id)}`);
      const data = await res.json();
      textarea.value = data.names.join("\n");
    }
    applyNameFilter(textarea.value);
    e.target.value = "";
  });

buildAdminPresetOptions(document.getElementById("adminPresetsOptgroup"));

// ==================== Naive Pick Order vs Results ====================

let totalN = 40;
const totalNInput = document.getElementById("totalN");

totalNInput.addEventListener("input", () => {
  const val = parseInt(totalNInput.value, 10);
  if (!Number.isFinite(val) || val < 2) return;
  totalN = val;
  applyTotalN();
  rankingsTable.setData(latestStats);
});
const RANKINGS_COLUMNS = [
  {
    key: "rank",
    label: "#",
    sortable: false,
    hideable: false,
    filterable: false,
  },
  {
    key: "group",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    className: "group-name",
    type: "string",
    sticky: "true",
  },
  {
    key: "adjAvg",
    label: "Adjusted Pick Value",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
  },
  {
    key: "n",
    label: "n",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "mean",
    label: "Unadjusted Pick Value",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    defaultHidden: true,
  },
  {
    key: "sd",
    label: "Std. Dev.",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    defaultHidden: true,
  },
  {
    key: "avgPickPercentile",
    label: "Avg. Pick %",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    percentage: true,
  },
  {
    key: "estPickOrder",
    label: "Est. Pick Order",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 1,
  },
  {
    key: "avgRankPercentile",
    label: "Avg. Rank %",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    percentage: true,
  },
  {
    key: "estRankOrder",
    label: "Est. Rank Order",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 1,
  },
];

const rankingsTable = createTabTable({
  columns: RANKINGS_COLUMNS,
  headerRowEl: statsHeaderRow,
  bodyEl: statsBody,
  columnsBtnEl: columnsBtn,
  columnsPanelEl: columnsPanel,
  ownerKey: "rankings",
  defaultSortColumn: "adjAvg",
  emptyMessage: "No players match the active filters",
});

const RANKINGS_RISK = 0.25;
const RANKINGS_HALF_LIFE = 2;
async function fetchStats(risk, halfLife) {
  const res = await fetch(`/api/stats?risk=${risk}&halfLife=${halfLife}`);
  if (!res.ok) {
    statsBody.innerHTML = `<tr><td colspan="8">Error loading stats</td></tr>`;
    return;
  }
  const data = await res.json();
  latestStats = data.stats;
  applyTotalN();
  rankingsTable.setData(latestStats);
}

// Translates each row's percentile columns into an estimated ordinal
// position on a scale of `totalN` — e.g. "if this were a league of N
// picks/captains, what pick/rank number does this percentile correspond
// to". Purely a client-side transform of already-fetched percentiles, so
// changing N just re-renders, no server round-trip needed.
function applyTotalN() {
  // Est. Pick Order scales against N (total picks). Est. Rank Order
  // scales against N/4 instead — N/4 is the actual number of teams,
  // since each team gets 4 picks in this draft format, and Rank
  // Percentile was always normalized against the team count, not the
  // pick count (see server.js's per-year normalization).
  const numTeams = totalN / 4;
  latestStats.forEach((row) => {
    row.estPickOrder =
      row.avgPickPercentile === null
        ? null
        : row.avgPickPercentile * (totalN - 1) + 1;
    row.estRankOrder =
      row.avgRankPercentile === null
        ? null
        : row.avgRankPercentile * (numTeams - 1) + 1;
  });
}
// ==================== Draft IQ tab ====================

const DRAFT_IQ_COLUMNS = [
  {
    key: "rank",
    label: "#",
    sortable: false,
    hideable: false,
    filterable: false,
  },
  {
    key: "captain",
    label: "Captain",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    className: "group-name",
    sticky: true,
    render: (val, row) => row.captainDisplay,
  },
  {
    key: "avgDraftValue",
    label: "Draft IQ (avg value)",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
  },
  {
    key: "picksEvaluated",
    label: "Picks Evaluated",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "bestPickLabel",
    label: "Best Pick",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.bestPick?.value ?? -Infinity,
    render: (val) => val,
  },
  {
    key: "worstPickLabel",
    label: "Worst Pick",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.worstPick?.value ?? -Infinity,
    render: (val) => val,
  },
  {
    key: "bestPickLeavingLabel",
    label: "Best Pick (Leaving)",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.bestPickLeaving?.value ?? -Infinity,
    render: (val) => val,
  },
  {
    key: "worstPickLeavingLabel",
    label: "Worst Pick (Leaving)",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.worstPickLeaving?.value ?? -Infinity,
    render: (val) => val,
  },
];

const draftIQTable = createTabTable({
  columns: DRAFT_IQ_COLUMNS,
  headerRowEl: document.getElementById("draftIQHeaderRow"),
  bodyEl: document.getElementById("draftIQBody"),
  columnsBtnEl: document.getElementById("draftIQColumnsBtn"),
  columnsPanelEl: document.getElementById("draftIQColumnsPanel"),
  ownerKey: "draftiq",
  defaultSortColumn: "avgDraftValue",
  emptyMessage: "No draft data available",
});

function openCaptainDraftHistory(captainName) {
  if (!latestDraftAnalysis) return;
  const picks = latestDraftAnalysis.picks.filter(
    (p) => p.captain === captainName,
  );
  const byTournament = new Map();
  for (const p of picks) {
    const key = `${p.year}::${p.tournament}`;
    if (!byTournament.has(key)) byTournament.set(key, []);
    byTournament.get(key).push(p);
  }

  const sections = [...byTournament.entries()]
    .sort((a, b) => {
      const [ay, at] = a[0].split("::");
      const [by, bt] = b[0].split("::");
      if (ay !== by) return by - ay;
      return at.localeCompare(bt);
    })
    .map(([key, tournamentPicks]) => {
      const [year, tournament] = key.split("::");
      const teamBalance = latestDraftAnalysis.teamBalance.find(
        (t) =>
          t.captain === captainName &&
          t.tournament === tournament &&
          Number(t.year) === Number(year),
      );
      const avgValue = round1(
        tournamentPicks.reduce((s, p) => s + p.value, 0) /
          tournamentPicks.length,
      );

      // Leaving/hindsight average -- only over picks that actually have a
      // leavingValue (a player who never played a game has none), same
      // guard as the main-table best/worst-leaving aggregation.
      const withLeaving = tournamentPicks.filter(
        (p) => p.leavingValue !== null,
      );
      const avgLeavingValue = withLeaving.length
        ? round1(
            withLeaving.reduce((s, p) => s + p.leavingValue, 0) /
              withLeaving.length,
          )
        : null;

      const wins = teamBalance?.wins ?? "–";
      const losses = teamBalance?.losses ?? "–";

      const rows = [...tournamentPicks]
        .sort((a, b) => a.pickOrder - b.pickOrder)
        .map(
          (p) => `
        <tr>
          <td>#${p.pickOrder}</td>
          <td>${escapeHtml(p.displayName)}</td>
          <td>#${p.entryRank}</td>
          <td class="${p.value > 0 ? "outcome-win" : p.value < 0 ? "outcome-loss" : ""}">${p.value > 0 ? "+" : ""}${p.value}</td>
          <td>${p.exitRank !== null ? "#" + p.exitRank : "–"}</td>
          <td class="${p.leavingValue > 0 ? "outcome-win" : p.leavingValue < 0 ? "outcome-loss" : ""}">${p.leavingValue !== null ? (p.leavingValue > 0 ? "+" : "") + p.leavingValue : "–"}</td>
        </tr>`,
        )
        .join("");

      return `
        <h4>${escapeHtml(tournament)} ${escapeHtml(year)}
          <span class="stat-formula">(avg entering value ${avgValue > 0 ? "+" : ""}${avgValue}${avgLeavingValue !== null ? ` · avg leaving value ${avgLeavingValue > 0 ? "+" : ""}${avgLeavingValue}` : ""})</span>
        </h4>
        <h4>${wins}W ${losses}L</h4>
        <table class="profile-history-table">
          <thead><tr><th>Pick #</th><th>Player</th><th>Entering Rank</th><th>Value</th><th>Leaving Rank</th><th>Value (Leaving)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    });

  const modal = ensureCaptainDraftModal();
  modal.querySelector(".captain-draft-title").textContent =
    `${captainName} — Draft History`;
  modal.querySelector(".captain-draft-body").innerHTML =
    sections.join("") || "<p>No draft history found.</p>";
  modal.classList.add("open");
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function ensureCaptainDraftModal() {
  let modal = document.getElementById("captainDraftModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "captainDraftModal";
  modal.className = "player-profile-modal"; // reuse existing modal chrome/CSS
  modal.innerHTML = `
    <div class="player-profile-backdrop" data-close="true"></div>
    <div class="player-profile-panel">
      <button class="player-profile-close" data-close="true">&times;</button>
      <h2 class="captain-draft-title"></h2>
      <div class="captain-draft-body"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    if (e.target.dataset.close === "true") modal.classList.remove("open");
  });
  return modal;
}

// Scatter plot
function buildDraftScatterData(draftAnalysis) {
  const picksByTeam = new Map(); // `${year}::${tournament}::${captain}` -> picks[]
  for (const p of draftAnalysis.picks) {
    const key = `${p.year}::${p.tournament}::${p.captain}`;
    if (!picksByTeam.has(key)) picksByTeam.set(key, []);
    picksByTeam.get(key).push(p);
  }

  return draftAnalysis.teamBalance
    .map((team) => {
      const key = `${team.year}::${team.tournament}::${team.captain}`;
      const teamPicks = picksByTeam.get(key);
      if (!teamPicks || teamPicks.length === 0 || team.games === 0) return null; // nothing to plot without both a draft value and a game record

      const avgDraftValue = round3(
        teamPicks.reduce((s, p) => s + p.value, 0) / teamPicks.length,
      );
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

// Assigns each distinct group key an evenly-spaced hue around the color
// wheel. Works for arbitrary group counts (a handful of years, or dozens
// of captains) without needing a hand-picked palette -- colors get closer
// together as N grows, which is an honest tradeoff rather than reusing
// colors and creating false-equivalence between unrelated groups.
function colorForIndex(i, n) {
  const hue = Math.round((i * 360) / Math.max(n, 1)) % 360;
  return `hsl(${hue}deg 45% 60%)`;
}

function getGroupKey(p, groupBy) {
  if (groupBy === "captain") return p.captain;
  if (groupBy === "year") return String(p.year);
  if (groupBy === "yearTournament") return `${p.year} : ${p.tournament}`;
  return null; // ungrouped -- every point shares one bucket, one color
}

function seasonRank(tournament) {
  const t = String(tournament || "").toLowerCase();
  if (t === "winter") return 0;
  if (t === "summer") return 1;
  return 2;
}

// Builds an ordered list of distinct group keys, sorted in a way that
// reads sensibly in the legend (alphabetical for captains, chronological
// for years/tournaments) rather than however Set iteration happens to
// land.
function buildGroupOrder(data, groupBy) {
  if (groupBy === "none") return [null];
  const keys = [...new Set(data.map((p) => getGroupKey(p, groupBy)))];
  if (groupBy === "captain") return keys.sort((a, b) => a.localeCompare(b));
  if (groupBy === "year") return keys.sort((a, b) => Number(b) - Number(a)); // most recent first
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

let draftScatterBuilt = false;

function initDraftScatterToggle() {
  const box = document.getElementById("draftScatterBox");
  if (!box) return;
  const toggle = box.querySelector(".collapsible-toggle");
  const body = box.querySelector(".collapsible-body");

  toggle.addEventListener("click", () => {
    const isOpen = !body.hidden;
    body.hidden = isOpen;
    toggle.setAttribute("aria-expanded", String(!isOpen));
    toggle.textContent = (isOpen ? "▶" : "▼") + " Draft IQ vs Win Rate";

    if (!isOpen && !draftScatterBuilt && latestDraftAnalysis) {
      renderDraftScatter(
        document.getElementById("draftScatterContainer"),
        buildDraftScatterData(latestDraftAnalysis),
      );
      draftScatterBuilt = true;
    }
  });
}
// Calculates two-tailed p-value from a t-statistic and degrees of freedom
function studentTPValue(t, df) {
  if (isNaN(t) || df <= 0) return 1;
  const absT = Math.abs(t);

  // Normal approximation for large sample sizes (df > 300)
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

  // Exact trigonometric series for integer degrees of freedom
  const theta = Math.atan(absT / Math.sqrt(df));
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  if (df % 2 === 1) {
    // Odd df
    let term = sin * cos;
    let sum = term;
    for (let i = 3; i < df; i += 2) {
      term *= ((i - 1) / i) * cos * cos;
      sum += term;
    }
    const cdf = (2 / Math.PI) * (theta + (df === 1 ? 0 : sum));
    return Math.max(0, 1 - cdf);
  } else {
    // Even df
    let term = sin;
    let sum = term;
    for (let i = 2; i < df; i += 2) {
      term *= ((i - 1) / i) * cos * cos;
      sum += term;
    }
    return Math.max(0, 1 - sum);
  }
}

// Utility to format p-values nicely
function formatPValue(p) {
  if (p < 0.001) return "p < 0.001";
  return `p = ${p.toFixed(3)}`;
}

function renderDraftScatter(container, data) {
  const width = 700,
    height = 420,
    padL = 55,
    padR = 20,
    padT = 20,
    padB = 45;
  const plotW = width - padL - padR,
    plotH = height - padT - padB;

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
    } else {
      let term = sin;
      let sum = term;
      for (let i = 2; i < df; i += 2) {
        term *= ((i - 1) / i) * cos * cos;
        sum += term;
      }
      return Math.max(0, 1 - sum);
    }
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

    // Calculate R-squared
    const rSquared =
      ssYY === 0 ? 0 : Math.min(1, Math.max(0, (ssXY * ssXY) / (ssXX * ssYY)));

    // Calculate p-value (t-test on slope)
    const df = n - 2;
    const ssRes = Math.max(0, ssYY - (ssXY * ssXY) / ssXX);
    const mse = ssRes / df;
    const seSlope = Math.sqrt(mse / ssXX);

    let pValue = 1;
    if (seSlope === 0) {
      pValue = slope === 0 ? 1 : 0;
    } else {
      const tStat = slope / seSlope;
      pValue = studentTPValue(tStat, df);
    }

    return { slope, intercept, rSquared, pValue, n };
  }

  const fullDomain = computeDomain(data);
  let domain = { ...fullDomain };

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

  let selectedKey = null;
  let selectedGroupKey = null;
  let groupBy = "none";

  const groupBySelect = document.getElementById("draftScatterGroupBySelect");
  const legendEl = document.getElementById("draftScatterLegend");

  function colorFor(p) {
    if (groupBy === "none") return "var(--accent)";
    const order = buildGroupOrder(data, groupBy);
    const key = getGroupKey(p, groupBy);
    const idx = order.indexOf(key);
    return colorForIndex(idx, order.length);
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
        jitterOf.set(p, {
          dxPx: Math.cos(angle) * jitterRadiusPx,
          dyPx: Math.sin(angle) * jitterRadiusPx,
        });
      });
    }
    return jitterOf;
  }

  function renderLegend() {
    if (groupBy === "none") {
      legendEl.innerHTML = "";
      legendEl.hidden = true;
      return;
    }
    legendEl.hidden = false;
    const order = buildGroupOrder(data, groupBy);
    legendEl.innerHTML = order
      .map((key, i) => {
        const isDimmed = selectedGroupKey && selectedGroupKey !== key;
        return `<button type="button" class="legend-item${isDimmed ? " dimmed" : ""}" data-group-key="${escapeHtml(key)}">
        <i style="background:${colorForIndex(i, order.length)}"></i>${escapeHtml(key)}
      </button>`;
      })
      .join("");

    legendEl.querySelectorAll(".legend-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedKey = null;
        selectedGroupKey =
          selectedGroupKey === btn.dataset.groupKey
            ? null
            : btn.dataset.groupKey;
        render();
      });
    });
  }

  function render() {
    const xScale = (x) =>
      padL + ((x - domain.xMin) / (domain.xMax - domain.xMin)) * plotW;
    const yScale = (y) =>
      padT + plotH - ((y - domain.yMin) / (domain.yMax - domain.yMin)) * plotH;

    const xTicks = 5,
      yTicks = 5;
    const gridlines = [
      ...Array.from({ length: xTicks + 1 }, (_, i) => {
        const val = domain.xMin + (domain.xMax - domain.xMin) * (i / xTicks);
        const x = xScale(val);
        return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="var(--border)" stroke-width="1" />
                <text x="${x}" y="${height - padB + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${val.toFixed(1)}</text>`;
      }),
      ...Array.from({ length: yTicks + 1 }, (_, i) => {
        const val = domain.yMin + (domain.yMax - domain.yMin) * (i / yTicks);
        const y = yScale(val);
        return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="var(--border)" stroke-width="1" />
                <text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(val * 100)}%</text>`;
      }),
    ].join("");

    const visiblePoints = data.filter(
      (p) =>
        p.avgDraftValue >= domain.xMin &&
        p.avgDraftValue <= domain.xMax &&
        p.winRate >= domain.yMin &&
        p.winRate <= domain.yMax,
    );

    const jitterOf = computeJitteredPositions(visiblePoints);

    const sortedForPaint = [...visiblePoints].sort((a, b) => {
      const aKey = `${a.year}::${a.tournament}::${a.captain}`;
      const bKey = `${b.year}::${b.tournament}::${b.captain}`;
      const aHighlighted =
        aKey === selectedKey ||
        (selectedGroupKey && getGroupKey(a, groupBy) === selectedGroupKey);
      const bHighlighted =
        bKey === selectedKey ||
        (selectedGroupKey && getGroupKey(b, groupBy) === selectedGroupKey);
      return (aHighlighted ? 1 : 0) - (bHighlighted ? 1 : 0);
    });

    const dots = sortedForPaint
      .map((p) => {
        const pointKey = `${p.year}::${p.tournament}::${p.captain}`;
        const groupKey = getGroupKey(p, groupBy);
        const isSelectedPoint = pointKey === selectedKey;
        const isDimmedByPoint = selectedKey && !isSelectedPoint;
        const isDimmedByGroup =
          selectedGroupKey && groupKey !== selectedGroupKey;
        const isDimmed = isDimmedByPoint || isDimmedByGroup;
        const r = 4 + Math.sqrt(p.games);
        const fillColor = colorFor(p);
        const jitter = jitterOf.get(p) || { dxPx: 0, dyPx: 0 };
        const cx = xScale(p.avgDraftValue) + jitter.dxPx;
        const cy = yScale(p.winRate) + jitter.dyPx;
        return `<circle
        class="scatter-point"
        data-captain="${escapeHtml(p.captain)}"
        data-key="${escapeHtml(pointKey)}"
        cx="${cx}" cy="${cy}" r="${isSelectedPoint ? r + 2 : r}"
        fill="${fillColor}" fill-opacity="${isDimmed ? 0.08 : 0.5}"
        stroke="${isSelectedPoint ? "var(--text)" : fillColor}"
        stroke-opacity="${isDimmed ? 0.15 : isSelectedPoint ? 1 : 0.75}"
        stroke-width="${isSelectedPoint ? 2.5 : 1.25}"
        style="cursor:pointer" />`;
      })
      .join("");

    const regression = computeRegressionLine(data);
    const regressionLine = regression
      ? (() => {
          const y1 = regression.slope * domain.xMin + regression.intercept;
          const y2 = regression.slope * domain.xMax + regression.intercept;
          return `<line x1="${xScale(domain.xMin)}" y1="${yScale(y1)}" x2="${xScale(domain.xMax)}" y2="${yScale(y2)}"
        stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" clip-path="url(#draftScatterPlotClip)" />`;
        })()
      : "";

    // Label on the top-right corner of plot
    const statsLabel = regression
      ? `<text x="${padL + plotW - 6}" y="${padT + 14}" text-anchor="end" font-size="11" font-weight="600" fill="var(--muted)">
          R² = ${regression.rSquared.toFixed(3)} (${formatPValue(regression.pValue)})
         </text>`
      : "";

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="draft-scatter-svg">
          <defs>
            <clipPath id="draftScatterPlotClip">
              <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" />
            </clipPath>
          </defs>
          ${gridlines}
          <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--muted)" stroke-width="1" />
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="var(--muted)" stroke-width="1" />
          <text x="${padL + plotW / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">Draft IQ (avg pick value)</text>
          <text x="14" y="${padT + plotH / 2}" text-anchor="middle" font-size="11" fill="var(--muted)" transform="rotate(-90 14 ${padT + plotH / 2})">Win Rate</text>
          ${regressionLine}
          ${statsLabel}
          <rect class="scatter-zoom-overlay" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair" />
          ${dots}
          <rect class="scatter-drag-rect" x="0" y="0" width="0" height="0" fill="var(--accent)" fill-opacity="0.15" stroke="var(--accent)" stroke-width="1" style="display:none;pointer-events:none" />
        </svg>
        <div class="draft-scatter-controls">
          <button class="scatter-reset-btn" type="button">Reset zoom / selection</button>
          <span class="draft-scatter-hint">Drag to zoom · click a point or legend entry to highlight</span>
        </div>
        <div class="draft-scatter-tooltip" hidden></div>
      `;

    renderLegend();
    wireInteractions();
  }

  function wireInteractions() {
    const svg = container.querySelector(".draft-scatter-svg");
    const overlay = container.querySelector(".scatter-zoom-overlay");
    const dragRect = container.querySelector(".scatter-drag-rect");
    const tooltip = container.querySelector(".draft-scatter-tooltip");
    const resetBtn = container.querySelector(".scatter-reset-btn");

    container.querySelectorAll(".scatter-point").forEach((circle) => {
      circle.addEventListener("pointerenter", (e) => {
        const key = circle.dataset.key;
        const p = data.find(
          (d) => `${d.year}::${d.tournament}::${d.captain}` === key,
        );
        if (!p) return;
        tooltip.innerHTML = `<strong>${escapeHtml(p.captain)}</strong> <span style="color:var(--muted)">(${escapeHtml(p.tournament)} ${p.year})</span><br>
          Draft value: ${p.avgDraftValue > 0 ? "+" : ""}${p.avgDraftValue} (${p.picksEvaluated} picks)<br>
          Record: ${p.wins}W ${p.losses}L (${Math.round(p.winRate * 100)}%)`;
        tooltip.hidden = false;
        const rect = container.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - rect.left + 12}px`;
        tooltip.style.top = `${e.clientY - rect.top + 12}px`;
      });
      circle.addEventListener("pointermove", (e) => {
        const rect = container.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - rect.left + 12}px`;
        tooltip.style.top = `${e.clientY - rect.top + 12}px`;
      });
      circle.addEventListener("pointerleave", () => {
        tooltip.hidden = true;
      });
      circle.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedGroupKey = null;
        selectedKey =
          selectedKey === circle.dataset.key ? null : circle.dataset.key;
        render();
      });
    });

    let dragStart = null;
    const svgPoint = (evt) => {
      const rect = svg.getBoundingClientRect();
      const scale = Math.min(rect.width / width, rect.height / height);
      const renderedWidth = width * scale;
      const renderedHeight = height * scale;
      const offsetX = (rect.width - renderedWidth) / 2;
      const offsetY = (rect.height - renderedHeight) / 2;

      return {
        x: (evt.clientX - rect.left - offsetX) / scale,
        y: (evt.clientY - rect.top - offsetY) / scale,
      };
    };

    overlay.addEventListener("pointerdown", (e) => {
      dragStart = svgPoint(e);
      dragRect.style.display = "block";
    });
    svg.addEventListener("pointermove", (e) => {
      if (!dragStart) return;
      const cur = svgPoint(e);
      const x = Math.min(dragStart.x, cur.x),
        y = Math.min(dragStart.y, cur.y);
      dragRect.setAttribute("x", x);
      dragRect.setAttribute("y", y);
      dragRect.setAttribute("width", Math.abs(cur.x - dragStart.x));
      dragRect.setAttribute("height", Math.abs(cur.y - dragStart.y));
    });
    svg.addEventListener("pointerup", (e) => {
      if (!dragStart) return;
      const cur = svgPoint(e);
      const x1 = Math.min(dragStart.x, cur.x),
        x2 = Math.max(dragStart.x, cur.x);
      const y1 = Math.min(dragStart.y, cur.y),
        y2 = Math.max(dragStart.y, cur.y);
      dragStart = null;
      dragRect.style.display = "none";
      if (x2 - x1 < 8 || y2 - y1 < 8) return;

      const invX = (px) =>
        domain.xMin + ((px - padL) / plotW) * (domain.xMax - domain.xMin);
      const invY = (py) =>
        domain.yMin +
        ((padT + plotH - py) / plotH) * (domain.yMax - domain.yMin);
      const newXMin = invX(x1),
        newXMax = invX(x2);
      const newYMin = invY(y2),
        newYMax = invY(y1);
      domain = {
        xMin: newXMin,
        xMax: newXMax,
        yMin: Math.max(0, newYMin),
        yMax: Math.min(1, newYMax),
      };
      render();
    });

    resetBtn.addEventListener("click", () => {
      domain = { ...fullDomain };
      selectedKey = null;
      selectedGroupKey = null;
      render();
    });
  }

  groupBySelect.value = "none";
  groupBySelect.addEventListener("change", () => {
    groupBy = groupBySelect.value;
    selectedKey = null;
    selectedGroupKey = null;
    render();
  });

  render();
}

// Formats a {displayName, pickOrder, entryRank, value} object into a
// single readable string -- e.g. "Voidliss (pick #14, entering-rank #3,
// value +11)". A positive value means they were rated better than where
// they went (a steal); negative means they went earlier than their
// entering rating justified (a reach).
function formatDraftPick(pick, rankLabel = "entering-rank") {
  if (!pick) return "–";
  const sign = pick.value > 0 ? "+" : "";
  const rank = pick.entryRank ?? pick.exitRank;
  return `${escapeHtml(pick.displayName)} <span class="pick-value ${pick.value > 0 ? "outcome-win" : pick.value < 0 ? "outcome-loss" : ""}">${sign}${pick.value}</span><br>
    <span class="pick-detail">pick #${pick.pickOrder} · ${rankLabel} #${rank}</span>`;
}

document.addEventListener("click", (e) => {
  const link = e.target.closest(".captain-draft-link");
  if (!link) return;
  e.preventDefault();
  openCaptainDraftHistory(link.dataset.captain);
});

initDraftScatterToggle();

// ==================== Team Balance tab ====================

const TEAM_BALANCE_COLUMNS = [
  {
    key: "year",
    label: "Year",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "tournament",
    label: "Tournament",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    filterType: "checkbox",
  },
  {
    key: "captain",
    label: "Captain",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    className: "group-name",
  },
  {
    key: "avgEntryRating",
    label: "Avg Entry TrueSkill",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
  },
  {
    key: "finalStage",
    label: "Final Stage",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    filterType: "checkbox",
  },
  {
    key: "wins",
    label: "Wins",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "losses",
    label: "Losses",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "winRate",
    label: "Win Rate",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    percentage: true,
  },
];

function renderTeamMatchList(row) {
  const roster = row.roster || [];
  const matches = row.matches || [];

  const rosterHtml = roster.length
    ? `<ul class="roster-detail-list">${roster
        .map(
          (m) =>
            `<li>${escapeHtml(m.displayName)} <span class="roster-rating">${renderTrueSkillValue(m.conservativeRating)}</span></li>`,
        )
        .join("")}</ul>`
    : "<p>No roster on file.</p>";

  const matchesHtml = matches.length
    ? `<table class="profile-history-table">
        <thead><tr><th>Opponent(s)</th><th>Result</th><th>Stage</th><th>Pred. Win %</th></tr></thead>
        <tbody>${matches
          .map((m) => {
            const outcomeClass =
              m.outcome === "win"
                ? "outcome-win"
                : m.outcome === "loss"
                  ? "outcome-loss"
                  : "outcome-draw";
            return `<tr>
            <td>${escapeHtml(m.opponentName)}</td>
            <td class="${outcomeClass}">${escapeHtml(m.outcome)}</td>
            <td>${m.matchStage ? escapeHtml(m.matchStage) : "–"}</td>
            <td>${Math.round((m.predictedWinProb ?? 0) * 100)}%</td>
          </tr>`;
          })
          .join("")}</tbody>
      </table>`
    : "<p>No matches recorded.</p>";

  return `
    <div class="roster-detail">
      <div><strong>Roster</strong>${rosterHtml}</div>
    </div>
    <div class="team-matches-section">
      <strong>Matches</strong>
      ${matchesHtml}
    </div>`;
}

const teamBalanceTable = createTabTable({
  columns: TEAM_BALANCE_COLUMNS,
  headerRowEl: document.getElementById("teamBalanceHeaderRow"),
  bodyEl: document.getElementById("teamBalanceBody"),
  columnsBtnEl: document.getElementById("teamBalanceColumnsBtn"),
  columnsPanelEl: document.getElementById("teamBalanceColumnsPanel"),
  ownerKey: "teambalance",
  defaultSortColumn: "avgEntryRating",
  emptyMessage: "No team balance data available",
  expandable: { getDetailHtml: renderTeamMatchList },
});

// ==================== Shared fetch: both tabs come from one endpoint ====================

let draftAnalysisLoaded = false;
let latestDraftAnalysis = null; // cache so the modal can filter without refetching

async function loadDraftAnalysis() {
  if (draftAnalysisLoaded) return;
  const res = await fetch("/api/draft-analysis");
  const data = await res.json();
  latestDraftAnalysis = data;

  const draftIQRows = data.captainDraftIQ.map((row) => ({
    ...row,
    captainDisplay: `<a href="#" class="captain-draft-link" data-captain="${escapeHtml(row.captain)}">${renderNameWithTag(row.captain)}</a>`,
    bestPickLabel: formatDraftPick(row.bestPick, "entering-rank"),
    worstPickLabel: formatDraftPick(row.worstPick, "entering-rank"),
    bestPickLeavingLabel: formatDraftPick(row.bestPickLeaving, "leaving-rank"),
    worstPickLeavingLabel: formatDraftPick(
      row.worstPickLeaving,
      "leaving-rank",
    ),
  }));
  draftIQTable.setData(draftIQRows);
  teamBalanceTable.setData(data.teamBalance);
  draftAnalysisLoaded = true;
}

// ==================== Mock Draft Data tab ====================
let mockDraftPool = [];

function applyMockDraftPoolFilter(rawText) {
  const names = parseNameList(rawText);
  const summaryEl = document.getElementById("mockDraftFilterSummary");
  if (names.length === 0) {
    // No list typed/pasted/loaded -- default to every known player rather
    // than an empty pool, so Mock Draft is immediately usable without
    // requiring a preset first.
    mockDraftPool = (latestTrueskillPlayers || []).map((p) => ({
      identityKey: p.identityKey,
      group: p.group,
      conservativeRating: p.conservativeRating,
      mu: p.mu,
      sigma: p.sigma,
      soloQueueRank: p.soloQueueRank,
      manual: false
    }));
    summaryEl.textContent = mockDraftPool.length
      ? `Showing all ${mockDraftPool.length} known players (no list applied).`
      : '';
    renderMockDraftPlayerDatalist();
    draftPicks = new Map(); // pool changed -- stale picks would reference the previous pool
    renderDraftBoard();
    renderAvailableSelectedTables();
    return;
  }

  const matcher = buildNameMatcher(names);
  const playersForCheck = latestTrueskillPlayers || [];
  const { unmatched } = matcher.checkCoverage(playersForCheck);

  // Every pasted/uploaded name becomes a pool entry -- matched names get
  // their real TrueSkill data, names with no match at all (genuinely new
  // people, not in the system yet) become a manual stub with null
  // ratings instead of being silently dropped. This is the same shape
  // resolvePoolPlayerByName already produces for a name typed directly
  // into a board cell, so both paths behave consistently.
  mockDraftPool = names.map((rawName) =>
    resolvePoolPlayerByName(rawName, playersForCheck),
  );

  summaryEl.textContent = unmatched.length
    ? `Matched ${names.length - unmatched.length}/${names.length}. New/unrecognized (added with no TrueSkill data): ${unmatched.join(", ")}`
    : `Matched all ${names.length} names.`;
  summaryEl.className = unmatched.length
    ? "name-filter-summary has-misses"
    : "name-filter-summary";

  renderMockDraftPlayerDatalist();
  draftPicks = new Map();
  renderDraftBoard();
  renderAvailableSelectedTables();
}

document
  .getElementById("mockDraftFilterApplyBtn")
  .addEventListener("click", () =>
    applyMockDraftPoolFilter(
      document.getElementById("mockDraftFilterInput").value,
    ),
  );
document
  .getElementById("mockDraftFilterClearBtn")
  .addEventListener("click", () => {
    document.getElementById("mockDraftFilterInput").value = "";
    document.getElementById("mockDraftFilterFile").value = "";
    applyMockDraftPoolFilter("");
  });
document
  .getElementById("mockDraftFilterFile")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    document.getElementById("mockDraftFilterInput").value = text;
    applyMockDraftPoolFilter(text);
  });
document
  .getElementById("mockDraftPresetSelect")
  .addEventListener("change", async (e) => {
    const val = e.target.value;
    if (!val) return;
    const textarea = document.getElementById("mockDraftFilterInput");
    let names = [],
      captains = [];

    if (val.startsWith("past::")) {
      const [, year, tournament] = val.split("::");
      names = namesForPastDraft(year, tournament);
      // Past drafts already know who captained -- reuse that instead of
      // guessing, same idea as the CSV captain-flag feature below.
      captains = namesForPastDraftCaptains(year, tournament);
    } else if (val.startsWith("admin::")) {
      const res = await fetch(
        `/api/presets/${encodeURIComponent(val.slice(7))}`,
      );
      const data = await res.json();
      names = data.names;
      captains = data.captains || [];
    }

    textarea.value = names.join("\n");
    applyMockDraftPoolFilter(textarea.value);

    if (captains.length > 0) {
      document.getElementById("mockNumCaptains").value = captains.length;
      // Picks per captain: infer from pool size / captain count, rounded
      // down -- a reasonable default the user can still override by hand
      // before generating the board.
      const nonCaptainCount = names.length - captains.length;
      const inferredPicks = Math.max(
        1,
        Math.floor(nonCaptainCount / captains.length),
      );
      document.getElementById("mockPicksPerCaptain").value = inferredPicks;

      numCaptains = captains.length;
      picksPerCaptain = inferredPicks;
      renderCaptainInputs(numCaptains);
      captains.forEach((name, i) => {
        mockCaptains[i] = resolvePoolPlayerByName(name, mockDraftPool);
        document.querySelectorAll(".mock-captain-input")[i].value =
          mockCaptains[i].group;
      });
      renderDraftBoard();
      renderAvailableSelectedTables();
    }

    e.target.value = "";
  });

function renderMockDraftPlayerDatalist() {
  document.getElementById("mockDraftPlayerDatalist").innerHTML = mockDraftPool
    .map((p) => `<option value="${escapeHtml(p.group)}"></option>`)
    .join("");
}

// Matches typed text against a given pool (case/tag-tolerant, same
// convention as the TrueSkill filter's matcher); falls back to a
// "manual" stub if nothing in the pool matches, so someone not in your
// filtered list can still be typed in directly -- they just won't carry
// any TrueSkill data.
function resolvePoolPlayerByName(text, pool) {
  const norm = text.trim().toLowerCase();
  if (!norm) return null;
  const bareOf = (s) => {
    const idx = s.lastIndexOf("#");
    return (idx === -1 ? s : s.slice(0, idx)).trim().toLowerCase();
  };
  const found = pool.find((p) => {
    const g = p.group.trim().toLowerCase();
    return g === norm || bareOf(g) === norm || bareOf(g) === bareOf(norm);
  });
  return found
    ? { ...found, manual: false }
    : {
        identityKey: null,
        group: text.trim(),
        conservativeRating: null,
        mu: null,
        sigma: null,
        manual: true,
      };
}

// Draft board
let draftPicks = new Map(); // `${round}::${captainIndex}` -> resolved player or null
let numCaptains = 8,
  picksPerCaptain = 4;

// Standard snake: round 0 goes captain 0..N-1, round 1 reverses N-1..0,
// alternating -- "left to right, then sweep back" exactly as described.
function generateSnakeSlots(nCaptains, nPicks) {
  const slots = [];
  let overall = 1;
  for (let round = 0; round < nPicks; round++) {
    const order =
      round % 2 === 0
        ? [...Array(nCaptains).keys()]
        : [...Array(nCaptains).keys()].reverse();
    for (const captainIndex of order)
      slots.push({ round, captainIndex, overall: overall++ });
  }
  return slots;
}

// Captains
let mockCaptains = [];

function renderCaptainInputs(n) {
  const container = document.getElementById("mockCaptainInputs");
  container.innerHTML = "";
  mockCaptains = mockCaptains.slice(0, n);
  for (let i = 0; i < n; i++) {
    const wrap = document.createElement("div");
    wrap.className = "mock-captain-input-wrap";
    wrap.innerHTML = `<label>Captain ${i + 1}</label>`;
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("list", "mockDraftPlayerDatalist");
    input.className = "mock-captain-input";
    input.placeholder = "Type or pick a name…";
    input.value = mockCaptains[i]?.group || "";
    input.addEventListener("change", () => {
      mockCaptains[i] = resolvePoolPlayerByName(input.value, mockDraftPool);
      renderDraftBoard();
      renderAvailableSelectedTables();
    });
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}
document
  .getElementById("mockGenerateBoardBtn")
  .addEventListener("click", () => {
    numCaptains = Math.max(
      2,
      parseInt(document.getElementById("mockNumCaptains").value, 10) || 2,
    );
    picksPerCaptain = Math.max(
      1,
      parseInt(document.getElementById("mockPicksPerCaptain").value, 10) || 1,
    );
    draftPicks = new Map();
    renderCaptainInputs(numCaptains);
    renderDraftBoard();
    renderAvailableSelectedTables();
  });

function getAvailablePlayers() {
  const draftedKeys = new Set(),
    draftedNames = new Set();
  draftPicks.forEach((pick) => {
    if (!pick) return;
    if (pick.identityKey) draftedKeys.add(pick.identityKey);
    else draftedNames.add(pick.group.toLowerCase());
  });
  mockCaptains.forEach((captain) => {
    if (!captain) return;
    if (captain.identityKey) draftedKeys.add(captain.identityKey);
    else draftedNames.add(captain.group.toLowerCase());
  });
  return mockDraftPool.filter(
    (p) =>
      !draftedKeys.has(p.identityKey) &&
      !draftedNames.has(p.group.toLowerCase()),
  );
}

function renderMockDraftAvailableDatalist() {
  document.getElementById("mockDraftAvailableDatalist").innerHTML =
    getAvailablePlayers()
      .map((p) => `<option value="${escapeHtml(p.group)}"></option>`)
      .join("");
}

function renderDraftBoard() {
  const slots = generateSnakeSlots(numCaptains, picksPerCaptain);
  const table = document.getElementById("mockDraftBoardTable");
  const headerCells = Array.from(
    { length: numCaptains },
    (_, i) =>
      `<th>${escapeHtml(mockCaptains[i]?.group || `Captain ${i + 1}`)}</th>`,
  ).join("");

  const rows = [];
  for (let round = 0; round < picksPerCaptain; round++) {
    const cells = [];
    for (let c = 0; c < numCaptains; c++) {
      const slot = slots.find((s) => s.round === round && s.captainIndex === c);
      const pick = draftPicks.get(`${round}::${c}`);
      const pickNumberHtml = pick && pick.identityKey
        ? `<a href="#" class="player-link mock-pick-number-link" data-player-key="${escapeHtml(pick.identityKey)}" title="View profile">#${slot.overall} <span class="mock-profile-icon">→</span></a>`
        : `<span class="mock-pick-number">#${slot.overall}</span>`;
      cells.push(`<td><div class="mock-pick-cell">
        ${pickNumberHtml}
        <input type="text" list="mockDraftAvailableDatalist" class="mock-pick-input"
          data-round="${round}" data-captain="${c}"
          value="${pick ? escapeHtml(pick.group) : ''}" placeholder="Type or pick…" />
      </div></td>`);
    }
    rows.push(
      `<tr><td class="round-label">Round ${round + 1}</td>${cells.join("")}</tr>`,
    );
  }

  table.innerHTML = `<thead><tr><th></th>${headerCells}</tr></thead><tbody>${rows.join("")}</tbody>`;
  renderMockDraftAvailableDatalist();

  table.querySelectorAll('.mock-pick-input').forEach((input) => {
    input.addEventListener('change', () => {
      const key = `${input.dataset.round}::${input.dataset.captain}`;
      const text = input.value.trim();
      if (!text) draftPicks.delete(key);
      else draftPicks.set(key, resolvePoolPlayerByName(text, getAvailablePlayers()));
      renderDraftBoard(); // rebuilds the board, including the now-resolved pick's arrow/link
      renderAvailableSelectedTables();
    });
  });
}

const MOCK_PLAYER_COLUMNS = [
  {
    key: "group",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    className: "group-name",
  },
  {
    key: "conservativeRating",
    label: "TrueSkill",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
    render: (val) => renderTrueSkillValue(val),
  },
  {
    key: "soloQueueRank",
    label: "Solo Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => soloQueueSortValueClient(row.soloQueueRank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "flexQueueRank",
    label: "Flex Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => soloQueueSortValueClient(row.flexQueueRank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "premade5x5Rank",
    label: "5x5 Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    defaultHidden: true,
    sortValue: (row) => soloQueueSortValueClient(row.premade5x5Rank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "mu",
    label: "μ",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
  },
  {
    key: "sigma",
    label: "σ",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
  },
];
const MOCK_SELECTED_COLUMNS = [
  ...MOCK_PLAYER_COLUMNS,
  {
    key: "pickLabel",
    label: "Pick",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => row.overall,
  },
];

const mockAvailableTable = createTabTable({
  columns: MOCK_PLAYER_COLUMNS,
  headerRowEl: document.getElementById("mockAvailableHeaderRow"),
  bodyEl: document.getElementById("mockAvailableBody"),
  columnsBtnEl: document.getElementById("mockAvailableColumnsBtn"),
  columnsPanelEl: document.getElementById("mockAvailableColumnsPanel"),
  ownerKey: "mockavailable",
  defaultSortColumn: "conservativeRating",
  emptyMessage: "No players remaining -- add a pool above",
});
const mockSelectedTable = createTabTable({
  columns: MOCK_SELECTED_COLUMNS,
  headerRowEl: document.getElementById("mockSelectedHeaderRow"),
  bodyEl: document.getElementById("mockSelectedBody"),
  columnsBtnEl: document.getElementById("mockSelectedColumnsBtn"),
  columnsPanelEl: document.getElementById("mockSelectedColumnsPanel"),
  ownerKey: "mockselected",
  defaultSortColumn: "pickLabel",
  defaultSortDirection: "asc",
  emptyMessage: "No picks made yet",
});

function renderAvailableSelectedTables() {
  mockAvailableTable.setData(getAvailablePlayers());
  const slots = generateSnakeSlots(numCaptains, picksPerCaptain);
  const selected = [];
  draftPicks.forEach((pick, key) => {
    if (!pick) return;
    const [round, captainIndex] = key.split("::").map(Number);
    const slot = slots.find(
      (s) => s.round === round && s.captainIndex === captainIndex,
    );
    selected.push({
      ...pick,
      overall: slot?.overall ?? 0,
      pickLabel: `#${slot?.overall ?? "?"} (${mockCaptains[captainIndex]?.group || `Captain ${captainIndex + 1}`})`,
    });
  });
  mockSelectedTable.setData(selected);
}

// Same methodology as real Draft IQ using current rating
function evaluateMockDraftIQ() {
  const slots = generateSnakeSlots(numCaptains, picksPerCaptain);
  const rated = mockDraftPool.filter((p) => p.conservativeRating !== null && p.conservativeRating !== undefined);
  const rankedByRating = [...rated].sort((a, b) => b.conservativeRating - a.conservativeRating);
  const entryRankByKey = new Map(rankedByRating.map((p, i) => [p.identityKey || p.group, i + 1]));

  const picks = [];
  draftPicks.forEach((pick, key) => {
    if (!pick) return;
    const [round, captainIndex] = key.split('::').map(Number);
    const slot = slots.find((s) => s.round === round && s.captainIndex === captainIndex);
    if (!slot) return;
    const poolKey = pick.identityKey || pick.group;
    const entryRank = entryRankByKey.get(poolKey) ?? null;
    picks.push({
      captainIndex,
      captainName: mockCaptains[captainIndex]?.group || `Captain ${captainIndex + 1}`,
      captainIdentityKey: mockCaptains[captainIndex]?.identityKey || null,
      displayName: pick.group,
      identityKey: pick.identityKey || null, // needed for the profile link -- manual/unmatched picks stay null
      pickOrder: slot.overall,
      entryRank,
      value: entryRank !== null ? entryRank - slot.overall : null
    });
  });

  const byCaptain = new Map();
  picks.forEach((p) => {
    if (!byCaptain.has(p.captainIndex)) byCaptain.set(p.captainIndex, []);
    byCaptain.get(p.captainIndex).push(p);
  });

  const captainResults = [...byCaptain.entries()].map(([captainIndex, captainPicks]) => {
    const valued = captainPicks.filter((p) => p.value !== null);
    const avgDraftValue = valued.length
      ? round1(valued.reduce((s, p) => s + p.value, 0) / valued.length)
      : null;
    return {
      captainName: captainPicks[0]?.captainName,
      captainIdentityKey: captainPicks[0]?.captainIdentityKey,
      avgDraftValue,
      picks: [...captainPicks].sort((a, b) => a.pickOrder - b.pickOrder)
    };
  });

  captainResults.sort((a, b) => (b.avgDraftValue ?? -Infinity) - (a.avgDraftValue ?? -Infinity));
  return captainResults;
}

function renderMockDraftIQResults(captainResults) {
  if (captainResults.length === 0) {
    return '<p class="mock-draftiq-empty">No picks made yet -- fill in the board first.</p>';
  }
  return captainResults.map((team) => {
    const rows = team.picks.map((p) => {
      const nameHtml = p.identityKey
        ? `<a href="#" class="player-link" data-player-key="${escapeHtml(p.identityKey)}">${renderNameWithTag(p.displayName)}</a>`
        : renderNameWithTag(p.displayName);
      return `
        <tr>
          <td>#${p.pickOrder}</td>
          <td>${nameHtml}</td>
          <td>${p.entryRank !== null ? '#' + p.entryRank : '–'}</td>
          <td class="${p.value > 0 ? 'outcome-win' : p.value < 0 ? 'outcome-loss' : ''}">${p.value !== null ? (p.value > 0 ? '+' : '') + p.value : '–'}</td>
        </tr>`;
    }).join('');

    const captainNameHtml = team.captainIdentityKey
      ? `<a href="#" class="player-link" data-player-key="${escapeHtml(team.captainIdentityKey)}">${escapeHtml(team.captainName)}</a>`
      : escapeHtml(team.captainName);

    return `
      <div class="fun-facts-box" style="margin-bottom:12px;">
        <div class="collapsible-body" style="padding:14px 18px;">
          <h4 class="mock-draftiq-team-header">${captainNameHtml}
            <span class="stat-formula">(avg value ${team.avgDraftValue !== null ? (team.avgDraftValue > 0 ? '+' : '') + team.avgDraftValue : '–'})</span>
          </h4>
          <table class="profile-history-table">
            <thead><tr><th>Pick #</th><th>Player</th><th>Entering Rank</th><th>Value</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

document.getElementById('mockEvaluateDraftIQBtn').addEventListener('click', () => {
  const results = evaluateMockDraftIQ();
  document.getElementById('mockDraftIQResults').innerHTML = renderMockDraftIQResults(results);
});

async function initMockDraftTab() {
  await loadtrueskillData(false);
  buildPastDraftOptions(document.getElementById('mockPastDraftsOptgroup'));
  buildAdminPresetOptions(document.getElementById('mockAdminPresetsOptgroup'));
  if (mockDraftPool.length === 0 && !document.getElementById('mockDraftFilterInput').value) {
    applyMockDraftPoolFilter('');
  }
}

tabButtons.forEach((btn) => {
  if (btn.dataset.tab === 'mockdraft') {
    btn.addEventListener('click', () => initMockDraftTab());
  }
});

// ==================== Upcoming Roster tab ====================
let upcomingRosterLoaded = false;

async function loadUpcomingRoster() {
  if (upcomingRosterLoaded) return;
  try {
    const res = await fetch("/api/upcoming-roster");
    if (res.status === 404) return; // no file present -- tab stays hidden, this is expected/normal
    const data = await res.json();
    if (!data.exists) return;

    document.getElementById("upcomingRosterTabBtn").textContent = data.title;
    document.getElementById("upcomingRosterTabBtn").style.display = "";
    document.getElementById("upcomingRosterContent").innerHTML =
      renderUpcomingRoster(data);
    upcomingRosterLoaded = true;
  } catch (err) {
    // silently do nothing -- absence of this feature should never surface as an error to the user
  }
}

function renderUpcomingRoster(data) {
  return data.teams
    .map((team) => {
      const rosterRows = team.roster
        .map((p) => {
          const nameHtml =
            p.identityKey && p.identified
              ? `<a href="#" class="player-link" data-player-key="${escapeHtml(p.identityKey)}">${renderNameWithTag(p.displayName)}</a>`
              : renderNameWithTag(p.displayName);
          const ratingHtml =
            p.conservativeRating !== null
              ? renderTrueSkillValue(p.conservativeRating, p.mu)
              : '<span class="stat-formula">unrated (no games yet)</span>';
          return `<tr>
        <td>#${p.pickOrder}</td>
        <td>${nameHtml}</td>
        <td>${ratingHtml}</td>
        <td>${p.entryRank !== null ? "#" + p.entryRank : "–"}</td>
        <td class="${p.value > 0 ? "outcome-win" : p.value < 0 ? "outcome-loss" : ""}">${p.value !== null ? (p.value > 0 ? "+" : "") + p.value : "–"}</td>
      </tr>`;
        })
        .join("");

      return `
      <div class="fun-facts-box" style="margin-bottom:16px;">
        <div class="collapsible-body" style="padding:16px 18px;">
          <h4>${renderNameWithTag(team.captain.displayName)}</h4>
          <div class="profile-summary">
            <span>Avg Entry TrueSkill: ${team.avgEntryRating !== null ? renderTrueSkillValue(team.avgEntryRating) : "–"} (${team.ratedCount}/${team.totalCount} rated)</span>
            <span>Draft IQ: ${team.draftIQ !== null ? (team.draftIQ > 0 ? "+" : "") + team.draftIQ : "–"}</span>
          </div>
          <table class="profile-history-table">
            <thead><tr><th>Pick #</th><th>Player</th><th>TrueSkill</th><th>Rank</th><th>Value</th></tr></thead>
            <tbody>${rosterRows}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");
}

tabButtons.forEach((btn) => {
  if (btn.dataset.tab === "upcomingroster") {
    btn.addEventListener("click", () => loadUpcomingRoster());
  }
});

// ==================== Draft Data tab ====================
const DRAFT_DATA_COLUMNS = [
  {
    key: "Tournament",
    label: "Tournament",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    filterType: "checkbox",
  },
  {
    key: "Year",
    label: "Year",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "Captain",
    label: "Captain",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
  },
  {
    key: "Player",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    playerLink: true,
    className: "group-name",
  },
  {
    key: "Pick Order",
    label: "Pick Order",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "Rank",
    label: "Rank",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 1,
  },
];

const draftDataTable = createTabTable({
  columns: DRAFT_DATA_COLUMNS,
  headerRowEl: document.getElementById("draftHeaderRow"),
  bodyEl: document.getElementById("draftBody"),
  columnsBtnEl: document.getElementById("draftColumnsBtn"),
  columnsPanelEl: document.getElementById("draftColumnsPanel"),
  ownerKey: "draftdata",
  defaultSortColumn: "Year",
  emptyMessage: "No rows match the active filters",
});

let draftDataLoaded = false;

async function loadDraftData() {
  if (draftDataLoaded) return;
  const res = await fetch("/api/raw");
  const data = await res.json();
  // Raw DB values arrive as strings (SQLite/CSV-sourced) -- coerceNumericColumns
  // is the same helper the old single Raw Data tab used, just called here
  // against this tab's own column list instead of a dynamically-discovered one.
  coerceNumericColumns(
    DRAFT_DATA_COLUMNS.map((c) => c.key),
    data.rows,
  );
  draftDataTable.setData(data.rows);
  draftDataLoaded = true;
}

document.getElementById("downloadDraftCsvBtn").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = "/api/raw.csv";
  a.download = "draft-data.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ==================== Match Data tab ====================
function renderMatchRosterDetail(row) {
  const rosterList = (team) =>
    (team?.roster || [])
      .map(
        (m) =>
          `<li>${escapeHtml(m.displayName)} <span class="roster-rating">${renderTrueSkillValue ? renderTrueSkillValue(m.conservativeRating, m.mu) : m.conservativeRating}</span></li>`,
      )
      .join("");
  return `
    <div class="roster-detail">
      <div><strong>${escapeHtml(row._team1Roster?.name || row.team1)}</strong> - avg TrueSkill: ${renderTrueSkillValue(row._team1Roster?.avgConservativeRating, row._team1Roster?.avgMu)}
        <ul>${rosterList(row._team1Roster)}</ul></div>
      <div><strong>${escapeHtml(row._team2Roster?.name || row.team2)}</strong> - avg TrueSkill: ${renderTrueSkillValue(row._team2Roster?.avgConservativeRating, row._team2Roster?.avgMu)}
        <ul>${rosterList(row._team2Roster)}</ul></div>
    </div>`;
}

const MATCH_DATA_COLUMNS = [
  {
    key: "year",
    label: "Year",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "tournament",
    label: "Tournament",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    filterType: "checkbox",
  },
  {
    key: "team1",
    label: "Team 1",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
  },
  {
    key: "team2",
    label: "Team 2",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
  },
  {
    key: "result",
    label: "Result",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
  },
  {
    key: "match_order",
    label: "Match Order",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "match_stage",
    label: "Match Stage",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
  },
  {
    key: "csv_row_index",
    label: "CSV Row",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    defaultHidden: true,
  },
];

const matchDataTable = createTabTable({
  columns: MATCH_DATA_COLUMNS,
  headerRowEl: document.getElementById("matchHeaderRow"),
  bodyEl: document.getElementById("matchBody"),
  columnsBtnEl: document.getElementById("matchColumnsBtn"),
  columnsPanelEl: document.getElementById("matchColumnsPanel"),
  ownerKey: "matchdata",
  defaultSortColumn: "year",
  emptyMessage: "No rows match the active filters",
  expandable: { getDetailHtml: renderMatchRosterDetail },
});

let matchDataLoaded = false;
async function loadMatchData() {
  if (matchDataLoaded) return;
  const res = await fetch("/api/raw-matches");
  const data = await res.json();
  coerceNumericColumns(
    MATCH_DATA_COLUMNS.map((c) => c.key),
    data.rows,
  );
  matchDataTable.setData(data.rows);
  matchDataLoaded = true;
}

document.getElementById("downloadMatchCsvBtn").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = "/api/raw-matches.csv";
  a.download = "match-data.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ==================== Tab Buttons ====================
tabButtons.forEach((btn) => {
  if (btn.dataset.tab === "trueskill") {
    btn.addEventListener("click", () => loadtrueskillData(false));
  }
  if (btn.dataset.tab === "matchdata") {
    btn.addEventListener("click", () => loadMatchData(false));
  }
  if (btn.dataset.tab === "draftdata") {
    btn.addEventListener("click", () => loadDraftData(false));
  }
  if (btn.dataset.tab === "draftiq" || btn.dataset.tab === "teambalance") {
    btn.addEventListener("click", () => loadDraftAnalysis());
  }
});

// ==================== URL query param state ====================

function readStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab') || 'trueskill';
  setActiveTab(tab);
  if (tab === 'draftdata') loadDraftData();
  if (tab === 'matchdata') loadMatchData();
  if (tab === 'draftiq' || tab === 'teambalance') loadDraftAnalysis();
  if (tab === 'mockdraft') initMockDraftTab();
}

function writeStateToURL() {
  const params = new URLSearchParams();
  const activeTab =
    document.querySelector(".tab-btn.active")?.dataset.tab || "trueskill";
  params.set("tab", activeTab);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", newUrl);
}

let fetchDebounceTimer = null;
let urlDebounceTimer = null;

function scheduleUrlUpdate() {
  clearTimeout(urlDebounceTimer);
  urlDebounceTimer = setTimeout(writeStateToURL, 150);
}

// ==================== Init ====================

async function loadMeta() {
  const res = await fetch("/api/meta");
  const meta = await res.json();
  groupColName = meta.groupCol;
}

(async function init() {
  readStateFromURL();
  await loadMeta();
  await fetchStats(RANKINGS_RISK, RANKINGS_HALF_LIFE);
  loadtrueskillData();
  loadUpcomingRoster();
  writeStateToURL();
})();
