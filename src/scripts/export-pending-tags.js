/**
 * Exports every pending_lookups row that's still missing a game_name/tag_line
 * to a CSV, so they can be filled in by hand (same spreadsheet-editing
 * workflow used elsewhere in this project) and re-imported with
 * import-pending-tags.js.
 *
 * Usage:
 *   node data/export-pending-tags.js [output-path]
 *   (defaults to data/pending-player-tags.csv)
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'app.db');
const outputPath = process.argv[2] || path.join(__dirname, 'pending-player-tags.csv');

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

const db = new Database(DB_PATH, { fileMustExist: true });
const rows = db
  .prepare(
    `SELECT raw_name, game_name, tag_line, region, attempts, last_error
     FROM pending_lookups
     ORDER BY raw_name`
  )
  .all();
db.close();

const header = ['raw_name', 'game_name', 'tag_line', 'region', 'attempts', 'last_error'];
const lines = [header.join(',')];
for (const row of rows) {
  lines.push(header.map((col) => csvEscape(row[col])).join(','));
}

require('fs').writeFileSync(outputPath, lines.join('\n'));
console.log(`Exported ${rows.length} pending lookups to ${outputPath}`);
console.log(`${rows.filter((r) => !r.game_name || !r.tag_line).length} of these are still missing a game_name/tag_line.`);
