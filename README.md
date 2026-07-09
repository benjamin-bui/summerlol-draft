# LoL Draft Player Rankings

Small Express app: adjust a risk-aversion slider, see per-player mean,
std dev, and risk-adjusted average recalculated live across all
appearances. Data lives in SQLite, sourced from `Summer_LoL_Draft_Rankings.xlsx`'s
`Long` sheet (Tournament, Year, Captain, Player, Pick Order, Rank, Pick
Percentile, Rank Percentile, Pick Value).

`GROUP_COL = 'Player'` and `VALUE_COL = 'Pick Value'` in `server.js` —
change these if you point the app at a different sheet/column layout.

## Data workflow

### First-time setup / re-loading a full CSV
```bash
npm install
node data/csv-to-sqlite.js data/lol-draft-long.csv --fresh
npm start
```
`--fresh` drops and recreates the table — use it when replacing the
whole dataset (e.g. a new season's export from the `Long` sheet).
Omit it and re-running **upserts** by `id` instead, so periodically
re-exporting the spreadsheet and re-running this won't wipe manual
corrections made directly in the SQLite file.

A generic sample dataset (`data/sample-data.csv`) is also included from
earlier development, if you want to see the app running against
differently shaped data.

### A note on the source spreadsheet
The original `Score` sheet's **Average** column has a formula bug: it
uses a table "this row" structured reference (`Table1[[#This Row],[Player]]`)
as the AVERAGEIF criteria range, which collapses to just that row's own
value rather than averaging across all of a player's appearances. The
**StdDev** column doesn't have this bug (it uses `FILTER` over the full
column correctly). This app's calculation does a proper full-group
average — matching what `StdDev` already does — not the buggy
single-row behavior, per your call not to carry the bug forward.

### Making manual changes to the data

**Quickest, for one-off fixes** — SQL directly:
```bash
sqlite3 data/app.db
sqlite> UPDATE "rows" SET "Pick Value" = '0.15' WHERE "id" = 7;
sqlite> .quit
```
Note the double quotes around identifiers with spaces or reserved
words (`"Pick Value"`, `"rows"`) — required or the SQL parser errors.

**Easiest for occasional edits** — [DB Browser for SQLite](https://sqlitebrowser.org/),
a free GUI. Open `data/app.db`, edit cells like a spreadsheet, "Write
Changes" to save.

**If edits happen often** — worth adding an admin route
(`POST /api/rows/:id`) to the Express app instead of hand-editing the DB
each time. Not built here since it adds real surface area (validation,
auth) — flag it if this becomes a frequent need.

## Docker

```bash
docker build -t risk-stats-app .
docker run -p 3000:3000 -v $(pwd)/data:/app/data risk-stats-app
```

The `-v` volume mount points the container's `/app/data` at your local
`data/` folder, so the SQLite file (and any manual edits) persists
across container restarts and rebuilds, and you can re-ingest updated
CSVs on the host without rebuilding the image.

## Notes

- `SD_MODE` in `server.js` defaults to `'sample'` (n−1 divisor), matching
  the workbook's `STDEV.S`.
- The risk-aversion weight defaults to 0.5 in the UI, matching the
  workbook's `k` value (`Score!H2`).
- Dataset size (~200 rows) is small enough that every stats request
  reads the whole table and computes in JS — no SQL-side aggregation
  needed.
