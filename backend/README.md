# Backend

The backend is an Express API backed by SQLite. It owns the data ingestion
scripts, identity resolution, match analysis, and the static frontend bundle.
Run commands in this guide from `backend/` unless a command says otherwise.

## Local Setup

Requires Node.js 22.12 or newer and npm. Install dependencies and start the API:

```sh
npm ci
npm start
```

The server listens on port 3000 by default. Set `PORT` to change it. It serves
the current frontend build from `public/` as well as the API. For live frontend
work, run Vite separately; see [the frontend guide](../frontend/README.md).

For Docker Compose, create the root-relative file `backend/.env` from
`backend/.env.example` (or run `cp .env.example .env` from this directory).
Compose reads that file; local `npm start` does not automatically load it.
Export variables in the shell when needed. `RIOT_API_KEY` enables Riot
lookups and scheduled sync. When set, `ADMIN_TOKEN` is required for
`POST /api/identity/sync`; when unset, that route is open. The identity
status endpoint is read-only and public. See `.env.example` for supported
environment variables.

## Tests

```sh
npm test
```

Tests use Node's built-in test runner and temporary SQLite databases/CSV files.
They cover ingestion, identity helpers, tournament summaries, data checks,
and TrueSkill behavior without modifying `data/app.db`.

## Data and Ingestion

The runtime database is `data/app.db` (it may be created locally and is not
tracked as source). Source CSVs can be supplied to the ingestion scripts;
they are not required for the server to start when the database already
exists. The Docker entrypoint ingests the draft CSV when
`CSV_PATH` is set (or `data/draft-data.csv` exists) and the CSV is newer than
the database. It can ingest match details at startup when
`MATCH_DETAILS_PATH` is set. Match results are loaded explicitly with the
match ingestion script.

Draft-pick CSV headers are exact and case-sensitive:

```text
Tournament,Year,Captain,Player,Pick Order,Rank
```

Match CSV requires `Year,Tournament,Team 1,Team 2,Result,Match Order`;
`Match Stage` is optional. Match order must be an integer and determines
chronological order within a tournament.

year, tournament, stage, and match order; draft and match data must be present
Match-details CSV requires these exact headers:

```text
Year,Tournament,Match Stage,Match Order,Player,Champion,K,D,A
```

`Role` and `Ban` are optional. Match-details rows are linked to games using
year, tournament, stage, and match order; draft and match data must be present
in the database to resolve teams.

Common commands:

```sh
npm run ingest-csv -- data/lol-draft-long.csv
npm run ingest-matches -- data/lol-draft-match.csv
npm run ingest-match-details -- data/lol-draft-match-details.csv
npm run check-data -- --draft data/lol-draft-long.csv \
  --matches data/lol-draft-match.csv \
  --details data/lol-draft-match-details.csv
npm test
```

Draft ingestion synchronizes rows by ID and removes rows no longer present in
an ID-bearing CSV. Pass `--fresh` to `ingest-csv` to recreate the draft table.
Match ingestion replaces the matches table. Match-details ingestion replaces
the details and bans tables. `check-data` uses a temporary database copy and
reports source CSV row numbers; it does not modify the real database.

`npm run refresh-all -- <draft.csv>` ingests the draft, queues newly seen
player names, and runs Riot identity sync when `RIOT_API_KEY` is set. To
manually resolve names, use `npm run export-pending-tags`, edit the exported
tag data, then use `npm run import-pending-tags` and `npm run sync-riot`.

## Code Map

- `server.js` registers the API routes and serves `public/`.
- `src/lib/` contains request-time domain logic: identity, Riot sync,
  TrueSkill, match details, and tournament summaries.
- `src/scripts/` contains ingestion, validation, export/import, and sync CLIs.
- `src/db/` contains SQL schema definitions.
- `test/` contains Node test-runner tests.
- `data/` contains the database and local input/state files; do not treat it
  as generated frontend output.
- `public/` contains the built frontend and static icons. Edit the frontend
  source under `../frontend/`, then run its build command to refresh this
  directory.

The main read API families are `/api/trueskill`, `/api/draft-analysis`,
`/api/tournaments`, `/api/player/:key`, `/api/raw`, and `/api/raw-matches`.
`GET /api/identity/status` is public. `POST /api/identity/sync` checks
`ADMIN_TOKEN` only when one is configured. Presets and upcoming-roster data
are served by `/api/presets*` and `/api/upcoming-roster`.
