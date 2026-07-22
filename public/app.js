// ==================== Theme toggle ====================
// Dark is the original look; light is the new addition. Default follows
// the OS/browser color-scheme preference; an explicit manual choice
// (stored in localStorage) overrides that from then on. Applied
// immediately (not inside the async init below) so there's no flash of
// the wrong theme while data is still loading.

const THEME_STORAGE_KEY = 'lol-draft-theme';
const themeToggleBtn = document.getElementById('themeToggle');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

(function initTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    applyTheme(stored);
    return;
  }
  // No explicit choice saved yet — follow the system preference.
  const prefersLight =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(prefersLight ? 'light' : 'dark');
})();

// If the user hasn't manually overridden the theme, keep following the
// system preference live (e.g. their OS switches at sunset).
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (localStorage.getItem(THEME_STORAGE_KEY)) return; // manual override wins
    applyTheme(e.matches ? 'light' : 'dark');
  });
}

themeToggleBtn.addEventListener('click', () => {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  applyTheme(next);
  localStorage.setItem(THEME_STORAGE_KEY, next);
});

// TrueSkill Fun Facts
function renderFunFactsHtml(ff) {
  if (!ff) return '';
  const pctRows = ff.percentileCutoffs.map((p) =>
    `<tr><td>${escapeHtml(p.name)}</td><td>${p.percentile}%</td><td>${p.ratingCutoff ?? '–'}</td></tr>`).join('');


  const facts = [];
  if (ff.biggestUpset) {
    const u = ff.biggestUpset;
    facts.push(`<strong>Biggest upset:</strong> ${escapeHtml(u.winnerName)} (avg ${u.winnerAvgBefore}) over ${escapeHtml(u.loserName)} (avg ${u.loserAvgBefore}) in ${u.tournament} ${u.year} — only a ${Math.round(u.predictedWinProbForWinner * 100)}% predicted chance. ${u.mvpName ? `${escapeHtml(u.mvpName)} swung ${u.mvpRatingChange > 0 ? '+' : ''}${u.mvpRatingChange} TrueSkill.` : ''}`);
  }
  if (ff.longestStreak) {
    facts.push(`<strong>Longest win streak:</strong> ${escapeHtml(ff.longestStreak.displayName)}, ${ff.longestStreak.streak} games`);
  }
  if (ff.longestLossStreak) {
    facts.push(`<strong>Longest losing streak:</strong> ${escapeHtml(ff.longestLossStreak.displayName)}, ${ff.longestLossStreak.streak} games`);
  }
  if (ff.peakRating) {
    facts.push(`<strong>Highest TrueSkill ever reached:</strong> ${escapeHtml(ff.peakRating.displayName)}, ${ff.peakRating.conservativeRating} (${ff.peakRating.tournament} ${ff.peakRating.year})`);
  }
  if (ff.troughRating) {
    facts.push(`<strong>Lowest TrueSkill ever reached:</strong> ${escapeHtml(ff.troughRating.displayName)}, ${ff.troughRating.conservativeRating} (${ff.troughRating.tournament} ${ff.troughRating.year})`);
  }
  if (ff.mostGamesPlayed) {
    facts.push(`<strong>Most games played:</strong> ${escapeHtml(ff.mostGamesPlayed.displayName)}, ${ff.mostGamesPlayed.games} games`);
  }
  if (ff.mostActiveRivalry) {
    const r = ff.mostActiveRivalry;
    facts.push(`<strong>Most active rivalry:</strong> ${escapeHtml(r.teamAName)} vs ${escapeHtml(r.teamBName)}, ${r.gamesPlayed} games played (${r.teamAWins}-${r.teamBWins}${r.draws ? `-${r.draws} draws` : ''})`);
  }

  return `
    <div class="fun-facts-box">
      <button class="fun-facts-toggle" aria-expanded="false">▶ Fun facts</button>
      <div class="fun-facts-body" hidden>
        <h4>TrueSkill percentile cutoffs (League of Legends rank equivalent)</h4>
        <table class="fun-facts-table"><thead><tr><th>Rank</th><th>Percentile</th><th>Rating cutoff</th></tr></thead>
          <tbody>${pctRows}</tbody></table>
        <ul class="fun-facts-list">${facts.map((f) => `<li>${f}</li>`).join('')}</ul>
      </div>
    </div>`;
}

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('.fun-facts-toggle');
  if (!toggle) return;
  const body = toggle.nextElementSibling;
  const isOpen = !body.hidden;
  body.hidden = isOpen;
  toggle.setAttribute('aria-expanded', String(!isOpen));
  toggle.textContent = (isOpen ? '▶' : '▼') + ' Fun facts';
});
// Modal Player Profile
const playerProfileModal = document.getElementById('playerProfileModal');
const playerProfileCloseBtn = document.getElementById('playerProfileClose');
const playerProfileContent = document.getElementById('playerProfileContent');
const playerProfileTitle = document.getElementById('playerProfileTitle');

function closePlayerProfile() {
  if (!playerProfileModal) return;
  playerProfileModal.classList.remove('open');
  playerProfileModal.setAttribute('aria-hidden', 'true');
  playerProfileContent.innerHTML = 'Loading…';
}


