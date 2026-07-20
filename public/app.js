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
    const av = a[sortColumn];
    const bv = b[sortColumn];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
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

  if (filter.type === 'regex') {
    if (!filter.pattern) return true;
    let re;
    try {
      re = new RegExp(filter.pattern, 'i');
    } catch {
      return true; // invalid regex mid-type — don't hide everything while they're typing
    }
    return re.test(String(value ?? ''));
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
function filterPopoverInnerHTML(col) {
  if (col.type === 'string') {
    return `
      <label>Regex match</label>
      <input type="text" class="filter-regex-input" placeholder="e.g. ^Team|Xemacs" />
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
    const input = popover.querySelector('.filter-regex-input');
    const clearBtn = popover.querySelector('.filter-clear-btn');
    input.addEventListener('input', () => {
      const pattern = input.value.trim();
      let valid = true;
      try {
        if (pattern) new RegExp(pattern);
      } catch {
        valid = false;
      }
      input.classList.toggle('invalid', !valid);
      if (!pattern) {
        delete filterState[col.key];
        setActive(false);
      } else if (valid) {
        filterState[col.key] = { type: 'regex', pattern };
        setActive(true);
      }
      onChange();
    });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      input.classList.remove('invalid');
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
function buildHeaderCell(col, sortColumn, sortDirection, filterState, onFilterChange, owner) {
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
    popover.innerHTML = filterPopoverInnerHTML(col);
    document.body.appendChild(popover);
    allPopovers.push(popover);

    wireFilterPopover(th, col, popover, filterState, onFilterChange, closeAllPopovers);
  }

  return th;
}

// ==================== Rankings tab state ====================

const riskSlider = document.getElementById('risk');
const riskValueLabel = document.getElementById('riskValue');
const halfLifeSlider = document.getElementById('halfLife');
const halfLifeValueLabel = document.getElementById('halfLifeValue');
const statsHeaderRow = document.getElementById('statsHeaderRow');
const statsBody = document.getElementById('statsBody');
const columnsBtn = document.getElementById('columnsBtn');
const columnsPanel = document.getElementById('columnsPanel');
const yearCheckboxesEl = document.getElementById('yearCheckboxes');
const totalNInput = document.getElementById('totalN');

const RISK_MIN = parseFloat(riskSlider.min);
const RISK_MAX = parseFloat(riskSlider.max);
const HALFLIFE_MIN = parseFloat(halfLifeSlider.min);
const HALFLIFE_MAX = parseFloat(halfLifeSlider.max);

let fetchDebounceTimer = null;
let urlDebounceTimer = null;
let latestStats = [];
let sortColumn = 'adjAvg';
let sortDirection = 'desc';
let hiddenColumns = new Set(RANKINGS_COLUMNS.filter((c) => c.defaultHidden).map((c) => c.key));
let rankingsFilters = {};
let allYears = [];
let selectedYears = new Set();
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
    }, 'rankings');
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
  const name = escapeHtml(row.group);
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
  allYears = meta.years;
  if (selectedYears.size === 0) {
    // no explicit URL selection was made — default to all years
    allYears.forEach((y) => selectedYears.add(y));
  }
  renderYearCheckboxes();
}

function renderYearCheckboxes() {
  yearCheckboxesEl.innerHTML = '';
  allYears.forEach((year) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedYears.has(year);
    checkbox.dataset.year = year;
    if (checkbox.checked) label.classList.add('checked');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedYears.add(year);
      else selectedYears.delete(year);
      label.classList.toggle('checked', checkbox.checked);
      scheduleFetch();
      scheduleUrlUpdate();

      // ROI/Tiers data depends on the years filter too — invalidate the
      // lazy-load cache, and if one of those tabs is the one currently
      // visible, refetch immediately rather than waiting for the next
      // time it's opened.
      roiLoaded = false;
      tiersLoaded = false;
      const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
      if (activeTab === 'roi') loadROIData(true);
      if (activeTab === 'tiers') loadTiersData(true);
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(String(year)));
    yearCheckboxesEl.appendChild(label);
  });
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
  const yearsParam = allYears.length > 0 && selectedYears.size < allYears.length
    ? `&years=${[...selectedYears].join(',')}`
    : '';
  const res = await fetch(`/api/stats?risk=${risk}&halfLife=${halfLife}${yearsParam}`);
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
    risk: parseFloat(riskSlider.value),
    halfLife: parseFloat(halfLifeSlider.value)
  };
}

function scheduleFetch() {
  clearTimeout(fetchDebounceTimer);
  fetchDebounceTimer = setTimeout(() => {
    const { risk, halfLife } = currentSliderValues();
    fetchStats(risk, halfLife);
  }, 80);
}

riskSlider.addEventListener('input', () => {
  riskValueLabel.textContent = parseFloat(riskSlider.value).toFixed(2);
  scheduleFetch();
  scheduleUrlUpdate();
});

halfLifeSlider.addEventListener('input', () => {
  const val = parseFloat(halfLifeSlider.value);
  halfLifeValueLabel.textContent = val === 0 ? '0 (off)' : val.toFixed(1);
  scheduleFetch();
  scheduleUrlUpdate();
});

totalNInput.addEventListener('input', () => {
  const val = parseInt(totalNInput.value, 10);
  if (!Number.isFinite(val) || val < 2) return; // ignore invalid/incomplete typing
  totalN = val;
  applyTotalN();
  renderRankingsBody();
  scheduleUrlUpdate();
});

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

// ==================== Raw Data tab ====================

const rawHeaderRow = document.getElementById('rawHeaderRow');
const rawBody = document.getElementById('rawBody');
const rawRowCountEl = document.getElementById('rawRowCount');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');

let rawColumns = [];
let rawRows = [];
let rawSortColumn = null;
let rawSortDirection = 'asc';
let rawLoaded = false;
let rawFilters = {};

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

function rawColumnConfigs() {
  return rawColumns.map((name) => ({
    key: name,
    label: name,
    sortable: true,
    filterable: true,
    type: rawRows.some((r) => typeof r[name] === 'number') ? 'number' : 'string',
    decimals: inferDecimals(rawRows, name)
  }));
}

function rebuildRawHeader() {
  removePopoversOwnedBy('raw');
  rawHeaderRow.innerHTML = '';
  const cols = rawColumnConfigs();
  cols.forEach((col) => {
    const th = buildHeaderCell(col, rawSortColumn, rawSortDirection, rawFilters, () => {
      renderRawBody();
    }, 'raw');
    th.addEventListener('click', () => {
      if (rawSortColumn === col.key) {
        rawSortDirection = rawSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        rawSortColumn = col.key;
        rawSortDirection = 'asc';
      }
      [...rawHeaderRow.children].forEach((h) => {
        h.classList.remove('sorted-asc', 'sorted-desc');
        if (h.dataset.sort === rawSortColumn) {
          h.classList.add(rawSortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
      });
      renderRawBody();
    });
    rawHeaderRow.appendChild(th);
  });
}

function renderRawBody() {
  const cols = rawColumnConfigs();
  const filtered = applyColumnFilters(rawRows, cols, rawFilters);
  const sorted = rawSortColumn ? sortRows(filtered, cols, rawSortColumn, rawSortDirection) : filtered;

  if (sorted.length === 0) {
    rawBody.innerHTML = `<tr><td colspan="${cols.length}" class="empty">No rows match the active filters</td></tr>`;
    return;
  }

  rawBody.innerHTML = sorted
    .map((row) => {
      const cells = cols
        .map((col) => {
          if (col.key === groupColName) {
            return `<td>${renderPlayerCell({ group: row[col.key], profileUrl: row._playerProfileUrl })}</td>`;
          }
          const val = row[col.key];
          return `<td>${val === null || val === undefined ? '–' : escapeHtml(val)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
}

downloadCsvBtn.addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = '/api/raw.csv';
  a.download = 'draft-data.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

async function loadRawData() {
  if (rawLoaded) return; // fetch once, lazily, the first time the tab is opened
  const res = await fetch('/api/raw');
  const data = await res.json();
  rawColumns = data.columns;
  rawRows = data.rows;
  coerceNumericColumns(rawColumns, rawRows);
  rawRowCountEl.textContent = rawRows.length;
  rawLoaded = true;
  rebuildRawHeader();
  renderRawBody();
}

tabButtons.forEach((btn) => {
  if (btn.dataset.tab === 'rawdata') {
    btn.addEventListener('click', loadRawData);
  }
});

// ==================== Reusable sortable/filterable/column-toggleable table ====================
// Powers the ROI and Tiers tabs below, and is a reasonable starting
// point for any future tab that's basically "a table of players/rows
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
      }, ownerKey);
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
            if (col.key === 'group') {
              return `<td class="group-name">${renderPlayerCell(row)}</td>`;
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
      renderBody();
    }
  };
}

