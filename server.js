const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { loadIdentityMap, identityTablesExist } = require('./data/player-identity');
const { runFullSync } = require('./data/riot-sync');
const { startPeriodicSync } = require('./data/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Config: point these at your real table/columns when ready ----
const DB_PATH = path.join(__dirname, 'data', 'app.db');
const TABLE = 'rows';
const GROUP_COL = 'Player';
const YEAR_COL = 'Year';
const CAPTAIN_COL = 'Captain';
const PICK_ORDER_COL = 'Pick Order';
const RANK_COL = 'Rank';
const SD_MODE = 'sample'; // 'sample' (n-1, matches R's sd()) or 'population' (n)

// better-sqlite3 is synchronous and file-backed — no connection pool needed
// for a dataset this size. Opened once at startup and reused per request.
const db = new Database(DB_PATH, { fileMustExist: true });
db.pragma('journal_mode = WAL');

// Double-quote identifiers so reserved-word / space-containing column
// names (e.g. "Pick Order") don't break the SQL parser.
const q = (id) => `"${id}"`;

function getAllRows() {
  // Pick Value is *not* read from the CSV/DB — it's derived below from
  // Pick Order + Rank, the same way the original spreadsheet computed it
  // (Pick Percentile − Rank Percentile). This means the CSV only needs
  // Captain, Player, Pick Order, and Rank; Pick Value/Pick Percentile/
  // Rank Percentile columns, if present, are ignored entirely.
  //
  // CAST(NULL AS REAL) correctly stays NULL in SQLite (unlike
  // CAST('' AS REAL), which would silently become 0 — ingestion is
  // responsible for storing true NULLs for blank cells, not '').
  const stmt = db.prepare(
    `SELECT ${q(GROUP_COL)} AS groupVal,
            ${q(CAPTAIN_COL)} AS captain,
            CAST(${q(YEAR_COL)} AS INTEGER) AS year,
            CAST(${q(PICK_ORDER_COL)} AS REAL) AS pickOrder,
            CAST(${q(RANK_COL)} AS REAL) AS rank
     FROM ${q(TABLE)}
     WHERE ${q(GROUP_COL)} IS NOT NULL AND ${q(GROUP_COL)} != ''`
  );
  return stmt.all();
}

// Resolves each row's raw "Player" string (groupVal) to a canonical
// identity via the alias map built from player_aliases/players. This is
// what makes "Rlylost" and "rlylost" (or a genuine in-game rename) collapse
// into one ranked entry once they've been matched to the same PUUID — see
// data/player-identity.js and data/riot-sync.js.
//
// Falls back to using the raw string itself as the identity key when no
// alias mapping exists yet (before data/bootstrap-player-identities.js has
// been run, or for a name that's never been seen before) — so nothing
// breaks and every player still shows up, just ungrouped/unlinked until
// resolved.
function resolveIdentities(rows, identityMap) {
  return rows.map((row) => {
    const identity = identityMap.get(row.groupVal);
    return {
      ...row,
      identityKey: identity ? identity.identityKey : row.groupVal,
      displayName: identity ? identity.displayName : row.groupVal,
      profileUrl: identity ? identity.profileUrl : null,
      identified: identity ? identity.resolved : false
    };
  });
}

// Derives Pick Percentile, Rank Percentile, and Pick Value for every row,
// computed per-year so a season with a different number of picks/captains
// than another still normalizes correctly against ITS OWN totals, not the
// whole dataset's:
//   Pick Percentile = (Pick Order − 1) / (picks that year − 1)
//   Rank Percentile = (Rank − 1) / (captains that year − 1)
//   Pick Value       = Pick Percentile − Rank Percentile
// This per-year keying is what makes a season with fewer entrants (fewer
// picks and/or fewer captains than another season) normalize correctly —
// each season is scored against its own total, never against a count
// borrowed from a different season. A row missing Pick Order or Rank
// (e.g. a season without post-tournament placement data yet) gets all
// three fields as null — it still counts toward n, just not toward
// mean/sd/adjusted average or the percentile averages.
function attachDerivedFields(rows) {
  const perYear = {};
  for (const row of rows) {
    if (!Number.isFinite(row.year)) continue;
    if (!perYear[row.year]) perYear[row.year] = { pickCount: 0, captains: new Set() };
    perYear[row.year].pickCount += 1;
    if (row.captain) perYear[row.year].captains.add(row.captain);
  }

  return rows.map((row) => {
    const yearInfo = perYear[row.year];
    let pickPercentile = null;
    let rankPercentile = null;
    let value = null;

    if (
      yearInfo &&
      yearInfo.pickCount > 1 &&
      yearInfo.captains.size > 1 &&
      Number.isFinite(row.pickOrder) &&
      Number.isFinite(row.rank)
    ) {
      pickPercentile = (row.pickOrder - 1) / (yearInfo.pickCount - 1);
      rankPercentile = (row.rank - 1) / (yearInfo.captains.size - 1);
      value = pickPercentile - rankPercentile;
    }

    return { ...row, pickPercentile, rankPercentile, value };
  });
}

// Weighted average helper, tolerant of missing values in some entries —
// only entries where getVal() is a finite number contribute.
function weightedAvg(entries, getVal) {
  const valid = entries.filter((e) => Number.isFinite(getVal(e)));
  if (valid.length === 0) return null;
  const sumW = valid.reduce((a, e) => a + e.weight, 0);
  const sumWV = valid.reduce((a, e) => a + e.weight * getVal(e), 0);
  return sumWV / sumW;
}

// EWMA-style recency weighting. `halfLifeYears` = 0 means no decay (every
// season weighted equally). Age is measured against the most recent year
// present in `rows` — if a year has been excluded via the years filter,
// the age reference point shifts to whatever the newest INCLUDED season
// is, which is the intuitive behavior (recency is relative to what's
// actually being considered, not to data that's been excluded).
function computeGroupStats(rows, riskAversion, halfLifeYears) {
  const maxYear = rows.reduce(
    (m, r) => (Number.isFinite(r.year) && r.year > m ? r.year : m),
    -Infinity
  );

  const groups = {};
  for (const row of rows) {
    // Grouping by identityKey (not the raw Player string) is what merges
    // "Rlylost"/"rlylost"/a genuine in-game rename into one ranked entry
    // once they've been resolved to the same player — see
    // resolveIdentities() above. Unresolved names just use themselves as
    // the key, same as before this feature existed.
    const key = row.identityKey;
    const age = Number.isFinite(row.year) ? maxYear - row.year : 0;
    const weight = halfLifeYears > 0 ? Math.pow(0.5, age / halfLifeYears) : 1;

    // Every appearance is pushed regardless of whether Pick Value could be
    // derived — n and the percentile averages should reflect all known
    // data even for a season that's missing Pick Order or Rank.
    if (!groups[key]) {
      groups[key] = { entries: [], displayName: row.displayName, profileUrl: row.profileUrl, identified: row.identified };
    }
    groups[key].entries.push({
      value: row.value, // may be null — filtered out below where relevant
      weight,
      pickPercentile: row.pickPercentile,
      rankPercentile: row.rankPercentile
    });
  }

  const result = Object.values(groups).map(({ entries, displayName, profileUrl, identified }) => {
    const n = entries.length;
    const valueEntries = entries.filter((e) => Number.isFinite(e.value));

    let mean = null;
    let sd = null;
    let adjAvg = null;

    if (valueEntries.length > 0) {
      const sumW = valueEntries.reduce((a, e) => a + e.weight, 0);
      const sumWSq = valueEntries.reduce((a, e) => a + e.weight ** 2, 0);
      const weightedMean = valueEntries.reduce((a, e) => a + e.weight * e.value, 0) / sumW;

      const weightedSqDiffSum = valueEntries.reduce(
        (a, e) => a + e.weight * (e.value - weightedMean) ** 2,
        0
      );

      if (SD_MODE === 'sample') {
        // Reliability-weights unbiased variance; reduces to the normal
        // (n-1) sample variance when all weights are equal.
        const effDenom = sumW - sumWSq / sumW;
        sd = effDenom > 0 ? Math.sqrt(weightedSqDiffSum / effDenom) : 0;
      } else {
        sd = Math.sqrt(weightedSqDiffSum / sumW);
      }

      mean = weightedMean;
      adjAvg = weightedMean - riskAversion * sd;
    }

    const avgPickPercentile = weightedAvg(entries, (e) => e.pickPercentile);
    const avgRankPercentile = weightedAvg(entries, (e) => e.rankPercentile);

    return {
      group: displayName,
      profileUrl,
      identified,
      n,
      mean: mean === null ? null : round2(mean),
      sd: sd === null ? null : round2(sd),
      adjAvg: adjAvg === null ? null : round2(adjAvg),
      avgPickPercentile: avgPickPercentile === null ? null : round2(avgPickPercentile),
      avgRankPercentile: avgRankPercentile === null ? null : round2(avgRankPercentile)
    };
  });

  // nulls (players with no Pick-Value-bearing season yet) sort to the end
  result.sort((a, b) => {
    if (a.adjAvg === null) return 1;
    if (b.adjAvg === null) return -1;
    return b.adjAvg - a.adjAvg;
  });
  return result;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

// Parses a comma-separated list of years from a query param into a Set of
// integers, or null if not provided/empty (meaning "no filter, use all").
function parseYearsParam(raw) {
  if (!raw) return null;
  const years = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return years.length > 0 ? new Set(years) : null;
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/stats', (req, res) => {
  const riskAversion = parseFloat(req.query.risk);
  const halfLifeYears = parseFloat(req.query.halfLife);
  if (Number.isNaN(riskAversion)) {
    return res.status(400).json({ error: 'risk query param must be a number' });
  }
  if (Number.isNaN(halfLifeYears) || halfLifeYears < 0) {
    return res.status(400).json({ error: 'halfLife query param must be a non-negative number' });
  }

  const yearsFilter = parseYearsParam(req.query.years);
  let rows = getAllRows();
  if (yearsFilter) {
    rows = rows.filter((r) => yearsFilter.has(r.year));
  }

  const identityMap = loadIdentityMap(db);
  const withIdentity = resolveIdentities(rows, identityMap);
  const derived = attachDerivedFields(withIdentity);
  const stats = computeGroupStats(derived, riskAversion, halfLifeYears);
  res.json({ riskAversion, halfLifeYears, stats });
});

app.get('/api/meta', (req, res) => {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${q(TABLE)}`).get();
  const { maxYear } = db
    .prepare(`SELECT MAX(CAST(${q(YEAR_COL)} AS INTEGER)) AS maxYear FROM ${q(TABLE)}`)
    .get();
  const years = db
    .prepare(`SELECT DISTINCT CAST(${q(YEAR_COL)} AS INTEGER) AS y FROM ${q(TABLE)} ORDER BY y`)
    .all()
    .map((r) => r.y);
  res.json({
    rowCount: n,
    groupCol: GROUP_COL,
    valueCol: 'Pick Value (computed)',
    yearCol: YEAR_COL,
    mostRecentYear: maxYear,
    years,
    sdMode: SD_MODE
  });
});

// Column list is read from the actual table schema (not hardcoded) so
// this works regardless of what columns your CSV happens to have — the
// only column deliberately excluded is "id", since it's an internal key
// with no meaning to someone looking at the raw draft data.
function getRawColumns() {
  return db
    .prepare(`PRAGMA table_info(${q(TABLE)})`)
    .all()
    .map((c) => c.name)
    .filter((name) => name !== 'id');
}

function getRawRows() {
  const columns = getRawColumns();
  const selectCols = columns.map(q).join(', ');
  const rows = db.prepare(`SELECT ${selectCols} FROM ${q(TABLE)}`).all();
  return { columns, rows };
}

app.get('/api/raw', (req, res) => {
  const { columns, rows } = getRawRows();
  // Enriches each row with a profile URL for its Player value, same
  // identity resolution the Rankings tab uses — so raw data gets the
  // same op.gg linking, just without collapsing rows by identity (this
  // tab is meant to show the literal underlying data, one row per
  // appearance, not aggregated).
  const identityMap = loadIdentityMap(db);
  const enriched = rows.map((row) => {
    const identity = identityMap.get(row[GROUP_COL]);
    return { ...row, _playerProfileUrl: identity ? identity.profileUrl : null };
  });
  res.json({ columns, rows: enriched });
});

// CSV-escapes a single field: wraps in quotes if it contains a comma,
// quote, or newline, doubling any internal quotes.
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

app.get('/api/raw.csv', (req, res) => {
  const { columns, rows } = getRawRows();
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  }
  const csv = lines.join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="draft-data.csv"');
  res.send(csv);
});

// ---- Identity/Riot-sync admin endpoints ----
// Gated by ADMIN_TOKEN if you set one (recommended for anything beyond a
// local/personal deployment) — if unset, these are open, matching the rest
// of this app's no-auth posture for a personal self-hosted tool. Set
// ADMIN_TOKEN and send it as the X-Admin-Token header to lock these down.
function checkAdminAuth(req, res) {
  const configured = process.env.ADMIN_TOKEN;
  if (!configured) return true; // no token configured — open, personal-tool default
  if (req.get('X-Admin-Token') === configured) return true;
  res.status(401).json({ error: 'Missing or incorrect X-Admin-Token header' });
  return false;
}

app.get('/api/identity/status', (req, res) => {
  if (!identityTablesExist(db)) {
    return res.json({
      bootstrapped: false,
      message: 'Identity tables not created yet — run node data/bootstrap-player-identities.js'
    });
  }
  const totalPlayers = db.prepare('SELECT COUNT(*) c FROM players').get().c;
  const resolved = db.prepare('SELECT COUNT(*) c FROM players WHERE puuid IS NOT NULL').get().c;
  const pending = db.prepare('SELECT COUNT(*) c FROM pending_lookups').get().c;
  const pendingReady = db
    .prepare("SELECT COUNT(*) c FROM pending_lookups WHERE game_name IS NOT NULL AND game_name != ''")
    .get().c;
  res.json({
    bootstrapped: true,
    totalPlayers,
    resolved,
    unresolved: totalPlayers - resolved,
    pendingLookups: pending,
    pendingReadyToResolve: pendingReady,
    pendingMissingTag: pending - pendingReady
  });
});

app.post('/api/identity/sync', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  if (!process.env.RIOT_API_KEY) {
    return res.status(400).json({ error: 'RIOT_API_KEY is not set on the server' });
  }
  try {
    const result = await runFullSync(db);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});

// Automatic 14-day Riot sync — no-ops if RIOT_API_KEY isn't set or the
// identity tables haven't been bootstrapped yet. See data/scheduler.js.
startPeriodicSync(db);
