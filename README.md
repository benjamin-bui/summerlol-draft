# LoL Draft Player Rankings

Small Express app: adjust a risk-aversion slider, see per-player mean,
std dev, and risk-adjusted average recalculated live across all
appearances. Data lives in SQLite, sourced from `Summer_LoL_Draft_Rankings.xlsx`'s
`Long` sheet.

**The CSV only needs `Tournament`, `Year`, `Captain`, `Player`, `Pick
Order`, and `Rank`.** `Pick Value` is *not* read from the CSV — the app
derives it itself, per year:

```
Pick Percentile = (Pick Order − 1) / (picks that year − 1)
Rank Percentile = (Rank − 1) / (captains that year − 1)
Pick Value       = Pick Percentile − Rank Percentile
```

This matches the original spreadsheet's formula exactly (verified
against every row of all 5 original seasons before this was built — max
deviation was floating-point noise). `data/lol-draft-long.csv` ships
with just those 7 columns — `Pick Percentile`/`Rank Percentile`/`Pick
Value` were stripped out entirely, since the app never reads them even
if they're present.

`GROUP_COL = 'Player'`, `CAPTAIN_COL = 'Captain'`, `PICK_ORDER_COL =
'Pick Order'`, `RANK_COL = 'Rank'` in `server.js` — change these if you
point the app at a different sheet/column layout.

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

### Auto-rebuild SQLite when you edit the CSV

**On Docker container start (implemented, recommended)** — the container's
`entrypoint.js` runs before the server starts on every container start:
it checks whether `data/lol-draft-long.csv` is newer than `data/app.db`
(or if the DB doesn't exist at all), and re-ingests automatically if so.
No manual step — edit the CSV, restart/redeploy the container, done.
Skips ingestion entirely if the CSV hasn't changed, so restarts stay
fast when there's nothing new. See the Docker section below for how the
volume mount makes this work.

**Watch mode (live, no restart)** — useful during active local editing,
run alongside `npm start`:

```bash
npm run watch-csv -- data/lol-draft-long.csv
```

Ingests once immediately, then re-ingests on every save (upsert by
`id`, not `--fresh` — so it won't remove rows you deleted from the CSV;
run the ingest command once with `--fresh` afterward if you did remove
rows and want that reflected).

**Manual re-run**, for occasional edits:

```bash
npm run ingest-csv -- data/lol-draft-long.csv
```

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
sqlite> UPDATE "rows" SET "Rank" = '3.5' WHERE "id" = 7;
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

**Using docker-compose (recommended)** — `docker-compose.yml` is
included, already set up with the `--user` approach below baked in:

```bash
cp .env.example .env       # fill in RIOT_API_KEY etc.
UID=$(id -u) GID=$(id -g) docker compose up -d --build
```

Exporting `UID`/`GID` before the command (or setting them in `.env`,
though `UID` is a shell-reserved name in some shells so exporting inline
like above is more reliable) makes the container run as your own host
user — see below for why that matters. To view logs: `docker compose
logs -f`. To stop: `docker compose down`.

**Using plain `docker` commands instead:**

**Recommended if you'll be hand-editing the CSV on the host** — run as
your own user instead of letting the container chown things to a fixed
internal UID:

```bash
docker build -t summerlol-draft .
docker run -p 3000:3000 -v $(pwd)/data:/app/data \
  --user "$(id -u):$(id -g)" \
  summerlol-draft
```

With `--user` set, `docker-entrypoint.sh` detects it isn't running as
root and skips the chown step entirely — the container just runs as your
own host UID from the start, so every file it touches (including
`app.db`) stays owned by you. No more permission dance: edit the CSV in
your normal editor, no `sudo`/`chown` needed before or after.

**Without `--user`** (simpler command, but ownership gets pinned to a
fixed internal UID):

```bash
docker build -t summerlol-draft .
docker run -p 3000:3000 -v $(pwd)/data:/app/data summerlol-draft
```

Here, `docker-entrypoint.sh` runs as root just long enough to `chown`
`/app/data` to the container's internal `node` user (UID 1000 in
`node:alpine`), then drops privileges via `su-exec` before the app
actually runs. This is what fixes a freshly-mounted volume of unknown
ownership so SQLite can write to it — otherwise you'd hit
`SQLITE_READONLY: attempt to write a readonly database` the moment it
tries to write (reads can still work even when the owning UID
mismatches, since read/write are separate permission bits — which is why
this can pass a quick smoke test and only surface on a real write). The
tradeoff is exactly the annoyance you ran into: every file ends up owned
by UID 1000 afterward, so editing the CSV from your host user needs a
`chown`/`sudo` round-trip each time. The `--user` approach above avoids
this entirely by never letting UID 1000 own anything in the first place.