function renderPlayerProfileContent(player) {
  const title = escapeHtml(player?.group || player?.identityKey || 'Player');
  const summaryRows = [
    `<div class="profile-summary">`,
    `<span><strong>${title}</strong></span>`,
    `<span>${player?.identified ? 'Identified' : 'Unidentified'}</span>`,
    player?.profileUrl ? `<a href="${escapeHtml(player.profileUrl)}" target="_blank" rel="noopener noreferrer">Open op.gg</a>` : '',
    `</div>`
  ].filter(Boolean).join('');

  const statsRows = [
    `<div class="profile-summary">`,
    `<span>Games: ${player?.games ?? '–'}</span>`,
    `<span>Wins: ${player?.wins ?? '–'}</span>`,
    `<span>Losses: ${player?.losses ?? '–'}</span>`,
    `</div>`
  ].join('');

  const ratingRows = [
    `<div class="profile-summary">`,
    `<span>TrueSkill: ${player?.conservativeRating ?? '–'} <span class="stat-formula">(μ ${player?.mu ?? '–'} − ${player?.conservativeK ?? 1}σ)</span></span>`,
    `<span>μ: ${player?.mu ?? '–'}</span>`,
    `<span>σ: ${player?.sigma ?? '–'}</span>`,
    `</div>`
  ].join('');

  const history = player?.history || [];
  const conservativeK = player?.conservativeK ?? 3;

const historyRows = history.map((entry, idx) => {
  const outcomeClass = entry.outcome === 'win' ? 'outcome-win' : entry.outcome === 'loss' ? 'outcome-loss' : 'outcome-draw';
  const rosterId = `roster-detail-${idx}`;

  const rosterList = (team) => (team?.roster || [])
    .map((m) => `<li>${escapeHtml(m.displayName)} <span class="roster-rating">${Math.round(m.conservativeRating)} (${Math.round(m.mu)})</span></li>`)
    .join('');

  return `<tr>
    <td><button class="roster-toggle" data-target="${rosterId}" aria-expanded="false">▶</button></td>
    <td>${escapeHtml(entry.year ?? '–')}</td>
    <td>${escapeHtml(entry.tournament || '–')}</td>
    <td>${escapeHtml(entry.opponent || '–')}</td>
    <td class="${outcomeClass}">${escapeHtml(entry.outcome || '–')}</td>
    <td>${Math.round((entry.predictedWinProb ?? 0) * 100)}%</td>
    <td>${entry.ownTeam?.avgConservativeRating ?? '–'}</td>
    <td>${entry.opponentTeam?.avgConservativeRating ?? '–'}</td>
    <td>${entry.conservativeRating ?? '–'}</td>
    <td>${entry.mu ?? '–'}</td>
    <td>${entry.sigma ?? '–'}</td>
  </tr>
  <tr id="${rosterId}" class="roster-detail-row" hidden>
    <td colspan="11">
      <div class="roster-detail">
        <div>
          <strong>Your team - </strong> avg TrueSkill (μ): ${entry.ownTeam?.avgConservativeRating ?? '–'} (${entry.ownTeam?.avgMu ?? '-'})
          <ul>${rosterList(entry.ownTeam)}</ul>
        </div>
        <div>
          <strong>Opponent - </strong> avg TrueSkill (μ): ${entry.opponentTeam?.avgConservativeRating ?? '–'} (${entry.opponentTeam?.avgMu ?? '-'})
          <ul>${rosterList(entry.opponentTeam)}</ul>
        </div>
      </div>
    </td>
  </tr>`;
}).join('');

  playerProfileTitle.textContent = title;
  return [
    summaryRows,
    statsRows,
    ratingRows,
    buildChartHtml(history),
    historyRows
      ? `<table class="profile-history-table"><thead><tr><th>Match Details</th><th>Year</th><th>Tournament</th><th>Opponent</th><th>Result</th><th>Pred. Win %</th><th>Your Team Avg</th><th>Opp Avg</th><th>TrueSkill</th><th>μ</th><th>σ</th></tr></thead><tbody>${historyRows}</tbody></table>`
      : '<p>No match history available.</p>'
  ].join('');
}

// Returns an inline SVG (as a string, to fit the innerHTML-based render
// above) plotting mu over each game in order.

