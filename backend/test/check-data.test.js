const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { runChecks, main } = require("../src/scripts/check-data");

// Three captains in one tournament:
//   Cap1: A1..A4                       -> 5 with the captain: fine
//   Cap2: B1..B5                       -> 6 with the captain: TOO MANY (draft rows 6-10)
//   Cap3: C1..C3, plus Cap3 listed as their own pick -> still 4 people: fine
const DRAFT = [
  "Tournament,Year,Captain,Player,Pick Order,Rank",
  "Summer,2026,Cap1,A1,1,1", // row 2
  "Summer,2026,Cap1,A2,2,1",
  "Summer,2026,Cap1,A3,3,1",
  "Summer,2026,Cap1,A4,4,1",
  "Summer,2026,Cap2,B1,5,1", // row 6
  "Summer,2026,Cap2,B2,6,1",
  "Summer,2026,Cap2,B3,7,1",
  "Summer,2026,Cap2,B4,8,1",
  "Summer,2026,Cap2,B5,9,1", // row 10
  "Summer,2026,Cap3,C1,10,1",
  "Summer,2026,Cap3,C2,11,1",
  "Summer,2026,Cap3,C3,12,1",
  "Summer,2026,Cap3,Cap3,13,1", // captain listed as a pick
].join("\n");

const MATCHES = [
  "Year,Tournament,Team 1,Team 2,Result,Match Order,Match Stage",
  "2026,Summer,Cap1,Cap3,Cap1,1,Groups", // matches row 2
  "2026,Summer,Cap1,Cap2,Cap2,2,Groups", // matches row 3
].join("\n");

const HEADER = "Year,Tournament,Match Stage,Match Order,Player,Role,Champion,K,D,A,Ban";
const game1 = (over = {}) => [
  // Cap1's team (side 1) vs Cap3's team (side 2)
  `2026,Summer,Groups,1,Cap1,Top,Garen,1,1,1,`,
  `2026,Summer,Groups,1,A1,Jungle,Lee Sin,1,1,1,`,
  `2026,Summer,Groups,1,A2,Mid,Ahri,1,1,1,`,
  `2026,Summer,Groups,1,A3,Bot,Ashe,1,1,1,`,
  `2026,Summer,Groups,1,A4,Supp,Leona,1,1,1,`,
  `2026,Summer,Groups,1,Cap3,Top,Darius,1,1,1,`,
  `2026,Summer,Groups,1,C1,Jungle,Vi,1,1,1,`,
  `2026,Summer,Groups,1,C2,Mid,Zed,1,1,1,`,
  `2026,Summer,Groups,1,C3,Bot,Jinx,1,1,1,`,
  `2026,Summer,Groups,1,Cap3,Supp,Lulu,1,1,1,`, // placeholder replaced below
];

function fixture({ details, draft = DRAFT, matches = MATCHES }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-data-test-"));
  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text + "\n");
    return file;
  };
  return {
    dir,
    draft: draft && write("draft.csv", draft),
    matches: matches && write("matches.csv", matches),
    details: details && write("details.csv", details),
  };
}
const detailsCsv = (rows) => [HEADER, ...rows].join("\n");
const section = (report, startsWith) =>
  report.sections.find((s) => s.title.startsWith(startsWith));
const rowsOf = (issue) => issue.locations.map((l) => `${l.file}:${l.row}`);

// A clean game: each team has exactly Top/Jungle/Mid/Bot/Supp, no bans, no clashes.
const CLEAN_GAME = [
  "2026,Summer,Groups,1,Cap1,Top,Garen,1,1,1,",
  "2026,Summer,Groups,1,A1,Jungle,Lee Sin,1,1,1,",
  "2026,Summer,Groups,1,A2,Mid,Ahri,1,1,1,",
  "2026,Summer,Groups,1,A3,Bot,Ashe,1,1,1,",
  "2026,Summer,Groups,1,A4,Supp,Leona,1,1,1,",
  "2026,Summer,Groups,1,Cap3,Top,Darius,1,1,1,",
  "2026,Summer,Groups,1,C1,Jungle,Vi,1,1,1,",
  "2026,Summer,Groups,1,C2,Mid,Zed,1,1,1,",
  "2026,Summer,Groups,1,C3,Bot,Jinx,1,1,1,",
  "2026,Summer,Groups,1,Cap3,Supp,Lulu,1,1,1,",
];

