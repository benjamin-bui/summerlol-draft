#!/usr/bin/env node
// Data check: reads the draft, match and match-details CSVs and reports rows
// that look wrong, with the file and row number of each so they're easy to find
// and fix in the sheet. Run with:
//
//   npm run check-data
//   npm run check-data -- --draft path/draft.csv --matches path/matches.csv --details path/details.csv
//
// It looks for:
//   1. Teams with more than 5 players, captain included, in the draft CSV.
//   2. Teams with more than 5 players in a single game, in the details CSV.
//   3. The same role given to more than one player on a team in a game.
//   4. A champion both picked and banned in the same game.
// plus any details rows it couldn't attach to a game at all (which also means
// they couldn't be checked).
//
// Row numbers are spreadsheet rows: the header is row 1, the first data row 2.
//
// Nothing here touches your real database, not even to open it. The CSVs are
// loaded into a throwaway copy of the DB file (the copy is only there so player
// aliases resolve the same way a real ingest does), using the same ingest code
// the app uses, so games and teams are worked out exactly as they will be when
// you ingest for real.
//
// Exits 1 if anything is found, 0 if everything is clean, 2 if it was given
// nothing to check.

const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { parseCsv, ingestMatches } = require("./ingest-matches");
const { ingestCsv } = require("./csv-to-sqlite");
const {
  ingestMatchDetailsDetailed,
  playersMatch,
} = require("./ingest-match-details");
const { loadIdentityMap } = require("../lib/player-identity");
const { championKey } = require("../lib/champion-releases");

const ROOT = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT, "data");
const DEFAULT_DB = path.join(DATA_DIR, "app.db");
const MAX_TEAM_SIZE = 5;

// First file that exists wins. The env vars are the ones entrypoint.js and
// refresh-all.js already use.
const DEFAULT_CANDIDATES = {
  draft: [
    process.env.CSV_PATH,
    path.join(DATA_DIR, "draft-data.csv"),
    path.join(DATA_DIR, "lol-draft-long.csv"),
  ],
  matches: [path.join(DATA_DIR, "lol-draft-match.csv")],
  details: [
    process.env.MATCH_DETAILS_PATH,
    path.join(DATA_DIR, "lol-draft-match-details.csv"),
  ],
};

const rel = (file) => {
  const r = path.relative(process.cwd(), file);
  return r && !r.startsWith("..") ? r : file;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- game labels
function gameLabel(record) {
  const c = record.context;
  const stage = c.matchStage ? `${c.matchStage}, ` : "";
  return `${c.year} ${c.tournament || ""} - ${stage}match ${c.matchOrder} (${record.team1} vs ${record.team2})`.replace(
    /\s+/g,
    " ",
  );
}

// -------------------------------------------------------------------- checks
// Each check returns issues shaped like
//   { title, locations: [{ file, row, note }] }
// `file` is a short label ("draft" / "details" / "matches") the printer turns
// into the actual path.

// 1. Draft CSV: a team is its captain plus every player drafted onto it.
function checkDraftRosterSizes(draftPath, identityMap) {
  const [header, ...rows] = parseCsv(fs.readFileSync(draftPath, "utf8"));
  const col = Object.fromEntries(
    ["Tournament", "Year", "Captain", "Player", "Pick Order"].map((name) => [
      name,
      header.indexOf(name),
    ]),
  );
  const missing = ["Year", "Captain", "Player"].filter((n) => col[n] === -1);
  if (missing.length) {
    return {
      issues: [],
      note: `draft CSV has no ${missing.map((m) => `"${m}"`).join(", ")} column, so team sizes could not be checked`,
    };
  }
  const cell = (row, name) => (col[name] === -1 ? "" : (row[col[name]] ?? "").trim());

  // One team per (year, tournament, captain). Captains are matched by identity
  // so two spellings of the same captain still land on one team.
  const teams = [];
  rows.forEach((row, index) => {
    const captain = cell(row, "Captain");
    const player = cell(row, "Player");
    if (!captain && !player) return;
    const year = cell(row, "Year");
    const tournament = cell(row, "Tournament");
    let team = teams.find(
      (t) =>
        t.year === year &&
        t.tournament === tournament &&
        playersMatch(t.captain, captain, identityMap),
    );
    if (!team) {
      team = { year, tournament, captain, members: [{ name: captain, row: null }] };
      teams.push(team);
    }
    // The captain listed as their own pick, or a player entered twice, is
    // still one person -- not an extra body on the team.
    if (player && !team.members.some((m) => playersMatch(m.name, player, identityMap))) {
      team.members.push({ name: player, row: index + 2, pick: cell(row, "Pick Order") });
    }
  });

  const issues = teams
    .filter((t) => t.members.length > MAX_TEAM_SIZE)
    .map((t) => ({
      title: `${t.year} ${t.tournament} - ${t.captain}'s team has ${t.members.length} players (captain + ${t.members.length - 1} picks; the most allowed is ${MAX_TEAM_SIZE})`,
      locations: t.members
        .filter((m) => m.row !== null)
        .map((m) => ({
          file: "draft",
          row: m.row,
          note: `${m.pick ? `pick ${m.pick}: ` : ""}${m.name}`,
        })),
    }));
  return { issues, teamsChecked: teams.length };
}

// Group collected details records by game and team.
function teamGames(records) {
  const groups = new Map();
  for (const r of records) {
    if (r.side === null) continue;
    const key = `${r.matchKey}|${r.side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()];
}

// 2. Details CSV: more than 5 different players filed under one team in one game.
function checkGameTeamSizes(records, identityMap) {
  const issues = [];
  for (const group of teamGames(records)) {
    const people = [];
    for (const r of group) {
      if (!people.some((p) => playersMatch(p.player, r.player, identityMap))) people.push(r);
    }
    if (people.length <= MAX_TEAM_SIZE) continue;
    const first = group[0];
    issues.push({
      title: `${gameLabel(first)} - ${first.team}'s team has ${people.length} players in one game (the most allowed is ${MAX_TEAM_SIZE})`,
      locations: [
        ...group.map((r) => ({ file: "details", row: r.row, note: r.player })),
        { file: "matches", row: first.matchCsvRow, note: "the match these rows were filed under" },
      ],
    });
  }
  return issues;
}

