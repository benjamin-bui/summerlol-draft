// data/ingest-matches.js
// One-off/rerunnable loader for the head-to-head match CSV, mirroring the
// pattern of bootstrap-player-identities.js. Run with:
//   node data/ingest-matches.js path/to/lol-draft-match.csv
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'app.db');

// Minimal RFC4180-ish line parser (handles quoted fields defensively even
// though the current export doesn't use any) -- consistent with the
// existing csvEscape() in server.js being the mirror-image of this.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') { if (field !== '' || row.length) pushRow(); }
    else if (c === '\r') { /* skip, \n handles the row break */ }
    else field += c;
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node data/ingest-matches.js <path-to-match-csv>');
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, 'utf8');
  const [header, ...rows] = parseCsv(text);
  const idx = {
    year: header.indexOf('Year'),
    tournament: header.indexOf('Tournament'),
    team1: header.indexOf('Team 1'),
    team2: header.indexOf('Team 2'),
    result: header.indexOf('Result')
  };
  for (const [key, i] of Object.entries(idx)) {
    if (i === -1) throw new Error(`Missing expected column for "${key}" in ${csvPath}`);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      tournament TEXT,
      team1 TEXT NOT NULL,
      team2 TEXT NOT NULL,
      result TEXT NOT NULL
    )
  `);

  // Idempotent: wipe and reload rather than trying to dedupe/upsert, since
  // there's no natural unique key across two teams playing repeat games.
  db.exec('DELETE FROM matches');
  const insert = db.prepare(
    'INSERT INTO matches (year, tournament, team1, team2, result) VALUES (?, ?, ?, ?, ?)'
  );
  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      if (!r[idx.year]) continue; // skip trailing blank lines
      insert.run(
        parseInt(r[idx.year], 10),
        r[idx.tournament] || null,
        r[idx.team1],
        r[idx.team2],
        r[idx.result]
      );
    }
  });
  insertMany(rows);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM matches').get();
  console.log(`Loaded ${n} matches into ${DB_PATH}`);
}

main();