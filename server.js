const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Config: point these at your real table/columns when ready ----
const DB_PATH = path.join(__dirname, 'data', 'app.db');
const TABLE = 'rows';
const GROUP_COL = 'Player';
const VALUE_COL = 'Pick Value';
const YEAR_COL = 'Year';
const SD_MODE = 'sample'; // 'sample' (n-1, matches R's sd()) or 'population' (n)

// better-sqlite3 is synchronous and file-backed — no connection pool needed
// for a dataset this size. Opened once at startup and reused per request.
const db = new Database(DB_PATH, { fileMustExist: true });
db.pragma('journal_mode = WAL');

// Double-quote identifiers so reserved-word / space-containing column
// names (e.g. "Pick Value") don't break the SQL parser.
const q = (id) => `"${id}"`;

function getAllRows() {
  // value/year stored as TEXT (CSV import writes strings); CAST here so
  // downstream math is on numbers, not strings.
  const stmt = db.prepare(
    `SELECT ${q(GROUP_COL)} AS groupVal,
            CAST(${q(VALUE_COL)} AS REAL) AS value,
            CAST(${q(YEAR_COL)} AS INTEGER) AS year
     FROM ${q(TABLE)}
     WHERE ${q(VALUE_COL)} IS NOT NULL AND ${q(VALUE_COL)} != ''`
  );
  return stmt.all();
}

// EWMA-style recency weighting. `halfLifeYears` = 0 means no decay (every
// season weighted equally). Age is measured against the most recent year
// present in the dataset, so this stays correct as new seasons are added.
function computeGroupStats(rows, riskAversion, halfLifeYears) {
  const maxYear = rows.reduce((m, r) => (r.year > m ? r.year : m), -Infinity);

  const groups = {};
  for (const row of rows) {
    const key = row.groupVal;
    const val = row.value;
    if (val === null || Number.isNaN(val)) continue;

    const age = Number.isFinite(row.year) ? maxYear - row.year : 0;
    const weight = halfLifeYears > 0 ? Math.pow(0.5, age / halfLifeYears) : 1;

    if (!groups[key]) groups[key] = [];
    groups[key].push({ value: val, weight });
  }

  const result = Object.entries(groups).map(([group, entries]) => {
    const n = entries.length;
    const sumW = entries.reduce((a, e) => a + e.weight, 0);
    const sumWSq = entries.reduce((a, e) => a + e.weight ** 2, 0);
    const weightedMean = entries.reduce((a, e) => a + e.weight * e.value, 0) / sumW;

    const weightedSqDiffSum = entries.reduce(
      (a, e) => a + e.weight * (e.value - weightedMean) ** 2,
      0
    );

    let sd;
    if (SD_MODE === 'sample') {
      // Reliability-weights unbiased variance; reduces to the normal
      // (n-1) sample variance when all weights are equal.
      const effDenom = sumW - sumWSq / sumW;
      sd = effDenom > 0 ? Math.sqrt(weightedSqDiffSum / effDenom) : 0;
    } else {
      sd = Math.sqrt(weightedSqDiffSum / sumW);
    }

    const adjAvg = weightedMean - riskAversion * sd;

    return {
      group,
      n,
      mean: round2(weightedMean),
      sd: round2(sd),
      adjAvg: round2(adjAvg)
    };
  });

  result.sort((a, b) => b.adjAvg - a.adjAvg);
  return result;
}

function round2(x) {
  return Math.round(x * 100) / 100;
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
  const rows = getAllRows();
  const stats = computeGroupStats(rows, riskAversion, halfLifeYears);
  res.json({ riskAversion, halfLifeYears, stats });
});

app.get('/api/meta', (req, res) => {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${q(TABLE)}`).get();
  const { maxYear } = db
    .prepare(`SELECT MAX(CAST(${q(YEAR_COL)} AS INTEGER)) AS maxYear FROM ${q(TABLE)}`)
    .get();
  res.json({
    rowCount: n,
    groupCol: GROUP_COL,
    valueCol: VALUE_COL,
    yearCol: YEAR_COL,
    mostRecentYear: maxYear,
    sdMode: SD_MODE
  });
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
