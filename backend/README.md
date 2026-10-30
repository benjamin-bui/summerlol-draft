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

## Editor Login and the Match Editor

Approved people can sign in with any OpenID Connect provider (Forgejo,
Authentik, Keycloak, Google, ...) and edit a match's champions, K/D/A, roles
and bans from the **Match History** tab (expand a match, then *Edit match
details*). Everyone else -- signed in or not -- stays read-only. With no
`OIDC_*` settings the whole feature is off: no login route exists and
`/api/editor/*` answers 403.

Setup, in `backend/.env` (see `.env.example` for every option):

1. Register the app with your provider. Redirect URI:
   `<PUBLIC_URL>/auth/callback`; scopes `openid profile email`.
2. Set `PUBLIC_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`.
3. Say **who may edit** with at least one of `OIDC_EDITOR_SUBS`,
   `OIDC_EDITOR_EMAILS` (counted only if the provider marks the address
   verified) or `OIDC_EDITOR_GROUPS` (read from `OIDC_GROUPS_CLAIM`). Signing in
   is not enough: anyone not matching a rule is turned away with no session, and
   with no rules nobody can edit.

How access is enforced (all server-side; hiding buttons is only cosmetic):

- Every route under `/api/editor` sits behind `requireEditor`, mounted before
  any handler or body parser. It checks the session *and* the allowlist on each
  request, so removing someone from the allowlist (and restarting) locks out
  their still-open session.
- Sessions are opaque random ids in an HttpOnly, SameSite=Lax cookie (`Secure`
  and `__Host-` prefixed on https). SQLite stores only a hash of the id.
  Sessions last `SESSION_TTL_HOURS` (default 8).
- Writes also need a per-session `X-CSRF-Token` header and a same-origin
  request. Login uses the authorization-code flow with PKCE, `state` and
  `nonce`; the redirect URI comes from `PUBLIC_URL`, never from request headers.
- The server derives each team's roster itself and validates every field
  (known players, roles, 0-99 stats, champion names, at most 5 bans per team).
  Two editors saving over each other get a 409 instead of a silent overwrite.

Data behavior worth knowing:

- Each save is recorded in `match_detail_audit` (who, when, full before/after).
- A match that was edited in the app is listed in `match_detail_edits`, and a
  CSV re-ingest (`ingest-match-details`, the entrypoint, `refresh-all`) leaves
  it alone so a hand edit is never silently overwritten. To make the CSV win
  again: `node src/scripts/ingest-match-details.js <csv> --overwrite-edited`.
- Other tabs (Tournaments, player pages) show an edit after a page reload.
- Behind a reverse proxy, set `PUBLIC_URL` to the public https address. For
  local development with `npm run dev`, use `PUBLIC_URL=http://localhost:5173`
  (Vite proxies `/auth`).

### Importing a replay (.rofl)

Signed-in editors can fill a match's champions, K/D/A and roles from a League
replay instead of typing them:

- **Match History tab -> Import replay (.rofl)**: shows everyone in the replay,
  then you pick the match. Captain 1 narrows Captain 2 to captains they have
  faced; both narrow the Match list to their meetings. Rosters that fit the
  replay are offered as a one-click suggestion.
- **Inside a match's editor -> Import from replay**: the replay is assumed to
  belong to that match.

Either way the editor opens pre-filled and nothing is saved until you press
*Save changes*, so it goes through the same sign-in, CSRF, validation, conflict
and audit checks as a typed edit. The file is read **in the browser** (only its
trailing metadata block, ~100 KB of a ~20 MB file) and is never uploaded.

What it can and can't do:

- Works for ROFL2 replays (patch 14.11 and later). Replays from 14.9-14.10 carry
  no match summary, and pre-14.9 files use an older format; both are refused
  with a message. Only standard two-team games are accepted (not Arena).
- Players are paired to roster slots by Riot ID, then by game name (accents and
  case ignored). Newer replays include the full `Name#Tag`; older ones only the
  game name. Unmatched players are left for you to assign by hand, and a lone
  leftover pair is matched but flagged "check".
- Replay teams are mapped to Team 1 / Team 2 by name overlap, then by the
  recorded winner. If the replay's winner contradicts the match's recorded
  result, a warning is shown.
- Bans are **not** in replays and must still be entered by hand. Neither are
  pick order or a timeline (the game data inside the file is binary packets).
- Some replays have blank player names (the data then has to be assigned by
  hand) or no roles (ARAM/non-draft games); both are handled.

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
