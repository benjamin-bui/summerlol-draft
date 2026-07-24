# Summer LoL Draft

Express app for a League of Legends captain-draft tournaments. Two
CSV-sourced datasets — who was drafted onto which team, and individual
head-to-head match results — feed six tabs: classic Pick Value
**Rankings**, a **TrueSkill** rating system with full match history and
player profiles, **Draft IQ** and **Team Balance** (how good is each
captain at drafting, and does a stacked roster actually win), plus raw
**Draft Data** / **Matchup Data** table views.

## Data model

Two source CSVs, two SQLite tables:

- **`rows`** (from `lol-draft-long.csv`) — one row per drafted pick:
  `Tournament`, `Year`, `Captain`, `Player`, `Pick Order`, `Rank`. `Rank`
  is the *whole team's* final placement that tournament (every pick on a
  team shares the same value), used for both classic Pick Value and Draft
  IQ/Team Balance's placement column.
- **`matches`** (from `lol-draft-match.csv`) — one row per individual
  head-to-head game: `Year`, `Tournament`, `Team 1`, `Team 2`, `Result`,
  `Match Order`, `Match Stage`. This is what TrueSkill actually rates —
  many individual games per tournament, not one outcome per season.

Each year now has two tournaments/splits, **Winter** and **Summer**
(Winter drafts came later — a team's roster falls back to whichever
draft *does* exist for that year+captain if a tournament-specific one
isn't on file yet). A captain's roster for a given tournament is: their
4 drafted picks, plus the captain themselves, force-included even if
they never appear as a `Player` row — they still play every game their
team plays.

## CSV column requirements

**`lol-draft-long.csv`**: `Tournament, Year, Captain, Player, Pick Order,
Rank` — exact header names, case-sensitive. `Pick Value`/percentile
columns are derived by the app, never read from the CSV even if present.

**`lol-draft-match.csv`**: `Year, Tournament, Team 1, Team 2, Result,
Match Order, Match Stage` — same exactness requirement.
`Match Order` is required and must be a valid integer on every row —
it's the authoritative chronological sequence within a year+tournament
(ties are fine; they represent genuinely simultaneous games and never
share a player, so tie order can't affect any rating). `Match Stage`
(e.g. "Groups", "Semifinals", "Finals") is optional context, not used
for any calculation. Games are processed **year ascending, Winter before
Summer within a year, then Match Order ascending** — this exact order
is what makes TrueSkill's sequential rating updates correct.

The **Download CSV** buttons on the Matchup Data tab write these exact
canonical header names back out (not the raw DB column names), so a
downloaded export round-trips straight back through `ingest-matches.js`
with no renaming needed.

## Data workflow

```bash
npm install
node src/scripts/csv-to-sqlite.js data/lol-draft-long.csv --fresh
node src/scripts/ingest-matches.js data/lol-draft-match.csv
npm start
```

**`csv-to-sqlite.js` now does a real sync, not just an upsert.** Editing
or deleting a row in the spreadsheet (e.g. correcting a mislabeled draft
pick) removes the corresponding DB row too — any `id` present in the DB
but no longer present in the CSV gets deleted. (This used to be
upsert-only/append-only, which meant a corrected row would silently
leave the old, wrong row behind forever — fixed.) `--fresh` instead
drops and recreates the table entirely; only needed if the CSV's column
list itself changed. Re-run this any time `lol-draft-long.csv` changes.

**`ingest-matches.js` always does a full drop+recreate** on every run
(there's no natural unique key to upsert match rows against) — re-run it
any time `lol-draft-match.csv` changes.

Auto-rebuild on container start, watch mode, and manual re-run all work
the same way described further down — same commands, same semantics,
just pointed at the fixed sync behavior above.

## Tabs

### Rankings
Classic Pick Value methodology (Pick Percentile − Rank Percentile,
recency-weighted). The risk-aversion and half-life sliders have been
removed from the UI — `risk`/`halfLife` are now fixed at `0.25`/`2`
directly in `app.js` (`currentSliderValues()`). Column
show/hide, per-column filtering, and the **Total N** → Est. Pick/Rank
Order translation are unchanged from before.

### TrueSkill
Rates every player using [`ts-trueskill`](https://github.com/scttcper/ts-trueskill),
treating **each individual match** (not each tournament) as one game:
each side is a captain's full roster, ranked by that match's actual
result. Games are replayed in strict chronological order (see ordering
rule above) so every player's rating reflects only what was known up to
that point — never later hindsight.

**Parameters** (all overridable via query params on `/api/trueskill`):
`mu=1000`, `sigma=mu/3`, `beta=mu/4`, `tau=sigma/50`, `drawProbability=0`
(this league's `Result` always names an exact winner — no real draws),
`conservativeK=1`. The displayed **TrueSkill** score is `μ − k·σ` — a
pessimistic, uncertainty-discounted estimate deliberately biased low for
players with few games, distinct from **μ** (raw skill estimate) and
**σ** (uncertainty). `conservativeK` was dropped from the library's usual
`3` down to `1` — at this dataset's game counts (3–57 per player), a
`3σ` discount was leaving even established players' TrueSkill number far
below their μ, which read as confusing rather than informative.

**Predicted win probability** (`predictedWinProb` per game) is computed
directly from μ/σ, independent of the conservative TrueSkill number —
worth knowing, since a player with few games can show a lower TrueSkill
than their μ and predicted win chances alone would suggest; this
divergence narrows as more games are recorded, it isn't a bug.

**Rank badges**: every displayed TrueSkill/conservativeRating value (in
the TrueSkill table, and next to individual players in match history
rosters) shows a small rank icon alongside the number, based on the same
absolute-rating tier thresholds as the fun-facts percentile table
(Master/Diamond/Emerald/Platinum/Gold/Silver/Bronze/Iron, using real LoL
rank-distribution cutoffs, not evenly-spaced round numbers). Icon assets
live in `public/icons/`.

**Fun facts** (collapsible box, top of the tab): TrueSkill percentile
cutoffs mapped to real League of Legends solo-queue rank tiers
(Challenger through Iron 4, using actual published rank-distribution
data — not evenly-spaced round numbers), plus biggest upset, biggest
single-game rating gain/drop, longest win/loss streak, highest/lowest
TrueSkill ever reached, most games played, and most active rivalry
(the captain-pair matchup with the most games played against each
other, keyed by captain identity so a roster's turnover year to year
doesn't split one rivalry into several).

**Player profiles**: click any name to open a modal — op.gg link,
TrueSkill/μ/σ stat cards (with the μ−kσ formula shown inline), a
game-by-game TrueSkill line chart (colored by win/loss/draw), and a full
match history table. Each history row expands to show that game's own
roster and the opponent's roster (with each player's rating at the time)
via the reusable `expandable` detail-row feature (see below).

### Draft IQ
Answers "does this captain draft the highest-value available player."
For every draft pick ever made, all players in that same year+tournament
draft class are ranked by their TrueSkill **entering that tournament**
(a snapshot of their rating at the moment their first game of that
tournament started — not their current/final rating, which would be
hindsight). **Value = (entering-skill rank) − (actual pick order)** —
positive means a player went later than their skill justified (a steal),
negative means they went earlier (a reach). A captain's **Draft IQ** is
their average pick value across every draft they've participated in.

Tournaments where every player's entering rating is still the untouched
starting default (i.e. the league's very first tournament, before any
history exists to rank anyone by) are excluded entirely from this
calculation — there's no real skill signal to rank against yet.

**Known limitation, stated explicitly in the tab's own explainer note**:
this compares against a *fixed, final* skill ranking of the whole draft
class, not a live best-remaining-player board — it doesn't credit a
captain for "the best option was already gone by the time it was their
turn." **Empirically, in this league's actual data, Draft IQ correlates
moderately *negatively* with win rate** — read as evidence that drafting
for role/team fit matters more here than drafting for raw best-available
skill, not as a flaw in the metric.

Click a captain's name for their full draft history, grouped by
tournament, with each pick's order/entering-rank/value and that
tournament's win-loss record. A collapsible **Draft IQ vs Win Rate**
scatter plot (one point per drafted team, never per captain-aggregate,
so no match is ever double-counted) supports drag-to-zoom, hover
tooltips, click-to-isolate a point or a whole group, a "Color by"
dropdown (Ungrouped / Captain / Year / Year:Tournament) with an
auto-generated legend, and a dashed least-squares trend line.

### Team Balance
For every drafted team (one row per year+tournament+captain), shows
average entering TrueSkill across the full 5-person roster (4 picks +
captain, force-included and deduplicated the same way TrueSkill's own
roster-building does) against that team's actual win rate. **Final
Stage** shows the last stage (Groups/Semifinals/Finals/etc.) that team
is recorded playing in, taken from the last `Match Stage` value in
chronological `Match Order` sequence — not a hardcoded stage hierarchy,
so it works regardless of what stage names a given tournament uses.
Each row expands to show the full roster and that team's complete match
list (opponent, result, stage, predicted win %) for that tournament.

### Draft Data / Matchup Data
Raw, per-row views of the `rows`/`matches` tables respectively —
sortable, column show/hide, downloadable as CSV
(`/api/raw.csv`/`/api/raw-matches.csv`, both `id`-free; Matchup Data's
export uses the canonical header names described above). Per-column
filters are either a checkbox multi-select (for small enumerable sets —
`Tournament`, and any similarly bounded column) or free-text regex (for
open-ended columns like `Player`/`Captain`/`Team 1`/`Team 2`/`Result`) —
set per-column via `filterType: 'checkbox'` in the column definition;
regex is the default. Matchup Data's rows also expand to show both
teams' full rosters for that match.

## Reusable table infrastructure

`createTabTable()` in `app.js` still powers every non-Rankings/Raw-Data
table (column-config-driven sort/filter/show-hide, shared header-popover
machinery). Since it was first built it's gained:

- **`col.render(value, row)`** — an escape hatch for a column that needs
  custom markup (e.g. a clickable captain-name link) instead of the
  default `escapeHtml(formatCell(...))` path.
- **`col.sortValue(row)`** — sorts by a derived/underlying value instead
  of the displayed string (used so "Best Pick"/"Worst Pick", which
  display a formatted sentence, still sort by the actual pick value
  number).
- **`col.filterType: 'checkbox'`** — opts a string column into the
  checkbox multi-select filter; every other string column defaults to
  free-text regex.
- **`expandable: { getDetailHtml(row) }`** — adds a toggle column and an
  expandable detail row under each row of data, used by both the
  Matchup Data roster dropdown and the Team Balance roster+match-list
  dropdown.

Rankings and Raw Data still predate this factory and aren't retrofitted
onto it, for the same reasons as before (Rankings' derived Est. Order
columns, Raw Data's now-split-in-two dynamic column discovery).

## Player identity tracking (Riot API)

Unchanged in design from before — permanent PUUID-based identity via
Riot's Account-V1 API, with raw `Player`/`Captain` strings as aliases
pointing at a canonical identity. One addition: **`buildReverseIdentityLookup`**
(in `src/lib/player-identity.js`) builds an `identityKey → display info`
map once per request, shared by both the identity-resolution pipeline
and TrueSkill's `displayInfo()` lookup — this fixed a bug where a
correctly identity-matched captain who never appears as a `Player` row
(only ever drafts, never gets drafted) would otherwise show their raw
internal identity key instead of their real name.

Setup, bootstrap, tag-resolution workflow (`export-pending-tags` →
edit CSV → `import-pending-tags` → `sync-riot`), the 14-day automatic
scheduler, and the admin endpoints are all unchanged — see the setup
steps and admin endpoint list further down.

**Reminder if you edit a name/tag directly in the CSV**:
`sync-riot`/the periodic scheduler only resolve against what's already
queued — a CSV edit needs `csv-to-sqlite.js` → `bootstrap-identities` →
`sync-riot` (or `npm run refresh-all`, which does all three) before the
correction actually takes effect. This is also the resolution path for
the "captain drafted the wrong person" bug class encountered during
development — if a raw CSV correction alone doesn't seem to take effect
in the app, check the ingestion actually re-ran and wrote back
correctly, not the identity layer.

## Folder structure

```
data/                      # pure state -- nothing executable
  app.db
  lol-draft-long.csv
  lol-draft-match.csv
  pending-player-tags.csv
  identity-schema.sql

src/
  lib/                      # required by server.js at runtime
    player-identity.js
    riot-sync.js
    trueskill-matches.js
    trueskill-funfacts.js
    draft-analysis.js
  scripts/                  # run manually or via cron/docker-entrypoint
    bootstrap-player-identities.js
    csv-to-sqlite.js
    ingest-matches.js
    export-pending-tags.js
    import-pending-tags.js
    run-riot-sync.js
    refresh-all.js
    watch-csv.js
    scheduler.js             # started from server.js at boot, but lives
                             # here alongside the other cron-adjacent scripts

public/
  app.js
  index.html
  style.css
  icons/                    # rank-tier badge images (Master/Diamond/.../Iron)

server.js
```

The `lib` vs `scripts` split is: does `server.js` `require()` it and run
it per-request (lib), or is it something you invoke by hand or via
`docker-entrypoint.sh`/cron (scripts). `data/` holds only state — safe
to bind-mount, safe to back up independently of the code.

## Deployment

Runs in Docker. In the actual deployed environment: **the data volume
is a real host file path mounted into the container** (a bind mount,
not a named/managed Docker volume) — `data/app.db` and both CSVs live
directly on the host and are edited/inspected there directly, same as
described in the local Docker instructions below. **`RIOT_API_KEY` is
supplied to the container as a Docker secret / environment variable at
deploy time**, not read from a checked-in `.env` file in production —
`.env`/`.env.example` remain the right approach for local development
only.

The `--user "$(id -u):$(id -g)"` vs. root+chown tradeoff, the
one-time `chown` migration step, and the network-filesystem `chown`
caveat described in the original Docker section are all still accurate
and unchanged — see below for the full commands.

[... existing Docker command reference, sample-data note, spreadsheet
formula-bug note, and full identity-tracking setup/testing details
continue unchanged from the previous version of this README ...]