// ==================== Expected ROI tab ====================

const ROI_COLUMNS = [
  { key: 'rank', label: '#', sortable: false, hideable: false, filterable: false },
  { key: 'group', label: 'Player', sortable: true, hideable: false, filterable: true, className: 'group-name', type: 'string' },
  { key: 'roiValue', label: 'ROI Value', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 2, className: 'adj-avg' },
  { key: 'n', label: 'n', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0 },
  { key: 'avgPickOrder', label: 'Avg. Pick Order', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 1 },
  { key: 'avgRank', label: 'Avg. Rank', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 1 }
];

const roiTable = createTabTable({
  columns: ROI_COLUMNS,
  headerRowEl: document.getElementById('roiHeaderRow'),
  bodyEl: document.getElementById('roiBody'),
  columnsBtnEl: document.getElementById('roiColumnsBtn'),
  columnsPanelEl: document.getElementById('roiColumnsPanel'),
  ownerKey: 'roi',
  defaultSortColumn: 'roiValue'
});

let roiLoaded = false;
let roiCurveData = [];

function renderROIChart() {
  const container = document.getElementById('roiChartContainer');
  if (roiCurveData.length === 0) {
    container.innerHTML = '<p class="chart-empty">No data to chart for the currently included years.</p>';
    return;
  }

  const width = 760;
  const height = 320;
  const padL = 56;
  const padR = 20;
  const padT = 16;
  const padB = 40;

  const pickOrders = roiCurveData.map((c) => c.pickOrder);
  const ranks = roiCurveData.map((c) => c.expectedRank);
  const minPO = Math.min(...pickOrders);
  const maxPO = Math.max(...pickOrders);
  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);
  const rankSpan = maxRank - minRank || 1;
  const poSpan = maxPO - minPO || 1;

  const xScale = (po) => padL + ((po - minPO) / poSpan) * (width - padL - padR);
  // Lower rank = better placement, mapped to the TOP of the chart (smaller
  // y-pixel), which is the intuitive reading for "better is higher up".
  const yScale = (rank) => padT + ((rank - minRank) / rankSpan) * (height - padT - padB);

  const points = roiCurveData.map((c) => `${xScale(c.pickOrder).toFixed(1)},${yScale(c.expectedRank).toFixed(1)}`).join(' ');

  const circles = roiCurveData
    .map((c) => {
      const cx = xScale(c.pickOrder).toFixed(1);
      const cy = yScale(c.expectedRank).toFixed(1);
      return `<circle cx="${cx}" cy="${cy}" r="3" style="fill:var(--accent)">
        <title>Pick ${c.pickOrder}: avg. rank ${c.expectedRank} (n=${c.n})</title>
      </circle>`;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="roi-chart-svg" role="img" aria-label="Expected rank by pick order">
      <line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" style="stroke:var(--border)" />
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" style="stroke:var(--border)" />
      <polyline points="${points}" fill="none" style="stroke:var(--accent)" stroke-width="2" />
      ${circles}
      <text x="${padL}" y="${height - padB + 22}" font-size="11" style="fill:var(--muted)">Pick ${minPO}</text>
      <text x="${width - padR}" y="${height - padB + 22}" font-size="11" style="fill:var(--muted)" text-anchor="end">Pick ${maxPO}</text>
      <text x="${padL - 8}" y="${padT + 4}" font-size="11" style="fill:var(--muted)" text-anchor="end">${minRank.toFixed(1)} (best)</text>
      <text x="${padL - 8}" y="${height - padB}" font-size="11" style="fill:var(--muted)" text-anchor="end">${maxRank.toFixed(1)} (worst)</text>
      <text x="${(padL + width - padR) / 2}" y="${height - 6}" font-size="12" style="fill:var(--text)" text-anchor="middle">Pick Order</text>
      <text x="16" y="${(padT + height - padB) / 2}" font-size="12" style="fill:var(--text)" text-anchor="middle" transform="rotate(-90 16 ${(padT + height - padB) / 2})">Expected Rank</text>
    </svg>`;
}

async function loadROIData(forceRefresh) {
  if (roiLoaded && !forceRefresh) return;
  const yearsParam = allYears.length > 0 && selectedYears.size < allYears.length
    ? `?years=${[...selectedYears].join(',')}`
    : '';
  const res = await fetch(`/api/roi${yearsParam}`);
  const data = await res.json();
  roiCurveData = data.curve;
  roiTable.setData(data.players);
  renderROIChart();
  roiLoaded = true;
}

tabButtons.forEach((btn) => {
  if (btn.dataset.tab === 'roi') {
    btn.addEventListener('click', () => loadROIData(false));
  }
});

// ==================== Tiers tab ====================

const TIERS_COLUMNS = [
  { key: 'rank', label: '#', sortable: false, hideable: false, filterable: false },
  { key: 'group', label: 'Player', sortable: true, hideable: false, filterable: true, className: 'group-name', type: 'string' },
  { key: 'zScore', label: 'Z-Score', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 2, className: 'adj-avg' },
  { key: 'n', label: 'n', sortable: true, hideable: true, filterable: true, type: 'number', decimals: 0 }
];

const tiersTable = createTabTable({
  columns: TIERS_COLUMNS,
  headerRowEl: document.getElementById('tiersHeaderRow'),
  bodyEl: document.getElementById('tiersBody'),
  columnsBtnEl: document.getElementById('tiersColumnsBtn'),
  columnsPanelEl: document.getElementById('tiersColumnsPanel'),
  ownerKey: 'tiers',
  defaultSortColumn: 'zScore'
});

let tiersLoaded = false;
const tiersOverallStatsLine = document.getElementById('tiersOverallStatsLine');

async function loadTiersData(forceRefresh) {
  if (tiersLoaded && !forceRefresh) return;
  const yearsParam = allYears.length > 0 && selectedYears.size < allYears.length
    ? `?years=${[...selectedYears].join(',')}`
    : '';
  const res = await fetch(`/api/tiers${yearsParam}`);
  const data = await res.json();
  const { n, avgRank, sd } = data.overallStats;
  tiersOverallStatsLine.textContent = n > 0
    ? `Based on ${n} appearances across the included years \u00b7 overall average placement ${avgRank} \u00b7 std. dev ${sd}`
    : 'No data for the currently included years.';
  tiersTable.setData(data.players);
  tiersLoaded = true;
}

tabButtons.forEach((btn) => {
  if (btn.dataset.tab === 'tiers') {
    btn.addEventListener('click', () => loadTiersData(false));
  }
});

// ==================== URL query param state ====================
// ?risk=&halfLife=&sort=&dir=&hidden=&tab=&years=

function readStateFromURL() {
  const params = new URLSearchParams(window.location.search);

  const risk = parseFloat(params.get('risk'));
  const halfLife = parseFloat(params.get('halfLife'));
  const sort = params.get('sort');
  const dir = params.get('dir');
  const hidden = params.get('hidden');
  const tab = params.get('tab');
  const years = params.get('years');
  const n = parseInt(params.get('totalN'), 10);

  if (!Number.isNaN(risk) && risk >= RISK_MIN && risk <= RISK_MAX) {
    riskSlider.value = risk;
  }
  if (!Number.isNaN(halfLife) && halfLife >= HALFLIFE_MIN && halfLife <= HALFLIFE_MAX) {
    halfLifeSlider.value = halfLife;
  }
  const validSortKeys = RANKINGS_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
  if (sort && validSortKeys.includes(sort)) {
    sortColumn = sort;
  }
  if (dir === 'asc' || dir === 'desc') {
    sortDirection = dir;
  }
  if (hidden !== null) {
    hiddenColumns = new Set();
    hidden.split(',').filter(Boolean).forEach((key) => {
      if (RANKINGS_COLUMNS.some((c) => c.key === key && c.hideable)) hiddenColumns.add(key);
    });
  }
  if (years) {
    years.split(',').map((y) => parseInt(y, 10)).filter((y) => Number.isFinite(y)).forEach((y) => selectedYears.add(y));
  }
  if (Number.isFinite(n) && n >= 2) {
    totalN = n;
    totalNInput.value = n;
  }
  if (tab === 'rawdata' || tab === 'rankings') {
    setActiveTab(tab);
    if (tab === 'rawdata') loadRawData();
  }
}

function writeStateToURL() {
  const params = new URLSearchParams();
  params.set('risk', parseFloat(riskSlider.value).toFixed(2));
  params.set('halfLife', parseFloat(halfLifeSlider.value).toFixed(1));
  params.set('sort', sortColumn);
  params.set('dir', sortDirection);
  params.set('hidden', [...hiddenColumns].join(','));
  params.set('totalN', totalN);
  if (allYears.length > 0 && selectedYears.size < allYears.length) {
    params.set('years', [...selectedYears].sort((a, b) => a - b).join(','));
  }
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'rankings';
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

  riskValueLabel.textContent = parseFloat(riskSlider.value).toFixed(2);
  const initHalfLife = parseFloat(halfLifeSlider.value);
  halfLifeValueLabel.textContent = initHalfLife === 0 ? '0 (off)' : initHalfLife.toFixed(1);

  RANKINGS_COLUMNS.filter((c) => c.hideable).forEach((col) => {
    const checkbox = columnsPanel.querySelector(`input[data-col="${col.key}"]`);
    if (checkbox) checkbox.checked = !hiddenColumns.has(col.key);
  });

  rebuildRankingsHeader();

  const { risk, halfLife } = currentSliderValues();
  await fetchStats(risk, halfLife);

  writeStateToURL();
})();