test("draft: a team over 5 is flagged with its CSV rows; a captain listed as their own pick is not an extra player", () => {
  const f = fixture({});
  const report = runChecks({ draft: f.draft, matches: f.matches, details: null, db: null });
  const s = section(report, "Teams with more than 5 players, captain included");
  assert.equal(s.issues.length, 1);
  const issue = s.issues[0];
  assert.match(issue.title, /Cap2's team has 6 players/);
  // rows 6-10 are Cap2's five picks; the captain row doesn't exist, so it isn't cited
  assert.deepEqual(rowsOf(issue), ["draft:6", "draft:7", "draft:8", "draft:9", "draft:10"]);
  assert.match(issue.locations[0].note, /pick 5: B1/);
  assert.equal(s.detail, "3 teams checked");
});

test("a clean set of files reports nothing, and main() exits 0", () => {
  const f = fixture({ details: detailsCsv(CLEAN_GAME), draft: DRAFT.split("\n").filter((l) => !l.includes("Cap2")).join("\n") });
  const report = runChecks({ draft: f.draft, matches: f.matches, details: f.details, db: null });
  assert.equal(report.problemCount, 0, JSON.stringify(report.sections.map((s) => [s.title, s.issues.map((i) => i.title)])));
});

test("details: the same role twice on one team is flagged with both rows", () => {
  const rows = [...CLEAN_GAME];
  rows[1] = "2026,Summer,Groups,1,A1,Mid,Lee Sin,1,1,1,"; // A1 and A2 are both Mid (rows 3 and 4)
  const f = fixture({ details: detailsCsv(rows) });
  const report = runChecks({ draft: f.draft, matches: f.matches, details: f.details, db: null });
  const s = section(report, "Same role given to more than one player");
  assert.equal(s.issues.length, 1);
  assert.match(s.issues[0].title, /Cap1's team lists Mid x2/);
  assert.deepEqual(rowsOf(s.issues[0]), ["details:3", "details:4"]);
  assert.match(s.issues[0].locations[0].note, /Mid: A1 \(Lee Sin\)/);
});

test("details: the same role on OPPOSITE teams is normal and not flagged", () => {
  const f = fixture({ details: detailsCsv(CLEAN_GAME) });
  const report = runChecks({ draft: f.draft, matches: f.matches, details: f.details, db: null });
  assert.equal(section(report, "Same role given").issues.length, 0);
});

test("details: a champion picked and banned in the same game is flagged, citing the pick row and the ban row", () => {
  const rows = [...CLEAN_GAME];
  // Cap3's team bans Ahri (row 8, on C1's row), while A2 picked Ahri (row 4).
  rows[6] = "2026,Summer,Groups,1,C1,Jungle,Vi,1,1,1,ahri";
  const f = fixture({ details: detailsCsv(rows) });
  const report = runChecks({ draft: f.draft, matches: f.matches, details: f.details, db: null });
  const s = section(report, "Champion both picked and banned");
  assert.equal(s.issues.length, 1);
  assert.match(s.issues[0].title, /Ahri is both picked and banned/);
  assert.deepEqual(rowsOf(s.issues[0]), ["details:4", "details:8"]);
  assert.match(s.issues[0].locations[0].note, /Champion column: A2 picked Ahri/);
  assert.match(s.issues[0].locations[1].note, /Ban column: Cap3's team banned ahri/);
});

test("details: a champion banned in one game and picked in a DIFFERENT game is fine", () => {
  const rows = [
    ...CLEAN_GAME,
    // game 2 (Cap1 vs Cap2): Cap1's team bans Garen, which was picked in game 1 only
    "2026,Summer,Groups,2,Cap1,Top,Ornn,1,1,1,Garen",
    "2026,Summer,Groups,2,Cap2,Top,Renekton,1,1,1,",
  ];
  const f = fixture({ details: detailsCsv(rows) });
  const report = runChecks({ draft: f.draft, matches: f.matches, details: f.details, db: null });
  assert.equal(section(report, "Champion both picked and banned").issues.length, 0);
});

test("details: more than 5 players on one team in a game is flagged, citing the match row too", () => {
  // Game 2 is Cap1 vs Cap2. Put Cap2 and B1..B5 -- six people -- all on Cap2's side.
  const rows = [
    "2026,Summer,Groups,2,Cap2,Top,Garen,1,1,1,",
    "2026,Summer,Groups,2,B1,Jungle,Vi,1,1,1,",
    "2026,Summer,Groups,2,B2,Mid,Zed,1,1,1,",
    "2026,Summer,Groups,2,B3,Bot,Jinx,1,1,1,",
    "2026,Summer,Groups,2,B4,Supp,Lulu,1,1,1,",
    "2026,Summer,Groups,2,B5,Top,Ornn,1,1,1,",
  ];
  const f = fixture({ details: detailsCsv(rows) });
  const report = runChecks({ draft: f.draft, matches: f.matches, details: f.details, db: null });
  const s = section(report, "Teams with more than 5 players in one game");
  assert.equal(s.issues.length, 1);
  assert.match(s.issues[0].title, /Cap2's team has 6 players in one game/);
  assert.deepEqual(rowsOf(s.issues[0]), [
    "details:2", "details:3", "details:4", "details:5", "details:6", "details:7",
    "matches:3", // Cap1 vs Cap2 is row 3 of the matches CSV
  ]);
});

test("rows that can't be attached to a game, or have a bad role, are reported by row without stopping the other checks", () => {
  const rows = [...CLEAN_GAME];
  rows[2] = "2026,Summer,Groups,1,A2,Fill,Ahri,1,1,1,"; // row 4: invalid role
  rows.push("2026,Summer,Groups,1,Nobody,Top,Ornn,1,1,1,"); // row 12: on no team
  const f = fixture({ details: detailsCsv(rows) });
  const report = runChecks({ draft: f.draft, matches: f.matches, details: f.details, db: null });
  const s = section(report, "Details rows that could not be checked");
  assert.deepEqual(
    s.issues.map((i) => rowsOf(i)[0]).sort(),
    ["details:12", "details:4"],
  );
  assert.match(s.issues.find((i) => rowsOf(i)[0] === "details:4").title, /"Role" value "Fill"/);
  assert.match(s.issues.find((i) => rowsOf(i)[0] === "details:12").title, /"Nobody"/);
  assert.ok(s.note, "explains those rows were left out of the other checks");
  // ...and the checks still ran on everything else
  assert.equal(section(report, "Champion both picked").skipped, undefined);
});

test("an unreadable file is reported as a problem instead of crashing, and dependents are skipped", () => {
  const f = fixture({ details: detailsCsv(CLEAN_GAME), matches: "Year,Tournament\n2026,Summer" });
  const report = runChecks({ draft: f.draft, matches: f.matches, details: f.details, db: null });
  const s = section(report, "Files that could not be loaded");
  assert.equal(s.issues.length, 1);
  assert.match(s.issues[0].title, /matches\.csv could not be loaded: Missing expected column/);
});

test("details checks are skipped, with the reason, when there is nothing to attach rows to", () => {
  const f = fixture({ details: detailsCsv(CLEAN_GAME), draft: null, matches: null });
  const report = runChecks({ draft: null, matches: null, details: f.details, db: null });
  for (const title of ["Teams with more than 5 players in one game", "Same role given", "Champion both picked"]) {
    assert.match(section(report, title).skipped, /needs the draft and matches data/);
  }
});

test("main(): exit codes -- 0 clean, 1 problems, 2 bad usage", () => {
  const logs = [];
  const realLog = console.log;
  const realErr = console.error;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
  try {
    const clean = fixture({
      details: detailsCsv(CLEAN_GAME),
      draft: DRAFT.split("\n").filter((l) => !l.includes("Cap2")).join("\n"),
    });
    assert.equal(
      main(["--draft", clean.draft, "--matches", clean.matches, "--details", clean.details, "--db", "/nonexistent.db"]),
      0,
    );
    assert.ok(logs.some((l) => l.includes("All clear")));

    const bad = fixture({ details: detailsCsv(CLEAN_GAME) }); // draft has the 6-player team
    assert.equal(
      main(["--draft", bad.draft, "--matches", bad.matches, "--details", bad.details, "--db", "/nonexistent.db"]),
      1,
    );
    assert.ok(logs.some((l) => /1 problem found/.test(l)));

    assert.equal(main(["--bogus"]), 2);
    assert.equal(main(["--draft"]), 2);
    assert.equal(main(["--draft", "/no/such/file.csv"]), 2);
    assert.equal(main(["--help"]), 0);
  } finally {
    console.log = realLog;
    console.error = realErr;
  }
});

test("the database it borrows aliases from is left exactly as it was, with no files added beside it", () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "check-data-db-"));
  const dbPath = path.join(dbDir, "app.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL"); // the mode the real app.db is in
  db.exec("CREATE TABLE marker (v TEXT); INSERT INTO marker VALUES ('untouched')");
  db.close();
  const snapshot = () =>
    fs.readdirSync(dbDir).sort().map((f) => `${f}:${fs.readFileSync(path.join(dbDir, f)).toString("hex").length}`);
  const before = snapshot();
  const bytesBefore = fs.readFileSync(dbPath);

  const f = fixture({ details: detailsCsv(CLEAN_GAME) });
  runChecks({ draft: f.draft, matches: f.matches, details: f.details, db: dbPath });

  assert.deepEqual(snapshot(), before, "no -shm/-wal (or anything else) may appear beside the DB");
  assert.ok(fs.readFileSync(dbPath).equals(bytesBefore), "DB bytes unchanged");
  assert.equal(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("summerlol-check-")).length, 0, "temp dir cleaned up");
});
