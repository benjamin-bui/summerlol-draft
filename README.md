# Summer LoL Draft

A mostly-for-fun look at draft/TrueSkill performance across the Williams
College Summer/Winter LoL tournaments. Two parts:

- **`backend/`** -- Express + SQLite API and data pipeline (ingestion,
  TrueSkill computation, Riot API sync). See `backend/README.md` for the
  data model, tab-by-tab behavior, CSV format, and the player-identity
  system. Unchanged from before.
- **`frontend/`** -- React (Vite) app that renders the site, built into
  `backend/public/` so the backend can serve it as static files. See
  `frontend/README.md` for its structure. This is a from-scratch port of
  what used to be hand-rolled vanilla JS in `backend/public/`.

## Quickest path: Docker

```
cp backend/.env.example backend/.env   # fill in RIOT_API_KEY etc. if you want live Riot lookups
docker compose up -d --build
```

Open http://localhost:3000. The image is built in two stages (see
`Dockerfile`): the frontend is compiled first, then baked into the backend
image alongside the committed SQLite DB. One image, one container, no
separate static host.

Data lives in `backend/data/`, bind-mounted into the container (see
`docker-compose.yml`) so it survives image rebuilds. Run as your own host
UID so those files stay editable without `sudo`:

```
UID=$(id -u) GID=$(id -g) docker compose up -d --build
```

## Developing without Docker

Run both halves separately, each against the backend's API on port 3000:

```
cd backend && npm install && npm start        # http://localhost:3000 (API + last-built frontend)
cd frontend && npm install && npm run dev     # http://localhost:5173 (live-reloading frontend, proxies /api to :3000)
```

Do your frontend work against `:5173`; `:3000` keeps serving whatever the
frontend's last `npm run build` produced until you build again.

To build the frontend into the backend's `public/` folder without Docker
(e.g. to test the production build locally, or to deploy without
containers):

```
cd frontend && npm run build
cd ../backend && npm start
```

## Repo layout

```
Dockerfile              # multi-stage: builds frontend/, bakes it into backend/
docker-compose.yml
backend/                 # Express + SQLite -- see backend/README.md
frontend/                # React (Vite) -- see frontend/README.md
```