function buildChartHtml(history) {
  if (!history.length) {
    return '<p class="profile-chart-empty">No games recorded yet.</p>';
  }

  const width = 900, height = 260, padL = 45, padR = 15, padT = 15, padB = 30;
  const plotW = width - padL - padR, plotH = height - padT - padB;

  const points = history.map((h, i) => ({
    x: i + 1,
    trueskill: h.conservativeRating,
    mu: h.mu,
    sigma: h.sigma,
    outcome: h.outcome,
    opponent: h.opponent,
    year: h.year,
    tournament: h.tournament
  }));

  const xMax = points.length;
  const yMin = Math.min(...points.map((p) => p.trueskill));
  const yMax = Math.max(...points.map((p) => p.trueskill));
  const yPad = (yMax - yMin) * 0.05 || 1;

  const xScale = (x) => padL + ((x - 1) / Math.max(1, xMax - 1)) * plotW;
  const yScale = (y) => padT + plotH - ((y - (yMin - yPad)) / ((yMax + yPad) - (yMin - yPad))) * plotH;

  const trueskillPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x)} ${yScale(p.trueskill)}`).join(' ');

  const outcomeColor = { win: '#2e7d32', loss: '#c62828', draw: '#757575' };
  const dots = points.map((p) => `
    <circle cx="${xScale(p.x)}" cy="${yScale(p.trueskill)}" r="3.5" fill="${outcomeColor[p.outcome] || '#888'}">
      <title>${escapeHtml(`${p.year} ${p.tournament} vs ${p.opponent}: ${p.outcome} (TrueSkill = ${p.trueskill}, μ=${p.mu}, σ=${p.sigma})`)}</title>
    </circle>
  `).join('');

  const ticks = 4;
  const gridlines = Array.from({ length: ticks + 1 }, (_, i) => {
    const val = (yMin - yPad) + ((yMax + yPad) - (yMin - yPad)) * (i / ticks);
    const y = yScale(val);
    return `
      <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#eee" stroke-width="1" />
      <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${val.toFixed(1)}</text>
    `;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="profile-chart-svg">
      ${gridlines}
      <path d="${trueskillPath}" fill="none" stroke="#2b6cb0" stroke-width="2" />
      ${dots}
      <text x="${padL}" y="${height - 6}" font-size="10" fill="#888">Game 1</text>
      <text x="${width - padR}" y="${height - 6}" text-anchor="end" font-size="10" fill="#888">Game ${xMax}</text>
    </svg>
    <div class="profile-chart-legend">
      <span><i style="background:#2b6cb0"></i> TrueSkill (skill estimate)</span>
      <span><i style="background:#2e7d32"></i> win</span>
      <span><i style="background:#c62828"></i> loss</span>
      <span><i style="background:#757757"></i> draw</span>
    </div>
  `;
}

async function openPlayerProfile(identityKey) {
  if (!identityKey || !playerProfileModal) return;
  playerProfileModal.classList.add('open');
  playerProfileModal.setAttribute('aria-hidden', 'false');
  playerProfileContent.innerHTML = 'Loading…';

  try {
    const res = await fetch(`/api/player/${encodeURIComponent(identityKey)}`);
    if (!res.ok) throw new Error('Player profile not found');
    const player = await res.json();
    playerProfileContent.innerHTML = renderPlayerProfileContent(player);
  } catch (err) {
    playerProfileContent.innerHTML = `<p>${escapeHtml(err.message || 'Unable to load player profile')}</p>`;
  }
}

function renderPlayerCell(row) {
  const name = escapeHtml(row.group || row.displayName || '');
  const identityKey = row.identityKey || row._playerIdentityKey || null;
  if (identityKey) {
    return `<a href="#" class="player-link" data-player-key="${escapeHtml(identityKey)}">${name}</a>`;
  }
  if (row.profileUrl) {
    return `<a href="${escapeHtml(row.profileUrl)}" target="_blank" rel="noopener noreferrer" class="player-link" title="View on op.gg">${name}</a>`;
  }
  return name;
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('.player-link[data-player-key]');
  if (!link) return;
  event.preventDefault();
  openPlayerProfile(link.dataset.playerKey);
});

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('.roster-toggle');
  if (!toggle) return;
  const target = document.getElementById(toggle.dataset.target);
  if (!target) return;
  const isOpen = !target.hidden;
  target.hidden = isOpen;
  toggle.setAttribute('aria-expanded', String(!isOpen));
  toggle.textContent = isOpen ? '▶' : '▼';
});

playerProfileCloseBtn?.addEventListener('click', closePlayerProfile);
playerProfileModal?.addEventListener('click', (event) => {
  if (event.target.classList.contains('player-profile-backdrop') || event.target.dataset.close === 'true') {
    closePlayerProfile();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && playerProfileModal?.classList.contains('open')) {
    closePlayerProfile();
  }
});

// ==================== Column configuration ====================

const RANKINGS_COLUMNS = [
  { key: 'rank', label: '#', sortable: false, hideable: false, filterable: false },
  { key: 'group', label: 'Player', sortable: true, hideable: false, filterable: true, className: 'group-name', type: 'string' },
  { key: 'adjAvg', label: 'Adjusted Pick Value', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 2, className: 'adj-avg' },
  { key: 'n', label: 'n', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0 },
  { key: 'mean', label: 'Unadjusted Pick Value', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 2, defaultHidden: true },
  { key: 'sd', label: 'Std. Dev.', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 2, defaultHidden: true },
  { key: 'avgPickPercentile', label: 'Avg. Pick %', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0, percentage: true },
  { key: 'estPickOrder', label: 'Est. Pick Order', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 1 },
  { key: 'avgRankPercentile', label: 'Avg. Rank %', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0, percentage: true },
  { key: 'estRankOrder', label: 'Est. Rank Order', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 1 }
];

function formatCell(value, col) {
  if (value === null || value === undefined) return '–';
  if (col.type === 'number' && typeof value === 'number') {
    if (col.percentage) return (value * 100).toFixed(col.decimals) + '%';
    return value.toFixed(col.decimals);
  }
  return String(value);
}

// ==================== Generic sort helper ====================