**Caveat**: a small number of network filesystems / managed volume
types disallow `chown` even as root. If you see the entrypoint script
itself fail on the `chown` line, use the `--user "$(id -u):$(id -g)"`
approach above instead — it never needs to `chown` at all.

**Migrating from a manual `chown -R 1000`**: if you'd already worked
around the permissions issue by chowning `data/` to `1000` by hand, your
files are currently owned by that UID, not your own host user. Switching
to `--user "$(id -u):$(id -g)"` needs one one-time fix first, or the
container (now running as your own UID) won't be able to write to files
still owned by `1000`:

```bash
sudo chown -R "$(id -u):$(id -g)" data/
```

After that, every subsequent `docker run --user "$(id -u):$(id -g)" ...`
keeps everything owned by you — no more back-and-forth.

## Notes

- `SD_MODE` in `server.js` defaults to `'sample'` (n−1 divisor), matching
  the workbook's `STDEV.S`.
- The risk-aversion weight defaults to 0.5 in the UI, matching the
  workbook's `k` value (`Score!H2`).
- **Column order/defaults**: `#`, Player, **Adjusted Pick Value** (the
  main ranking metric, placed right after Player), `n`, then Unadjusted
  Pick Value (the plain weighted mean — hidden by default) and Std. Dev.
  (hidden by default), then Avg. Pick % paired with **Est. Pick
  Order**, then Avg. Rank % paired with **Est. Rank Order**. All
  of this is adjustable via the Columns ▾ button.
- **Avg. Pick % / Avg. Rank %** display as true percentages (e.g. "63%"),
  though the underlying value is still a 0–1 fraction internally — this
  matters if you filter on these columns: the filter popover expects
  percentage terms (enter `50` for 50%), and converts back down to the
  0–1 scale before comparing, to match what's actually stored.
