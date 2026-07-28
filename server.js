const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const {
  loadIdentityMap,
  identityTablesExist,
} = require("./src/lib/player-identity");
const { runFullSync } = require("./src/lib/riot-sync");
const { startPeriodicSync } = require("./src/scripts/scheduler");
const { computeTrueSkillFromMatches } = require("./src/lib/trueskill-matches");

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Config: point these at your real table/columns when ready ----
const DB_PATH = path.join(__dirname, "data", "app.db");
const TABLE = "rows";
const GROUP_COL = "Player";
const YEAR_COL = "Year";
const CAPTAIN_COL = "Captain";
const PICK_ORDER_COL = "Pick Order";
const RANK_COL = "Rank";
const SD_MODE = "sample"; // 'sample' (n-1, matches R's sd()) or 'population' (n)

// better-sqlite3 is synchronous and file-backed — no connection pool needed
// for a dataset this size. Opened once at startup and reused per request.
const db = new Database(DB_PATH, { fileMustExist: true });
db.pragma("journal_mode = WAL");

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
            "Tournament" AS tournament,
            CAST(${q(YEAR_COL)} AS INTEGER) AS year,
            CAST(${q(PICK_ORDER_COL)} AS REAL) AS pickOrder,
            CAST(${q(RANK_COL)} AS REAL) AS rank
    FROM ${q(TABLE)}
    WHERE ${q(GROUP_COL)} IS NOT NULL AND ${q(GROUP_COL)} != ''`,
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
      identified: identity ? identity.resolved : false,
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
  const perGroup = {};
  for (const row of rows) {
    if (!Number.isFinite(row.year)) continue;
    const groupKey = `${row.year}::${row.tournament || "Summer"}`;
    if (!perGroup[groupKey])
      perGroup[groupKey] = { pickCount: 0, captains: new Set() };
    perGroup[groupKey].pickCount += 1;
    if (row.captain) perGroup[groupKey].captains.add(row.captain);
  }

  return rows.map((row) => {
    const groupKey = `${row.year}::${row.tournament || "Summer"}`;
    const groupInfo = perGroup[groupKey];
    let pickRound = null;
    let pickPercentile = null;
    let rankPercentile = null;
    let value = null;

    if (
      groupInfo &&
      groupInfo.pickCount > 1 &&
      groupInfo.captains.size > 1 &&
      Number.isFinite(row.pickOrder) &&
      Number.isFinite(row.rank)
    ) {
      pickRound = Math.floor((row.pickOrder - 1) / groupInfo.captains.size) + 1;
      pickPercentile = (row.pickOrder - 1) / (groupInfo.pickCount - 1);
      rankPercentile = (row.rank - 1) / (groupInfo.captains.size - 1);
      value = pickPercentile - rankPercentile;
    }

    return { ...row, pickRound, pickPercentile, rankPercentile, value };
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
// present in `rows`, so recency is always relative to the available data.
function computeGroupStats(rows, riskAversion, halfLifeYears) {
  const maxYear = rows.reduce(
    (m, r) => (Number.isFinite(r.year) && r.year > m ? r.year : m),
    -Infinity,
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
      groups[key] = {
        entries: [],
        displayName: row.displayName,
        profileUrl: row.profileUrl,
        identified: row.identified,
        identityKey: key,
      };
    }
    groups[key].entries.push({
      value: row.value, // may be null — filtered out below where relevant
      weight,
      pickPercentile: row.pickPercentile,
      rankPercentile: row.rankPercentile,
    });
  }

  const result = Object.values(groups).map(
    ({ entries, displayName, profileUrl, identified, identityKey }) => {
      const n = entries.length;
      const valueEntries = entries.filter((e) => Number.isFinite(e.value));

      let mean = null;
      let sd = null;
      let adjAvg = null;

      if (valueEntries.length > 0) {
        const sumW = valueEntries.reduce((a, e) => a + e.weight, 0);
        const sumWSq = valueEntries.reduce((a, e) => a + e.weight ** 2, 0);
        const weightedMean =
          valueEntries.reduce((a, e) => a + e.weight * e.value, 0) / sumW;

        const weightedSqDiffSum = valueEntries.reduce(
          (a, e) => a + e.weight * (e.value - weightedMean) ** 2,
          0,
        );

        if (SD_MODE === "sample") {
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
        identityKey,
        profileUrl,
        identified,
        n,
        mean: mean === null ? null : round2(mean),
        sd: sd === null ? null : round2(sd),
        adjAvg: adjAvg === null ? null : round2(adjAvg),
        avgPickPercentile:
          avgPickPercentile === null ? null : round2(avgPickPercentile),
        avgRankPercentile:
          avgRankPercentile === null ? null : round2(avgRankPercentile),
      };
    },
  );

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

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Shared by /api/stats, /api/roi, /api/tiers — resolves identity for the
// full dataset so each alternative methodology operates on the same
// underlying appearances, just scored differently.
function getFilteredIdentifiedRows() {
  const rows = getAllRows();
  const identityMap = loadIdentityMap(db);
  return resolveIdentities(rows, identityMap);
}

app.get("/api/stats", (req, res) => {
  const riskAversion = parseFloat(req.query.risk);
  const halfLifeYears = parseFloat(req.query.halfLife);
  if (Number.isNaN(riskAversion)) {
    return res.status(400).json({ error: "risk query param must be a number" });
  }
  if (Number.isNaN(halfLifeYears) || halfLifeYears < 0) {
    return res
      .status(400)
      .json({ error: "halfLife query param must be a non-negative number" });
  }

  const withIdentity = getFilteredIdentifiedRows();
  const derived = attachDerivedFields(withIdentity);
  const stats = computeGroupStats(derived, riskAversion, halfLifeYears);
  res.json({ riskAversion, halfLifeYears, stats });
});

// TrueSkill: rates players as a sequence of team games, one per year,
function getMatches() {
  return db
    .prepare(
      "SELECT year, tournament, team1, team2, result, csv_row_index AS rowIndex, match_order AS matchOrder, match_stage AS matchStage FROM matches",
    )
    .all();
}
const RANK_TIER_ORDER = [
  'CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD',
  'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON', 'UNRANKED'
];
const DIVISION_ORDER = { I: 0, II: 1, III: 2, IV: 3 };

function getSoloQueueRankMap(db) {
  const rows = db.prepare(`
    SELECT player_id, tier, division, league_points
    FROM player_ranked_stats
    WHERE queue_type = 'RANKED_SOLO_5x5'
  `).all();
  return new Map(rows.map((r) => [`p${r.player_id}`, {
    tier: r.tier,
    division: r.division,
    leaguePoints: r.league_points
  }]));
}

// Sort key: tier first (Challenger highest), then division (I highest
// within a tier), then league points as the final tiebreaker.
function soloQueueSortValue(rank) {
  if (!rank || !rank.tier || rank.tier === 'UNRANKED') return -1;
  const tierIdx = RANK_TIER_ORDER.indexOf(rank.tier.toUpperCase());
  const divIdx = DIVISION_ORDER[rank.division] ?? 4;
  return (RANK_TIER_ORDER.length - tierIdx) * 10000 - divIdx * 100 + (rank.leaguePoints || 0);
}
const { computeFunFacts } = require("./src/lib/trueskill-funfacts");

app.get("/api/trueskill", (req, res) => {
  const identityMap = loadIdentityMap(db);
  const allRows = resolveIdentities(getAllRows(), identityMap);
  const matches = getMatches();
  const opts = {};
  for (const key of [
    "mu",
    "sigma",
    "beta",
    "tau",
    "drawProbability",
    "conservativeK",
  ]) {
    if (req.query[key] !== undefined) {
      const val = parseFloat(req.query[key]);
      if (Number.isNaN(val))
        return res
          .status(400)
          .json({ error: `${key} query param must be a number` });
      opts[key] = val;
    }
  }
  const result = computeTrueSkillFromMatches(matches, allRows, identityMap, opts);

  const rankMap = getSoloQueueRankMap(db);
  result.players = result.players.map((p) => ({ ...p, soloQueueRank: rankMap.get(p.identityKey) || null }));

  result.funFacts = computeFunFacts(result);
  res.json(result);
});


// Read in filter preset
const fs = require('fs'); // add if not already imported

const PRESETS_DIR = path.join(__dirname, 'data', 'presets');

function getAvailablePresets() {
  if (!fs.existsSync(PRESETS_DIR)) return [];
  return fs.readdirSync(PRESETS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .map((filename) => ({
      id: filename,
      label: filename.replace(/\.csv$/i, '').replace(/[-_]+/g, ' ')
    }));
}

app.get('/api/presets', (req, res) => {
  res.json({ presets: getAvailablePresets() });
});

app.get('/api/presets/:id', (req, res) => {
  const match = getAvailablePresets().find((p) => p.id === req.params.id);
  if (!match) return res.status(404).json({ error: 'Preset not found' });
  const text = fs.readFileSync(path.join(PRESETS_DIR, match.id), 'utf-8');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const hasAnyCommaFormat = lines.some((l) => l.includes(','));

  if (!hasAnyCommaFormat) {
    const names = lines.filter((l) => l.toLowerCase() !== 'name');
    return res.json({ id: match.id, label: match.label, names, captains: [] });
  }

  const names = [];
  const captains = [];
  for (const line of lines) {
    if (/^name\s*,\s*captain/i.test(line)) continue; // tolerate a "name,captain" header row
    const [namePart, flagPart] = line.split(',').map((s) => s.trim());
    if (!namePart) continue;
    names.push(namePart);
    if (flagPart === '1') captains.push(namePart);
  }
  res.json({ id: match.id, label: match.label, names, captains });
});

// Comparing TrueSkill against draft data
const {
  computeDraftIQ,
  computeTeamBalance,
} = require("./src/lib/draft-analysis");

app.get("/api/draft-analysis", (req, res) => {
  const identityMap = loadIdentityMap(db);
  const allRows = resolveIdentities(getAllRows(), identityMap);
  const matches = getMatches();

  const trueskillResult = computeTrueSkillFromMatches(
    matches,
    allRows,
    identityMap,
    {},
  );
  const { mu, sigma, conservativeK } = trueskillResult.params;
  const defaultConservativeRating =
    Math.round((mu - conservativeK * sigma) * 1000) / 1000;

  const { picks, captainDraftIQ } = computeDraftIQ(
    allRows,
    trueskillResult.tournamentEntryRatings,
    trueskillResult.tournamentExitRatings, // NEW
    defaultConservativeRating,
  );
  const teamBalance = computeTeamBalance(
    allRows,
    trueskillResult.tournamentEntryRatings,
    trueskillResult.games,
    identityMap,
    defaultConservativeRating,
  );

  // Attach each team-instance's own games directly, so the client can
  // show a match list per row without needing a second endpoint or
  // re-deriving identity resolution client-side.
  const resolve = (name) => {
    const identity = identityMap.get(name);
    return identity ? identity.identityKey : name;
  };
  const teamBalanceWithGames = teamBalance.map((team) => {
    const captainKey = resolve(team.captain);
    const teamGames = trueskillResult.games
      .filter(
        (g) =>
          g.year === team.year &&
          g.tournament === team.tournament &&
          (g.team1.key === captainKey || g.team2.key === captainKey),
      )
      .map((g) => {
        const isTeam1 = g.team1.key === captainKey;
        const own = isTeam1 ? g.team1 : g.team2;
        const opp = isTeam1 ? g.team2 : g.team1;
        const outcome =
          g.winner === "draw"
            ? "draw"
            : (g.winner === "team1") === isTeam1
              ? "win"
              : "loss";
        return {
          opponentName: opp.name,
          outcome,
          matchStage: g.matchStage,
          predictedWinProb: isTeam1
            ? g.predictedWinProbTeam1
            : Math.round((1 - g.predictedWinProbTeam1) * 1000) / 1000,
        };
      });
    return { ...team, matches: teamGames };
  });

  res.json({ captainDraftIQ, picks, teamBalance: teamBalanceWithGames });
});

app.get("/api/player/:key", (req, res) => {
  const identityMap = loadIdentityMap(db);
  const allRows = resolveIdentities(getAllRows(), identityMap);
  const matches = getMatches();
  const result = computeTrueSkillFromMatches(matches, allRows, identityMap, {});

  const key = decodeURIComponent(req.params.key);

  const rankMap = getSoloQueueRankMap(db);
  const player = result.players.find((p) => p.identityKey === key);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json({ ...player, soloQueueRank: rankMap.get(player.identityKey) || null });
});

app.get("/api/meta", (req, res) => {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${q(TABLE)}`).get();
  const { maxYear } = db
    .prepare(
      `SELECT MAX(CAST(${q(YEAR_COL)} AS INTEGER)) AS maxYear FROM ${q(TABLE)}`,
    )
    .get();
  const years = db
    .prepare(
      `SELECT DISTINCT CAST(${q(YEAR_COL)} AS INTEGER) AS y FROM ${q(TABLE)} ORDER BY y`,
    )
    .all()
    .map((r) => r.y);
  res.json({
    rowCount: n,
    groupCol: GROUP_COL,
    valueCol: "Pick Value (computed)",
    yearCol: YEAR_COL,
    mostRecentYear: maxYear,
    years,
    sdMode: SD_MODE,
  });
});