function sortRows(rows, columns, sortColumn, sortDirection) {
  const col = columns.find((c) => c.key === sortColumn);
  const dir = sortDirection === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortColumn === 'latestGameTournament') {
      const parseTournamentValue = (row) => {
        const raw = String(row.latestGameTournament || '').trim();
        const match = raw.match(/^(winter|summer)\s*(\d{4})?$/i);
        if (!match) return { year: 0, seasonRank: 2, raw };
        return {
          year: parseInt(match[2] || '0', 10),
          seasonRank: match[1].toLowerCase() === 'winter' ? 0 : 1,
          raw
        };
      };
      const av = parseTournamentValue(a);
      const bv = parseTournamentValue(b);
      if (av.year !== bv.year) return dir * (bv.year - av.year);
      if (av.seasonRank !== bv.seasonRank) return av.seasonRank - bv.seasonRank;
      return dir * String(av.raw).localeCompare(String(bv.raw));
    }

    const av = col && typeof col.sortValue === 'function' ? col.sortValue(a) : a[sortColumn];
    const bv = col && typeof col.sortValue === 'function' ? col.sortValue(b) : b[sortColumn];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'number' || typeof bv === 'number') {
      return dir * (Number(av) - Number(bv));
    }
    if (col && col.type === 'string') return dir * String(av).localeCompare(String(bv));
    if (typeof av === 'string' || typeof bv === 'string') {
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

  if (filter.type === 'checkbox') {
    if (!filter.values || filter.values.length === 0) return true;
    return filter.values.includes(String(value ?? ''));
  }

  // Numeric filters: a row with no value can't satisfy any comparison
  if (value === null || value === undefined || Number.isNaN(value)) return false;

  if (filter.type === 'gt') return filter.value !== null && value > filter.value;
  if (filter.type === 'lt') return filter.value !== null && value < filter.value;
  if (filter.type === 'between') {
    if (filter.min === null || filter.max === null) return true;
    return value >= filter.min && value <= filter.max;
  }
  return true;
}

function applyColumnFilters(rows, columns, filterState) {
  const activeCols = columns.filter((c) => filterState[c.key]);
  if (activeCols.length === 0) return rows;
  return rows.filter((row) => activeCols.every((col) => rowPassesFilter(row, col, filterState[col.key])));
}