// 3. Details CSV: a role used twice on one team in one game.
function checkRepeatedRoles(records) {
  const issues = [];
  for (const group of teamGames(records)) {
    const byRole = new Map();
    for (const r of group) {
      if (!r.role) continue;
      if (!byRole.has(r.role)) byRole.set(r.role, []);
      byRole.get(r.role).push(r);
    }
    const repeated = [...byRole].filter(([, rs]) => rs.length > 1);
    if (!repeated.length) continue;
    const first = group[0];
    issues.push({
      title: `${gameLabel(first)} - ${first.team}'s team lists ${repeated
        .map(([role, rs]) => `${role} x${rs.length}`)
        .join(", ")}`,
      locations: repeated.flatMap(([role, rs]) =>
        rs.map((r) => ({
          file: "details",
          row: r.row,
          note: `${role}: ${r.player}${r.champion ? ` (${r.champion})` : ""}`,
        })),
      ),
    });
  }
  return issues;
}

// 4. Details CSV: one champion both picked and banned in the same game (by
// anyone -- a banned champion can't be picked by either team).
function checkPickedAndBanned(records) {
  const games = new Map();
  for (const r of records) {
    if (!games.has(r.matchKey)) games.set(r.matchKey, []);
    games.get(r.matchKey).push(r);
  }
  const issues = [];
  for (const rs of games.values()) {
    const picks = new Map();
    const bans = new Map();
    for (const r of rs) {
      const pickKey = r.champion && championKey(r.champion);
      if (pickKey) {
        if (!picks.has(pickKey)) picks.set(pickKey, []);
        picks.get(pickKey).push(r);
      }
      for (const banned of r.bans) {
        const banKey = championKey(banned);
        if (!banKey) continue;
        if (!bans.has(banKey)) bans.set(banKey, []);
        bans.get(banKey).push({ record: r, champion: banned });
      }
    }
    for (const [key, pickRows] of picks) {
      if (!bans.has(key)) continue;
      const banRows = bans.get(key);
      issues.push({
        title: `${gameLabel(pickRows[0])} - ${pickRows[0].champion} is both picked and banned`,
        locations: [
          ...pickRows.map((r) => ({
            file: "details",
            row: r.row,
            note: `Champion column: ${r.player} picked ${r.champion}`,
          })),
          ...banRows.map(({ record, champion }) => ({
            file: "details",
            row: record.row,
            note: `Ban column: ${record.team}'s team banned ${champion}`,
          })),
        ],
      });
    }
  }
  return issues;
}

// ------------------------------------------------------------- orchestration
function firstExisting(list) {
  return list.find((f) => f && fs.existsSync(f)) || null;
}