// Mock Draft
app.get('/api/presets/:id', (req, res) => {
  const match = getAvailablePresets().find((p) => p.id === req.params.id);
  if (!match) return res.status(404).json({ error: 'Preset not found' });
  const text = fs.readFileSync(path.join(PRESETS_DIR, match.id), 'utf-8');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Two supported formats:
  //  - one name per line (existing behavior)
  //  - "name,captainFlag" per line, where captainFlag is 1/0 (or blank = 0)
  // Detected per-line by whether a comma is present at all -- a mixed
  // file (some lines with a flag, some without) is treated leniently:
  // any line without a comma is just a non-captain name.
  const hasAnyCommaFormat = lines.some((l) => l.includes(','));

  if (!hasAnyCommaFormat) {
    const names = lines.filter((l) => l.toLowerCase() !== 'name');
    return res.json({ id: match.id, label: match.label, names, captains: [] });
  }

  const names = [];
  const captains = [];
  for (const line of lines) {
    if (/^name\s*,\s*captain/i.test(line)) continue; // tolerate a header row
    const [namePart, flagPart] = line.split(',').map((s) => s.trim());
    if (!namePart) continue;
    names.push(namePart);
    if (flagPart === '1') captains.push(namePart);
  }
  res.json({ id: match.id, label: match.label, names, captains });
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
    .filter((name) => name !== "id");
}

function getRawRows() {
  const columns = getRawColumns();
  const selectCols = columns.map(q).join(", ");
  const rows = db.prepare(`SELECT ${selectCols} FROM ${q(TABLE)}`).all();
  return { columns, rows };
}

app.get("/api/raw", (req, res) => {
  const { columns, rows } = getRawRows();
  // Enriches each row with a profile URL for its Player value, same
  // identity resolution the Rankings tab uses — so raw data gets the
  // same op.gg linking, just without collapsing rows by identity (this
  // tab is meant to show the literal underlying data, one row per
  // appearance, not aggregated).
  const identityMap = loadIdentityMap(db);
  const enriched = rows.map((row) => {
    const identity = identityMap.get(row[GROUP_COL]);
    return {
      ...row,
      _playerProfileUrl: identity ? identity.profileUrl : null,
      _playerIdentityKey: identity ? identity.identityKey : null,
    };
  });
  res.json({ columns, rows: enriched });
});

// Upcoming Roster
const UPCOMING_ROSTER_DIR = path.join(__dirname, 'data', 'upcoming-roster');

function titleFromFilename(filename) {
  return filename
    .replace(/\.csv$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function findUpcomingRosterFile() {
  if (!fs.existsSync(UPCOMING_ROSTER_DIR)) return null;
  const files = fs.readdirSync(UPCOMING_ROSTER_DIR).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  return files.length ? files[0] : null;
}

app.get('/api/upcoming-roster', (req, res) => {
  const filename = findUpcomingRosterFile();
  if (!filename) return res.status(404).json({ exists: false });

  const text = fs.readFileSync(path.join(UPCOMING_ROSTER_DIR, filename), 'utf-8');
  const [header, ...lines] = parseCsv(text); // reuses ingest-matches.js's parser -- export it from there if not already
  const idx = { captain: header.indexOf('Captain'), player: header.indexOf('Player'), pickOrder: header.indexOf('Pick Order') };
  for (const [key, i] of Object.entries(idx)) {
    if (i === -1) return res.status(500).json({ error: `Missing expected column "${key}" in ${filename}` });
  }

  const identityMap = loadIdentityMap(db);
  const resolve = (name) => {
    const identity = identityMap.get(name);
    return identity
      ? { identityKey: identity.identityKey, displayName: identity.displayName, profileUrl: identity.profileUrl, identified: identity.resolved }
      : { identityKey: name, displayName: name, profileUrl: null, identified: false };
  };

  // Current, present-day rating -- this hasn't happened yet, so there's
  // no historical "entering this tournament" snapshot to use the way
  // Draft IQ does for past events. Whatever a player's rating is RIGHT
  // NOW is the honest proxy for what they're entering this draft with.
  const allRows = resolveIdentities(getAllRows(), identityMap);
  const matches = getMatches();
  const trueskillResult = computeTrueSkillFromMatches(matches, allRows, identityMap, {});
  const ratingByKey = new Map(trueskillResult.players.map((p) => [p.identityKey, p]));
  const { mu, sigma, conservativeK } = trueskillResult.params;
  const defaultRating = { mu, sigma, conservativeRating: round3(mu - conservativeK * sigma), games: 0 };

  const rows = lines.filter((r) => r[idx.captain]).map((r) => {
    const captain = resolve(r[idx.captain]);
    const player = resolve(r[idx.player]);
    const pickOrder = parseInt(r[idx.pickOrder], 10);
    const rating = ratingByKey.get(player.identityKey) || null; // null = never played a rated game -- genuinely unrated, not just "no CSV match"
    return { captain, player, pickOrder, rating };
  });

  // Rank the whole draft class by current rating for Draft IQ purposes.
  // Players with no rating at all (never played) can't be meaningfully
  // ranked -- they're excluded from the ranking pool entirely, same
  // treatment as an unresolved/never-seen player anywhere else in this
  // app, but still shown on their team's roster with no rank/value.
  const rated = rows.filter((r) => r.rating).sort((a, b) => b.rating.conservativeRating - a.rating.conservativeRating);
  const entryRankByKey = new Map(rated.map((r, i) => [r.player.identityKey, i + 1]));

  const byCaptain = new Map();
  for (const row of rows) {
    const key = row.captain.identityKey;
    if (!byCaptain.has(key)) byCaptain.set(key, { captain: row.captain, players: [] });
    const entryRank = entryRankByKey.get(row.player.identityKey) ?? null;
    byCaptain.get(key).players.push({
      ...row.player,
      pickOrder: row.pickOrder,
      mu: row.rating ? row.rating.mu : null,
      sigma: row.rating ? row.rating.sigma : null,
      conservativeRating: row.rating ? row.rating.conservativeRating : null,
      games: row.rating ? row.rating.games : 0,
      entryRank,
      value: entryRank !== null ? entryRank - row.pickOrder : null
    });
  }

  const teams = [...byCaptain.values()].map((team) => {
    const ratedPlayers = team.players.filter((p) => p.conservativeRating !== null);
    const avgEntryRating = ratedPlayers.length
      ? round3(ratedPlayers.reduce((s, p) => s + p.conservativeRating, 0) / ratedPlayers.length)
      : null;
    const valued = team.players.filter((p) => p.value !== null);
    const draftIQ = valued.length
      ? round3(valued.reduce((s, p) => s + p.value, 0) / valued.length)
      : null;
    return {
      captain: team.captain,
      avgEntryRating,
      ratedCount: ratedPlayers.length,
      totalCount: team.players.length,
      draftIQ,
      roster: team.players.sort((a, b) => a.pickOrder - b.pickOrder)
    };
  });
  teams.sort((a, b) => (b.avgEntryRating ?? -Infinity) - (a.avgEntryRating ?? -Infinity));

  res.json({ exists: true, title: titleFromFilename(filename), teams });
});
// Match data endpoint
function getRawMatchColumns() {
  return db
    .prepare("PRAGMA table_info(matches)")
    .all()
    .map((c) => c.name)
    .filter((name) => name !== "id"); // only the autoincrement key excluded; csv_row_index stays
}

function getRawMatchRows() {
  const columns = getRawMatchColumns();
  const selectCols = columns.map(q).join(", ");
  const rows = db.prepare(`SELECT ${selectCols} FROM matches`).all();
  return { columns, rows };
}

const MATCH_COLUMN_DISPLAY_NAMES = {
  year: "Year",
  tournament: "Tournament",
  team1: "Team 1",
  team2: "Team 2",
  result: "Result",
  match_order: "Match Order",
  match_stage: "Match Stage",
  csv_row_index: "CSV Row Index", // internal-ish, but included for completeness if ever un-hidden
};

app.get("/api/raw-matches", (req, res) => {
  const { columns, rows } = getRawMatchRows();

  const identityMap = loadIdentityMap(db);
  const allRows = resolveIdentities(getAllRows(), identityMap);
  const matches = getMatches();
  const trueskillResult = computeTrueSkillFromMatches(
    matches,
    allRows,
    identityMap,
    {},
  );
  const gameByRowIndex = new Map(
    trueskillResult.games.map((g) => [g.csvRowIndex, g]),
  );

  const enriched = rows.map((row) => {
    const game = gameByRowIndex.get(row.csv_row_index);
    return {
      ...row,
      _team1Roster: game?.team1 ?? null,
      _team2Roster: game?.team2 ?? null,
    };
  });

  res.json({ columns, rows: enriched });
});

app.get("/api/raw-matches.csv", (req, res) => {
  const { columns, rows } = getRawMatchRows();
  const headerLabels = columns.map((c) => MATCH_COLUMN_DISPLAY_NAMES[c] || c);
  const lines = [headerLabels.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(","));
  }
  const csv = lines.join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="match-data.csv"');
  res.send(csv);
});

// CSV-escapes a single field: wraps in quotes if it contains a comma,
// quote, or newline, doubling any internal quotes.
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

app.get("/api/raw.csv", (req, res) => {
  const { columns, rows } = getRawRows();
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(","));
  }
  const csv = lines.join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="draft-data.csv"');
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
  if (req.get("X-Admin-Token") === configured) return true;
  res.status(401).json({ error: "Missing or incorrect X-Admin-Token header" });
  return false;
}

app.get("/api/identity/status", (req, res) => {
  if (!identityTablesExist(db)) {
    return res.json({
      bootstrapped: false,
      message:
        "Identity tables not created yet — run node src/scripts/bootstrap-player-identities.js",
    });
  }
  const totalPlayers = db.prepare("SELECT COUNT(*) c FROM players").get().c;
  const resolved = db
    .prepare("SELECT COUNT(*) c FROM players WHERE puuid IS NOT NULL")
    .get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM pending_lookups").get().c;
  const pendingReady = db
    .prepare(
      "SELECT COUNT(*) c FROM pending_lookups WHERE game_name IS NOT NULL AND game_name != ''",
    )
    .get().c;
  res.json({
    bootstrapped: true,
    totalPlayers,
    resolved,
    unresolved: totalPlayers - resolved,
    pendingLookups: pending,
    pendingReadyToResolve: pendingReady,
    pendingMissingTag: pending - pendingReady,
  });
});

app.post("/api/identity/sync", async (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  if (!process.env.RIOT_API_KEY) {
    return res
      .status(400)
      .json({ error: "RIOT_API_KEY is not set on the server" });
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