// Builds the inner HTML for a column's filter popover, based on its type.
function filterPopoverInnerHTML(col, rows, filterState) {
  if (col.type === 'string') {
    const values = [...new Set(rows
      .map((row) => row[col.key])
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== ''))]
      .map((value) => String(value));

    const orderedValues = values.sort((a, b) => {
      const parseTournamentValue = (value) => {
        const raw = String(value || '').trim();
        const match = raw.match(/^(winter|summer)\s*(\d{4})?$/i);
        if (!match) return { year: 0, seasonRank: 2, raw };
        return {
          year: parseInt(match[2] || '0', 10),
          seasonRank: match[1].toLowerCase() === 'summer' ? 0 : 1,
          raw
        };
      };
      const av = parseTournamentValue(a);
      const bv = parseTournamentValue(b);
      if (av.year !== bv.year) return bv.year - av.year;
      if (av.seasonRank !== bv.seasonRank) return av.seasonRank - bv.seasonRank;
      return String(av.raw).localeCompare(String(bv.raw));
    });

    const optionsHtml = orderedValues.length
      ? orderedValues.map((value) => {
          const checked = filterState[col.key]?.values?.includes(value) ? 'checked' : '';
          return `<label class="filter-option"><input type="checkbox" class="filter-checkbox-option" value="${escapeHtml(value)}" ${checked} /> ${escapeHtml(value)}</label>`;
        }).join('')
      : '<div class="filter-empty">No values</div>';

    return `
      <label>Select values</label>
      <div class="filter-checkbox-list">${optionsHtml}</div>
      <div class="filter-popover-actions">
        <button type="button" class="filter-clear-btn">Clear</button>
      </div>`;
  }
  const placeholder = col.percentage ? 'e.g. 50 for 50%' : 'value';
  const minPlaceholder = col.percentage ? 'min %' : 'min';
  const maxPlaceholder = col.percentage ? 'max %' : 'max';
  return `
    <label>Filter${col.percentage ? ' (enter as a percentage, e.g. 50 for 50%)' : ''}</label>
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
function wireFilterPopover(th, col, popover, filterState, onChange, closeAllPopovers) {
  const icon = th.querySelector('.filter-icon');

  icon.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = popover.classList.contains('hidden');
    closeAllPopovers();
    if (isHidden) {
      // Positioned fixed and appended to document.body (see buildHeaderCell)
      // rather than left inside the <th> — a table container with
      // overflow-x:auto has its overflow-y forced to 'auto' too (that's
      // just how the two properties interact per the CSS spec), which
      // clips anything extending past the table's own box. That's most
      // noticeable exactly when a filter has narrowed the table down to
      // just a few rows, shrinking the table's height below the
      // popover's. Fixed positioning + a body-level parent escapes that
      // clipping entirely, regardless of how tall the table currently is.
      const rect = th.getBoundingClientRect();
      popover.style.top = `${rect.bottom + 4}px`;
      popover.style.left = `${rect.left}px`;
      popover.classList.remove('hidden');
    }
  });
  popover.addEventListener('click', (e) => e.stopPropagation());

  function setActive(isActive) {
    icon.classList.toggle('active', isActive);
  }

  if (col.type === 'string') {
    const checkboxes = [...popover.querySelectorAll('.filter-checkbox-option')];
    const clearBtn = popover.querySelector('.filter-clear-btn');

    function updateFromCheckboxes() {
      const values = checkboxes.filter((box) => box.checked).map((box) => box.value);
      if (values.length > 0) {
        filterState[col.key] = { type: 'checkbox', values };
        setActive(true);
      } else {
        delete filterState[col.key];
        setActive(false);
      }
      onChange();
    }

    checkboxes.forEach((box) => box.addEventListener('change', updateFromCheckboxes));
    clearBtn.addEventListener('click', () => {
      checkboxes.forEach((box) => {
        box.checked = false;
      });
      delete filterState[col.key];
      setActive(false);
      onChange();
    });
  } else {
    const opSelect = popover.querySelector('.filter-op-select');
    const singleWrap = popover.querySelector('.filter-value-single');
    const betweenWrap = popover.querySelector('.filter-value-between');
    const valueInput = popover.querySelector('.filter-value-input');
    const minInput = popover.querySelector('.filter-min-input');
    const maxInput = popover.querySelector('.filter-max-input');
    const clearBtn = popover.querySelector('.filter-clear-btn');

    function updateFromInputs() {
      // Percentage columns display value*100 with a "%" suffix, but the
      // underlying stored value (and what rowPassesFilter compares
      // against) is still the raw 0-1 fraction — so a value typed here
      // (in percentage terms, matching what's displayed) needs converting
      // back down before it's stored as a filter threshold.
      const scale = col.percentage ? 0.01 : 1;
      const op = opSelect.value;
      if (op === 'between') {
        const min = minInput.value === '' ? null : parseFloat(minInput.value) * scale;
        const max = maxInput.value === '' ? null : parseFloat(maxInput.value) * scale;
        if (min !== null && max !== null) {
          filterState[col.key] = { type: 'between', min, max };
          setActive(true);
        } else {
          delete filterState[col.key];
          setActive(false);
        }
      } else {
        const val = valueInput.value === '' ? null : parseFloat(valueInput.value) * scale;
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

    opSelect.addEventListener('change', () => {
      const isBetween = opSelect.value === 'between';
      singleWrap.classList.toggle('hidden', isBetween);
      betweenWrap.classList.toggle('hidden', !isBetween);
      updateFromInputs();
    });
    valueInput.addEventListener('input', updateFromInputs);
    minInput.addEventListener('input', updateFromInputs);
    maxInput.addEventListener('input', updateFromInputs);
    clearBtn.addEventListener('click', () => {
      valueInput.value = '';
      minInput.value = '';
      maxInput.value = '';
      opSelect.value = 'gt';
      singleWrap.classList.remove('hidden');
      betweenWrap.classList.add('hidden');
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
document.addEventListener('click', () => {
  allPopovers.forEach((p) => p.classList.add('hidden'));
});
// Popovers escape the table's overflow box via fixed positioning (see
// wireFilterPopover), but that means scrolling anywhere would leave one
// open in the wrong spot if we didn't also close it — closing on any
// scroll is simpler and more robust than continuously repositioning.
// Capture:true is required since scroll events don't bubble, but they
// are still observable during the capture phase.
window.addEventListener(
  'scroll',
  () => allPopovers.forEach((p) => p.classList.add('hidden')),
  true
);

function closeAllPopovers() {
  allPopovers.forEach((p) => p.classList.add('hidden'));
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
function buildHeaderCell(col, sortColumn, sortDirection, filterState, onFilterChange, owner, rows) {
  const th = document.createElement('th');
  th.dataset.sort = col.key;
  if (!col.sortable) th.classList.add('not-sortable');
  if (col.key === sortColumn) th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

  const labelSpan = document.createElement('span');
  labelSpan.textContent = col.label;
  th.appendChild(labelSpan);

  if (col.filterable !== false) {
    const icon = document.createElement('span');
    icon.className = 'filter-icon';
    icon.textContent = '▾';
    if (filterState[col.key]) icon.classList.add('active');
    th.appendChild(icon);

    // Appended to document.body (not `th`) and positioned `fixed` so it
    // escapes the table container's overflow clipping entirely — see the
    // comment in wireFilterPopover for why that clipping happens.
    const popover = document.createElement('div');
    popover.className = 'filter-popover hidden';
    popover.dataset.owner = owner;
    popover.innerHTML = filterPopoverInnerHTML(col, rows, filterState);
    document.body.appendChild(popover);
    allPopovers.push(popover);

    wireFilterPopover(th, col, popover, filterState, onFilterChange, closeAllPopovers);
  }

  return th;
}

// ==================== Rankings tab state ====================

const statsHeaderRow = document.getElementById('statsHeaderRow');
const statsBody = document.getElementById('statsBody');
const columnsBtn = document.getElementById('columnsBtn');
const columnsPanel = document.getElementById('columnsPanel');
const totalNInput = document.getElementById('totalN');

let fetchDebounceTimer = null;
let urlDebounceTimer = null;
let latestStats = [];
let sortColumn = 'adjAvg';
let sortDirection = 'desc';
let hiddenColumns = new Set(RANKINGS_COLUMNS.filter((c) => c.defaultHidden).map((c) => c.key));
let rankingsFilters = {};
let totalN = 40;

// Columns visibility panel
RANKINGS_COLUMNS.filter((c) => c.hideable).forEach((col) => {
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !hiddenColumns.has(col.key);
  checkbox.dataset.col = col.key;
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) hiddenColumns.delete(col.key);
    else hiddenColumns.add(col.key);
    rebuildRankingsHeader();
    renderRankingsBody();
    scheduleUrlUpdate();
  });
  label.appendChild(checkbox);
  label.appendChild(document.createTextNode(col.label));
  columnsPanel.appendChild(label);
});

columnsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isHidden = columnsPanel.classList.contains('hidden');
  closeAllPopovers();
  columnsPanel.classList.toggle('hidden');
  if (isHidden) columnsPanel.classList.remove('hidden');
});
columnsPanel.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => columnsPanel.classList.add('hidden'));

function visibleRankingsColumns() {
  return RANKINGS_COLUMNS.filter((c) => !hiddenColumns.has(c.key));
}

function rebuildRankingsHeader() {
  removePopoversOwnedBy('rankings');
  statsHeaderRow.innerHTML = '';
  visibleRankingsColumns().forEach((col) => {
    const th = buildHeaderCell(col, sortColumn, sortDirection, rankingsFilters, () => {
      renderRankingsBody();
      scheduleUrlUpdate();
    }, 'rankings', latestStats);
    th.addEventListener('click', () => {
      if (!col.sortable) return;
      if (sortColumn === col.key) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = col.key;
        sortDirection = col.key === 'group' ? 'asc' : 'desc';
      }
      updateSortIndicators();
      renderRankingsBody();
      writeStateToURL();
    });
    statsHeaderRow.appendChild(th);
  });
}

function updateSortIndicators() {
  [...statsHeaderRow.children].forEach((th) => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === sortColumn) {
      th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPlayerCell(row) {
  const name = escapeHtml(row.group || row.displayName || '');
  const identityKey = row.identityKey || row._playerIdentityKey || null;
  if (identityKey) {
    return `<a href="#" class="player-link" data-player-key="${escapeHtml(identityKey)}" title="View profile">${name}</a>`;
  }
  if (row.profileUrl) {
    return `<a href="${escapeHtml(row.profileUrl)}" target="_blank" rel="noopener noreferrer" class="player-link" title="View on op.gg">${name}</a>`;
  }
  return name;
}

function renderRankingsBody() {
  const cols = visibleRankingsColumns();
  const filtered = applyColumnFilters(latestStats, RANKINGS_COLUMNS, rankingsFilters);
  const sorted = sortRows(filtered, RANKINGS_COLUMNS, sortColumn, sortDirection);

  if (sorted.length === 0) {
    statsBody.innerHTML = `<tr><td colspan="${cols.length}" class="empty">No players match the active filters</td></tr>`;
    return;
  }

  statsBody.innerHTML = sorted
    .map((row, i) => {
      const cells = cols
        .map((col) => {
          const cls = col.className ? ` class="${col.className}"` : col.key === 'rank' ? ' class="rank"' : '';
          if (col.key === 'group') {
            return `<td${cls}>${renderPlayerCell(row)}</td>`;
          }
          const val = col.key === 'rank' ? i + 1 : row[col.key];
          return `<td${cls}>${escapeHtml(formatCell(val, col))}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
}