// A throwaway DB seeded from the real one when there is one, so player aliases
// resolve the way they do in a real ingest. The real DB is only ever *read as a
// file*: it is never opened as a database, because even a read-only connection
// to a WAL-mode database creates -shm/-wal files beside it. The copy (and its
// -wal, if the real one has unmerged writes) is what gets opened, in the temp dir.
function makeWorkingDb(realDb, dir) {
  const workingPath = path.join(dir, "check.db");
  if (realDb && fs.existsSync(realDb)) {
    fs.copyFileSync(realDb, workingPath);
    if (fs.existsSync(`${realDb}-wal`)) fs.copyFileSync(`${realDb}-wal`, `${workingPath}-wal`);
  }
  return workingPath;
}

// Runs every check that has the files it needs. Returns
//   { inputs, sections: [{ title, issues, note? }], problemCount }
// and prints nothing -- printReport() does that -- so it can be used from tests.
function runChecks({ draft, matches, details, db }) {
  const inputs = { draft, matches, details, db: db && fs.existsSync(db) ? db : null };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summerlol-check-"));
  const sections = [];
  try {
    const workingPath = makeWorkingDb(inputs.db, dir);
    const notes = [];

    // Load what we were given into the working DB. A file the ingest can't
    // read at all (missing column, duplicate match...) is reported as a problem
    // rather than crashing the check; whatever depends on it is skipped.
    const loadFailures = [];
    const load = (kind, fn) => {
      try {
        fn();
        return true;
      } catch (err) {
        loadFailures.push({
          title: `${path.basename(inputs[kind])} could not be loaded: ${err.message}`,
          locations: [],
        });
        return false;
      }
    };
    const draftLoaded = draft
      ? load("draft", () => ingestCsv(draft, { fresh: true, dbPath: workingPath }))
      : false;
    const matchesLoaded = matches
      ? load("matches", () => ingestMatches(matches, { dbPath: workingPath }))
      : false;
    if (loadFailures.length) {
      sections.push({ title: "Files that could not be loaded", issues: loadFailures });
    }
    const working = new Database(workingPath);
    let identityMap;
    let dbHasDraft = false;
    let dbHasMatches = false;
    try {
      identityMap = loadIdentityMap(working);
      const count = (table) => {
        try {
          return working.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
        } catch {
          return 0;
        }
      };
      dbHasDraft = count("rows") > 0;
      dbHasMatches = count("matches") > 0;
    } finally {
      working.close();
    }

    // 1. Draft roster sizes -- needs the CSV itself, for its row numbers.
    if (draft && draftLoaded) {
      const result = checkDraftRosterSizes(draft, identityMap);
      sections.push({
        title: "Teams with more than 5 players, captain included (draft)",
        issues: result.issues,
        note: result.note,
        detail: result.teamsChecked !== undefined ? `${result.teamsChecked} teams checked` : undefined,
      });
    } else {
      sections.push({
        title: "Teams with more than 5 players, captain included (draft)",
        issues: [],
        skipped: draft
          ? "the draft CSV could not be loaded (see above)"
          : "no draft CSV found (pass --draft <file>)",
      });
    }

    // 2-4 need the details CSV, and the draft + matches to attach each row to a game and team.
    const detailChecks = [
      "Teams with more than 5 players in one game (details)",
      "Same role given to more than one player on a team (details)",
      "Champion both picked and banned in the same game (details)",
    ];
    if (!details) {
      for (const title of detailChecks) {
        sections.push({ title, issues: [], skipped: "no match-details CSV found (pass --details <file>)" });
      }
    } else if (!(draftLoaded || dbHasDraft) || !(matchesLoaded || dbHasMatches)) {
      const what = [!(draftLoaded || dbHasDraft) && "draft", !(matchesLoaded || dbHasMatches) && "matches"]
        .filter(Boolean)
        .join(" and ");
      for (const title of detailChecks) {
        sections.push({
          title,
          issues: [],
          skipped: `needs the ${what} data to work out which game and team each row belongs to (pass --${what.split(" ")[0]} <file>)`,
        });
      }
    } else {
      if (!draftLoaded) notes.push("draft data taken from the database (no draft CSV given)");
      if (!matchesLoaded) notes.push("match data taken from the database (no matches CSV given)");
      let result;
      try {
        result = ingestMatchDetailsDetailed(details, { dbPath: workingPath, collect: true });
      } catch (err) {
        // Only structural failures (e.g. a required column missing) get here;
        // bad rows are collected as `problems` instead.
        sections.push({
          title: "Details file could not be read",
          issues: [{ title: `${path.basename(details)}: ${err.message}`, locations: [] }],
        });
        for (const title of detailChecks) {
          sections.push({ title, issues: [], skipped: "the details CSV could not be read (see above)" });
        }
        return { inputs, sections, notes, problemCount: sections.reduce((n, sec) => n + sec.issues.length, 0) };
      }
      const { records, problems } = result;
      sections.push({
        title: detailChecks[0],
        issues: checkGameTeamSizes(records, identityMap),
        detail: `${plural(records.length, "row")} attached to a game`,
      });
      sections.push({ title: detailChecks[1], issues: checkRepeatedRoles(records) });
      sections.push({ title: detailChecks[2], issues: checkPickedAndBanned(records) });
      sections.push({
        title: "Details rows that could not be checked",
        issues: problems.map((p) => ({
          title: p.message,
          locations: [{ file: "details", row: p.row, note: "" }],
        })),
        note: problems.length
          ? "these rows were left out of every check above, so problems in them are not reported"
          : undefined,
      });
    }

    const problemCount = sections.reduce((n, s) => n + s.issues.length, 0);
    return { inputs, sections, notes, problemCount };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------- output
function printReport({ inputs, sections, notes, problemCount }, out = console.log) {
  const fileLabel = (kind) => (inputs[kind] ? rel(inputs[kind]) : null);
  out("Data check");
  for (const [kind, label] of [
    ["draft", "draft   "],
    ["matches", "matches "],
    ["details", "details "],
  ]) {
    out(`  ${label} ${fileLabel(kind) || "(none found)"}`);
  }
  if (inputs.db) out(`  aliases  ${rel(inputs.db)} (copied, never modified; used for player aliases)`);
  for (const n of notes) out(`  note: ${n}`);
  out("");

  const nameOf = (kind) => path.basename(inputs[kind] || kind);
  sections.forEach((section, i) => {
    const status = section.skipped
      ? "skipped"
      : section.issues.length
        ? plural(section.issues.length, "problem")
        : "none found";
    out(`${i + 1}. ${section.title}: ${status}${section.detail && !section.issues.length ? ` (${section.detail})` : ""}`);
    if (section.skipped) out(`     ${section.skipped}`);
    if (section.note) out(`     ${section.note}`);
    for (const issue of section.issues) {
      out(`   [!] ${issue.title}`);
      // Group rows by file so each line reads "details CSV rows 12, 13".
      for (const loc of issue.locations) {
        const where = `${nameOf(loc.file)} row ${loc.row}`;
        out(`         ${where.padEnd(48)}${loc.note ? `  ${loc.note}` : ""}`);
      }
    }
    out("");
  });

  out(
    problemCount === 0
      ? "All clear: no problems found."
      : `${plural(problemCount, "problem")} found. Row numbers are spreadsheet rows (header = row 1).`,
  );
}

// -------------------------------------------------------------------- CLI
const USAGE = `Usage: npm run check-data -- [options]

Options:
  --draft <file>     draft picks CSV        (default: $CSV_PATH, data/draft-data.csv or data/lol-draft-long.csv)
  --matches <file>   matches CSV            (default: data/lol-draft-match.csv)
  --details <file>   match details CSV      (default: $MATCH_DETAILS_PATH or data/lol-draft-match-details.csv)
  --db <file>        database to copy player aliases from; never modified (default: data/app.db)
  -h, --help         show this help

Reports teams with more than 5 players, roles used twice on a team, and
champions picked and banned in the same game, with the CSV row of each.
Exits 1 if anything is found.`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") args.help = true;
    else if (["--draft", "--matches", "--details", "--db"].includes(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a file path`);
      args[a.slice(2)] = argv[++i];
    } else throw new Error(`Unknown option "${a}"`);
  }
  return args;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const explicit = (kind) => {
    if (!args[kind]) return null;
    if (!fs.existsSync(args[kind])) throw new Error(`--${kind} file not found: ${args[kind]}`);
    return path.resolve(args[kind]);
  };
  let draft, matches, details;
  try {
    draft = explicit("draft") || firstExisting(DEFAULT_CANDIDATES.draft);
    matches = explicit("matches") || firstExisting(DEFAULT_CANDIDATES.matches);
    details = explicit("details") || firstExisting(DEFAULT_CANDIDATES.details);
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  if (!draft && !matches && !details) {
    console.error(`No CSV files found to check.\n\n${USAGE}`);
    return 2;
  }
  const report = runChecks({ draft, matches, details, db: args.db ? path.resolve(args.db) : DEFAULT_DB });
  printReport(report);
  return report.problemCount === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { runChecks, printReport, main };
