/**
 * Re-imports a filled-in pending-player-tags CSV (see export-pending-tags.js)
 * back into pending_lookups. Only game_name/tag_line/region are read —
 * rows where game_name or tag_line is still blank are left untouched
 * (still queued, still unresolvable until filled in).
 *
 * Usage:
 *   node data/import-pending-tags.js [input-path]
 *   (defaults to data/pending-player-tags.csv)
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { parse } = require('csv-parse/sync');

const DB_PATH = path.join(__dirname, 'app.db');
const inputPath = process.argv[2] || path.join(__dirname, 'pending-player-tags.csv');

const db = new Database(DB_PATH, { fileMustExist: true });
const raw = fs.readFileSync(inputPath, 'utf-8');
const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

let updated = 0;
let skippedBlank = 0;
let skippedUnknown = 0;

const update = db.prepare(
  `UPDATE pending_lookups SET game_name = ?, tag_line = ?, region = ?
   WHERE raw_name = ?`
);
const exists = db.prepare('SELECT 1 FROM pending_lookups WHERE raw_name = ?');

const importAll = db.transaction((rows) => {
  for (const row of rows) {
    const gameName = (row.game_name || '').trim();
    const tagLine = (row.tag_line || '').trim();
    const region = (row.region || '').trim() || 'americas';

    if (!exists.get(row.raw_name)) {
      skippedUnknown += 1;
      continue;
    }
    if (!gameName || !tagLine) {
      skippedBlank += 1;
      continue;
    }
    update.run(gameName, tagLine, region, row.raw_name);
    updated += 1;
  }
});

importAll(records);
db.close();

console.log(`Updated ${updated} pending lookups with a game_name/tag_line.`);
console.log(`Skipped ${skippedBlank} rows still blank (not ready to resolve yet).`);
if (skippedUnknown > 0) {
  console.log(`Skipped ${skippedUnknown} rows whose raw_name no longer matches anything in pending_lookups.`);
}
console.log('\nRun the sync next to actually resolve these against Riot\'s API:');
console.log('  node data/run-riot-sync.js');