let groupColName = 'Player'; // updated from /api/meta once loaded

async function loadMeta() {
  const res = await fetch('/api/meta');
  const meta = await res.json();
  groupColName = meta.groupCol;
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
    row.estPickOrder = row.avgPickPercentile === null ? null : row.avgPickPercentile * (totalN - 1) + 1;
    row.estRankOrder = row.avgRankPercentile === null ? null : row.avgRankPercentile * (numTeams - 1) + 1;
  });
}

async function fetchStats(risk, halfLife) {
  const res = await fetch(`/api/stats?risk=${risk}&halfLife=${halfLife}`);
  if (!res.ok) {
    statsBody.innerHTML = `<tr><td colspan="8">Error loading stats</td></tr>`;
    return;
  }
  const data = await res.json();
  latestStats = data.stats;
  applyTotalN();
  renderRankingsBody();
}

function currentSliderValues() {
  return {
    risk: 0.25,
    halfLife: 2
  };
}


// ==================== Tabs ====================

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

function setActiveTab(tabName) {
  tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabName));
  tabPanels.forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tabName}`));
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
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
      if (val === null || val === undefined || val === '') return true;
      sawValue = true;
      return !Number.isNaN(parseFloat(val)) && String(val).trim() !== '';
    });

    if (allNumericOrBlank && sawValue) {
      rows.forEach((row) => {
        const val = row[colName];
        row[colName] = val === null || val === undefined || val === '' ? null : parseFloat(val);
      });
    }
  });
}

// Whole-number columns (Pick Order, Year, id...) shouldn't display
// trailing ".00"; columns with genuine fractional values (Rank can be
// "3.5" from a tie) need at least 1 decimal place shown.
function inferDecimals(rows, colName) {
  for (const row of rows) {
    const v = row[colName];
    if (typeof v === 'number' && !Number.isInteger(v)) return 1;
  }
  return 0;
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
  defaultSortDirection = 'desc',
  emptyMessage = 'No rows match the active filters'
}) {
  const state = {
    data: [],
    sortColumn: defaultSortColumn,
    sortDirection: defaultSortDirection,
    hiddenColumns: new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)),
    filters: {}
  };

  columns.filter((c) => c.hideable).forEach((col) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !state.hiddenColumns.has(col.key);
    checkbox.dataset.col = col.key;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.hiddenColumns.delete(col.key);
      else state.hiddenColumns.add(col.key);
      rebuildHeader();
      renderBody();
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(col.label));
    columnsPanelEl.appendChild(label);
  });

  columnsBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = columnsPanelEl.classList.contains('hidden');
    closeAllPopovers();
    columnsPanelEl.classList.toggle('hidden');
    if (isHidden) columnsPanelEl.classList.remove('hidden');
  });
  columnsPanelEl.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => columnsPanelEl.classList.add('hidden'));

  function visibleColumns() {
    return columns.filter((c) => !state.hiddenColumns.has(c.key));
  }

  function updateSortIndicators() {
    [...headerRowEl.children].forEach((th) => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.sort === state.sortColumn) {
        th.classList.add(state.sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    });
  }

  function rebuildHeader() {
    removePopoversOwnedBy(ownerKey);
    headerRowEl.innerHTML = '';
    visibleColumns().forEach((col) => {
      const th = buildHeaderCell(col, state.sortColumn, state.sortDirection, state.filters, () => {
        renderBody();
      }, ownerKey, state.data);
      th.addEventListener('click', () => {
        if (!col.sortable) return;
        if (state.sortColumn === col.key) {
          state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortColumn = col.key;
          state.sortDirection = col.key === 'group' ? 'asc' : 'desc';
        }
        updateSortIndicators();
        renderBody();
      });
      headerRowEl.appendChild(th);
    });
  }

  function renderBody() {
    const cols = visibleColumns();
    const filtered = applyColumnFilters(state.data, columns, state.filters);
    const sorted = sortRows(filtered, columns, state.sortColumn, state.sortDirection);

    if (sorted.length === 0) {
      bodyEl.innerHTML = `<tr><td colspan="${cols.length}" class="empty">${escapeHtml(emptyMessage)}</td></tr>`;
      return;
    }

    bodyEl.innerHTML = sorted
      .map((row, i) => {
        const cells = cols
          .map((col) => {
            if (col.playerLink || col.key === 'group') {
              const playerRow = col.playerLink
                ? { group: row[col.key], profileUrl: row._playerProfileUrl, identityKey: row._playerIdentityKey }
                : row;
              return `<td class="group-name">${renderPlayerCell(playerRow)}</td>`;
            }
            const val = col.key === 'rank' ? i + 1 : row[col.key];
            const cls = col.className ? ` class="${col.className}"` : col.key === 'rank' ? ' class="rank"' : '';
            return `<td${cls}>${escapeHtml(formatCell(val, col))}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
  }

  rebuildHeader(); // header only depends on columns/hidden-state, safe to build immediately

  return {
    setData(newData) {
      state.data = newData;
      rebuildHeader();
      renderBody();
    }
  };
}