- **Est. Pick Order / Est. Rank Order**: translates a percentage back
  into an ordinal number on a scale of your choosing — "if this were a
  league of N total picks, what pick number does this percentage
  correspond to." Controlled by the **Total N** field next to the
  sliders (defaults to 40, matching this dataset's actual season size).
  **Est. Pick Order** scales against N directly; **Est. Rank Order**
  scales against **N/4** instead, since N/4 is the actual number of
  teams (each team gets 4 picks in this draft format) — Rank % was
  always normalized against team count, not pick count, so this keeps
  the estimate consistent with how the percentage itself was computed.
  Pure client-side math against whatever's already been fetched —
  changing N re-renders instantly with no server round-trip.
- **Avg. Pick % / Avg. Rank %** (not Pick Order/Rank
  directly) use the same recency (EWMA) weighting as Pick Value's
  mean/std dev. Percentiles are normalized *per season* — each season's
  Pick Percentile divides by that season's own pick count minus 1, and
  Rank Percentile by that season's own captain count minus 1 — so a
  season with a different number of entrants than another still
  normalizes correctly against its own total, not a borrowed one. This
  was verified with a synthetic 6-captain/24-pick season alongside the
  real 10-captain/40-pick seasons, confirmed against independently
  hand-computed values. (For the record: checked directly, the real
  2020 season turned out to have the same 10 captains/40 picks as every
  other season here — there wasn't actually a fewer-entrants case in
  this dataset, but the math handles it either way.)
- **Partial-data seasons are supported.** A row can have `Pick Order`
  and `Captain`/`Player` filled in while `Rank` is blank (e.g. a season
  where post-tournament placement data isn't available yet) — that row
  still counts toward `n`, but Pick Value/percentiles can't be derived
  without `Rank`, so they're correctly excluded from mean/std
  dev/adjusted average rather than being treated as a zero. This depends
  on blank CSV cells being ingested as true SQL `NULL` rather than empty
  string — `CAST('' AS REAL)` in SQLite silently returns `0`, not `NULL`,
  which would otherwise corrupt the averages. `csv-to-sqlite.js` converts
  empty cells to `NULL` on ingest specifically to avoid this.
- **Per-column filtering**: click the ▾ icon in any column header (not
  the header label itself, which sorts) to open that column's filter.
  Player gets a regex text field (case-insensitive); numeric columns get
  greater-than/less-than/between. Multiple columns can be filtered
  simultaneously (combined with AND). Available on both the Rankings and
  Raw Data tables. Sorting still works normally by clicking the header
  label while a filter is active.
- **Column visibility**: the "Columns ▾" button toggles which columns
  are shown. Player and `#` are always shown; everything else is
  optional.
- **Raw Data tab**: shows every underlying row (not aggregated by
  player) in the same tabular UI — sortable, filterable by any column,
  and with a "Download CSV" button that streams straight from
  `/api/raw.csv` (the `id` column is omitted, since it's an internal key
  with no meaning outside the database). Numeric columns (Pick Order,
  Rank, Year...) are coerced from string to real numbers once when the
  data loads, so they sort numerically (1, 2, 10, 11) rather than
  lexicographically (1, 10, 11, 2) — every raw value arrives as a string
  from SQLite/CSV, so without this the sort comparator's numeric path
  never actually triggered.
- **Notes area** (top of the page, above the tabs): plain static HTML in
  `public/index.html` (look for the `.notes-section` block) — edit it
  directly to add context on how to interpret the numbers. No backend,
  no save button; whatever's in the file is what's shown. Basic tags
  (`<p>`, `<strong>`, `<em>`, `<ul>`/`<li>`, `<br>`) all render fine.
- Layout is fluid up to 1400px so columns aren't hidden/cut off on
  screens with room to show them; below that, the table scrolls
  horizontally rather than dropping columns.
- **Dark/light mode toggle** (top-right of the header). Defaults to
  following the OS/browser's `prefers-color-scheme` — if your system is
  in light mode, the app opens in light mode, and it keeps following
  system changes live until you manually click the toggle, at which
  point your explicit choice (saved in `localStorage`) takes over
  permanently. Light mode's palette is pulled directly from a Glance
  dashboard reference (`#fcf3f6` background, `#e8639a` pink for general
  interactive/hover states, `#9edef9` blue for "active/current" states
  like the selected tab — mirroring that reference's own distinction
  between its general link color and its `nav a.active` color). Fonts
  are unchanged between themes — the reference page loads its fonts
  through an external stylesheet this app doesn't have access to, so
  there was nothing concrete to match; let me know if you want a
  specific font and I'll wire it in.
- All of the Rankings tab's state lives in the URL
  (`?risk=&halfLife=&sort=&dir=&hidden=&totalN=&tab=`), so a bare visit
  fills in the defaults and the URL updates as you interact — reloading,
  bookmarking, or sending someone a link reproduces the exact same view.
  Per-column filter state is **not** URL-persisted (regex patterns and
  numeric thresholds would make for unwieldy URLs) — filters reset on
  reload, same as the Raw Data tab's own sort/filter state.
- Dataset size (~200 rows) is small enough that every stats request
  reads the whole table and computes in JS — no SQL-side aggregation
  needed.

## Alternative ranking methodologies (Expected ROI / Tiers tabs)



### Reusable table infrastructure
Both of these tabs are built on a new `createTabTable()` factory in
`app.js` — column-config-driven sortable/filterable/column-toggleable
table, reusing the same header-popover/regex-filter/inequality-filter
machinery Rankings already established. Rankings and Raw Data predate
this factory and weren't retrofitted onto it (each has some tab-specific
behavior — Rankings' derived Est. Order columns, Raw Data's dynamic
per-CSV column discovery — that made the retrofit riskier than it was
worth for two tabs that already worked), but it's a reasonable starting
point for any future "table of players with some computed metric" tab —
which covers most of what this app does. Usage is basically:

```js
const myTable = createTabTable({
  columns: [...],                // same column-def shape as elsewhere
  headerRowEl, bodyEl,            // <tr> in <thead>, <tbody> element
  columnsBtnEl, columnsPanelEl,   // the Columns ▾ button + dropdown
  ownerKey: 'someUniqueName',     // must be unique across all tables on the page
  defaultSortColumn: 'someKey'
});
myTable.setData(arrayOfRowObjects); // (re)renders, respecting current sort/filter/hidden state
```

## Player identity tracking (Riot API)

Solves the "same player, different name across seasons" problem
structurally: `Rlylost` and `rlylost` (or a genuine in-game rename) are
just different strings unless something ties them to the same underlying
Riot account. This adds that — permanent-ID tracking via Riot's
Account-V1 API, PUUID as the true identity key, with the raw `Player`
column values just becoming aliases pointing at it.

**Design is additive** — a new set of tables (`players`, `player_aliases`,
`pending_lookups`, `name_history`, `sync_state` — see
`data/identity-schema.sql`)
alongside the existing `rows` table, which is completely untouched. If
you never run the bootstrap script, the app behaves exactly as it did
before this feature existed.

### Setup

1. **Get a Riot API key** at https://developer.riotgames.com/. A personal
   dev key works for testing but expires every 24 hours and is tightly
   rate-limited; apply for a Personal or Production key for real use.
2. Copy `.env.example` to `.env` and fill in `RIOT_API_KEY` (and
   `RIOT_REGION`/`OPGG_REGION` if NA doesn't apply to you).
3. **Bootstrap the identity tables** from your current dataset:

   ```bash
   npm run bootstrap-identities
   ```

   This creates a player+alias row for every distinct name in the
   `Player` column. Any name already in `Name#Tag` format gets queued
   for lookup automatically (it even strips trailing junk like
   `"Xemacs#4328 (Santiago)"` down to just the tag). Safe to re-run any
   time you ingest a new season — only genuinely new names get queued,
   nothing already resolved is touched.
4. **Fill in tags for names that don't have one yet**:

   ```bash
   npm run export-pending-tags        # writes data/pending-player-tags.csv
   # ...edit the CSV, fill in game_name/tag_line for whichever names you know...
   npm run import-pending-tags        # reads it back in
   ```

5. **Run the sync**:

   ```bash
   RIOT_API_KEY=your-key npm run sync-riot
   ```

   This does two passes: resolves every pending lookup that now has a
   tag, then re-checks every already-resolved player to catch renames.
   Check progress any time with `GET /api/identity/status`.

### Ongoing edits: fixing a missing or wrong tag later

**`sync-riot` alone does not see CSV edits** — it only resolves against
what's already sitting in `pending_lookups`/`players`. If you edit the
CSV directly (add a tag that was missing, or correct one that was
wrong), that change needs to reach the database first:

```bash
node src/scripts/csv-to-sqlite.js data/lol-draft-long.csv   # 1. re-ingest the edit
npm run bootstrap-identities                          # 2. queue the new/changed name
RIOT_API_KEY=your-key npm run sync-riot                # 3. actually resolve it
```

Or in one command:

```bash
RIOT_API_KEY=your-key npm run refresh-all
```

This was tested concretely (not just described): adding a tag directly
in the CSV and running `sync-riot` alone left the old, untagged
`pending_lookups` row completely untouched — proving the shortcut
doesn't work — then running the ingest+bootstrap steps correctly queued
the new tagged name for resolution. Editing an *existing* tag (rather
than adding one to a previously-untagged name) behaves the same way:
the old raw string becomes an orphaned, harmless, unreferenced alias
(nothing in the CSV points to it anymore), and the corrected string
gets bootstrapped as if new. If the correction happens to resolve to a
PUUID that's already tracked under another alias, the existing
merge-on-resolve logic in `applyResolvedAccount()` handles it the same
way it handles any other rename — no special-casing needed.

### What you get once a player is resolved

- Their entries in the Rankings table link to their **op.gg profile**.
- If two different raw names in your data (a typo, a rename, whatever)
  turn out to be the same PUUID, **they merge into one ranked entry** —
  this is the actual point of the feature, not just the profile link.
- `puuid` itself is never returned by any API route — treated as
  backend-only, matching standard practice for this kind of identifier.

### Automatic 14-day sync

The server checks, every 6 hours, whether 14 days have passed since the
last full sync (persisted in the `sync_state` table, so a restart
doesn't reset the countdown) — if so, it runs the same resolve+refresh
pass as `npm run sync-riot` automatically, no manual step needed. Skips
entirely (logs one line, does nothing further) if `RIOT_API_KEY` isn't
set. A failed sync deliberately does *not* update the timestamp, so the
next check retries rather than waiting another full 14 days.

### Admin endpoints

- `GET /api/identity/status` — counts of resolved/unresolved/pending.
- `POST /api/identity/sync` — triggers a sync pass over HTTP instead of
  the CLI (useful for a cron job). Requires `RIOT_API_KEY` to be set on
  the server. If you set `ADMIN_TOKEN`, this route requires it as an
  `X-Admin-Token` header; if unset, it's open (fine for a personal
  deployment, worth setting for anything publicly reachable).

### Important: what's actually been tested here, and what hasn't

`api.riotgames.com` isn't reachable from the sandbox this was built in
(its network allowlist doesn't include Riot's domain), so **the actual
HTTP calls to Riot have never run against the real API** — only against
mocked responses. The test scripts that verified this during development
(retry/backoff behavior, resolve/refresh/merge logic, the scheduler's
due-date math) aren't shipped in this package — they were development-time
verification, not app functionality — but what they confirmed, concretely:

- Retry/backoff — respects `Retry-After` on 429s, retries 5xx up to a
  limit, doesn't retry 404s, rejects invalid regions before making a
  network call.
- Resolve/refresh/merge — a successful resolve stores the PUUID and
  clears the pending row; a failure increments the attempt counter and
  records the error; a rename is detected and logged to `name_history`;
  a `name_locked` player is never overwritten; **two different raw
  aliases resolving to the same PUUID get merged into one player**, not
  left as duplicates.
- The full pipeline through the actual stats API (`GET /api/stats`) —
  simulated a real merge scenario (two raw spellings of "Rlylost"
  pointed at the same fake PUUID) and confirmed the rankings correctly
  show ONE entry with the combined appearance count, correct merged
  mean/std dev (cross-checked independently against a hand calculation),
  and a working op.gg link.
- The 14-day automatic scheduler — confirmed it correctly identifies
  "due" vs "not due" at the 13/14/15-day boundaries, that a successful
  sync updates the persisted timestamp while a failed one deliberately
  doesn't (so it retries on the next check rather than waiting a full 14
  days again), and that it no-ops cleanly with no `RIOT_API_KEY` set.
- Graceful degradation — `/api/stats` and `/api/identity/status` both
  behave sensibly before `bootstrap-identities` has ever been run (no
  tables yet), and the CSV/Docker/entrypoint pipeline all still work
  unchanged if you never touch this feature at all.

## Loading Individual Match Data

```bash
node src/scripts/ingest-matches.js data/lol-draft-match.csv
```