// ==================== trueskill tab ====================

const TRUESKILL_COLUMNS= [
  { key: 'rank', label: '#', sortable: false, hideable: false, filterable: false },
  { key: 'group', label: 'Player', sortable: true, hideable: false, filterable: true, className: 'group-name', type: 'string' },
  { key: 'latestGameTournament', label: 'Latest Tournament', sortable: true, hideable: true, filterable: true, type: 'string', sortValue: (row) => {
    const raw = String(row.latestGameTournament || '').trim();
    const match = raw.match(/^(winter|summer)\s*(\d{4})?$/i);
    if (!match) return 2_000_000;
    const seasonRank = match[1].toLowerCase() === 'summer' ? 0 : 1;
    const year = parseInt(match[2] || '0', 10);
    return seasonRank * 1_000_000 + year;
  } },
  { key: 'conservativeRating', label: 'TrueSkill', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 2, className: 'adj-avg' },
  { key: 'mu', label: 'μ', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 2, className: 'adj-avg' },
  { key: 'sigma', label: 'σ', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 2 },
  { key: 'games', label: 'Games', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0 },
  { key: 'tournaments', label: 'Tournaments', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0 },
  { key: 'wins', label: 'Wins', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0 },
  { key: 'losses', label: 'Losses', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0 },

];

const trueskillTable = createTabTable({
  columns: TRUESKILL_COLUMNS,
  headerRowEl: document.getElementById('trueskillHeaderRow'),
  bodyEl: document.getElementById('trueskillBody'),
  columnsBtnEl: document.getElementById('trueskillColumnsBtn'),
  columnsPanelEl: document.getElementById('trueskillColumnsPanel'),
  ownerKey: 'trueskill',
  defaultSortColumn: 'conservativeRating'
});

let trueskillLoaded = false;

async function loadtrueskillData(forceRefresh) {
  if (trueskillLoaded && !forceRefresh) return;
  const res = await fetch(`/api/trueskill`);
  const data = await res.json();
  document.getElementById('trueskill-fun-facts').innerHTML = renderFunFactsHtml(data.funFacts);
  trueskillTable.setData(data.players);
  trueskillLoaded = true;
}

tabButtons.forEach((btn) => {
  if (btn.dataset.tab === 'trueskill') {
    btn.addEventListener('click', () => loadtrueskillData(false));
  }
});


// ==================== Draft Data tab ====================
const DRAFT_DATA_COLUMNS = [
  { key: 'Tournament', label: 'Tournament', sortable: true, hideable: true, filterable: true, type: 'string' },
  { key: 'Year', label: 'Year', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0 },
  { key: 'Captain', label: 'Captain', sortable: true, hideable: true, filterable: true, type: 'string' },
  { key: 'Player', label: 'Player', sortable: true, hideable: false, filterable: true, type: 'string', playerLink: true, className: 'group-name' },
  { key: 'Pick Order', label: 'Pick Order', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0 },
  { key: 'Rank', label: 'Rank', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 1 }
];

const draftDataTable = createTabTable({
  columns: DRAFT_DATA_COLUMNS,
  headerRowEl: document.getElementById('draftHeaderRow'),
  bodyEl: document.getElementById('draftBody'),
  columnsBtnEl: document.getElementById('draftColumnsBtn'),
  columnsPanelEl: document.getElementById('draftColumnsPanel'),
  ownerKey: 'draftdata',
  defaultSortColumn: 'Year',
  emptyMessage: 'No rows match the active filters'
});

let draftDataLoaded = false;

async function loadDraftData() {
  if (draftDataLoaded) return;
  const res = await fetch('/api/raw');
  const data = await res.json();
  // Raw DB values arrive as strings (SQLite/CSV-sourced) -- coerceNumericColumns
  // is the same helper the old single Raw Data tab used, just called here
  // against this tab's own column list instead of a dynamically-discovered one.
  coerceNumericColumns(DRAFT_DATA_COLUMNS.map((c) => c.key), data.rows);
  draftDataTable.setData(data.rows);
  draftDataLoaded = true;
}

tabButtons.forEach((btn) => {
  if (btn.dataset.tab === 'draftdata') {
    btn.addEventListener('click', () => loadDraftData(false));
  }
});

document.getElementById('downloadDraftCsvBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = '/api/raw.csv';
  a.download = 'draft-data.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ==================== Match Data tab ====================

const MATCH_DATA_COLUMNS = [
  { key: 'year', label: 'Year', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0 },
  { key: 'tournament', label: 'Tournament', sortable: true, hideable: true, filterable: true, type: 'string' },
  { key: 'team1', label: 'Team 1', sortable: true, hideable: true, filterable: true, type: 'string' },
  { key: 'team2', label: 'Team 2', sortable: true, hideable: true, filterable: true, type: 'string' },
  { key: 'result', label: 'Result', sortable: true, hideable: true, filterable: true, type: 'string' },
  { key: 'csv_row_index', label: 'CSV Row', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0, defaultHidden: true }
];

const matchDataTable = createTabTable({
  columns: MATCH_DATA_COLUMNS,
  headerRowEl: document.getElementById('matchHeaderRow'),
  bodyEl: document.getElementById('matchBody'),
  columnsBtnEl: document.getElementById('matchColumnsBtn'),
  columnsPanelEl: document.getElementById('matchColumnsPanel'),
  ownerKey: 'matchdata',
  defaultSortColumn: 'year',
  emptyMessage: 'No rows match the active filters'
});
let matchDataLoaded = false;
async function loadMatchData() {
  if (matchDataLoaded) return;
  const res = await fetch('/api/raw-matches');
  const data = await res.json();
  coerceNumericColumns(MATCH_DATA_COLUMNS.map((c) => c.key), data.rows);
  matchDataTable.setData(data.rows);
  matchDataLoaded = true;
}

tabButtons.forEach((btn) => {
  if (btn.dataset.tab === 'matchdata') {
    btn.addEventListener('click', () => loadMatchData(false));
  }
});

document.getElementById('downloadMatchCsvBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = '/api/raw-matches.csv';
  a.download = 'match-data.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ==================== URL query param state ====================

function readStateFromURL() {
  const params = new URLSearchParams(window.location.search);

  const tab = params.get('tab') || 'trueskill';

  setActiveTab(tab);
  if (tab === 'draftdata') loadDraftData();
  if (tab === 'matchdata') loadMatchData();
}

function writeStateToURL() {
  const params = new URLSearchParams();
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'trueskill';
  params.set('tab', activeTab);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', newUrl);
}

function scheduleUrlUpdate() {
  clearTimeout(urlDebounceTimer);
  urlDebounceTimer = setTimeout(writeStateToURL, 150);
}

// ==================== Init ====================

(async function init() {
  readStateFromURL();
  await loadMeta();

  rebuildRankingsHeader();

  const { risk, halfLife } = currentSliderValues();
  await fetchStats(risk, halfLife);
  
  loadtrueskillData() 

  writeStateToURL();
})();
