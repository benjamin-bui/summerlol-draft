# Summer LoL Draft

A React and Express application for exploring draft and match data from
Williams College League of Legends tournaments. The backend owns the SQLite
database, API, CSV ingestion, TrueSkill calculations, and optional Riot API
identity sync. The frontend is a Vite app built and served by the backend.

## Repository Hosting

GitHub is a read-only mirror. The canonical repository is hosted on
[Forgejo](https://forgejo.benbooee.com/benbooee/summerlol-draft); submit
issues and pull requests there.

## Requirements

- Docker Compose for the container workflow.
- Node.js 22.12 or newer for local development, tests, and the Docker image.

## Run with Docker

Compose requires an environment file even when Riot integration is unused:

```sh
cp backend/.env.example backend/.env
UID=$(id -u) GID=$(id -g) docker compose up --build
```

Open <http://localhost:3000>. The container builds the frontend and serves it
with the API. `backend/data/` is mounted into the container so the database
and local data survive image rebuilds. The UID/GID settings keep files
created by the container editable by the current Linux user.

## Develop Locally

Install dependencies once in each package:

```sh
(cd backend && npm ci)
(cd frontend && npm ci)
```

Run the backend and frontend in separate terminals. From the repository root:

```sh
cd backend && npm start
```

```sh
cd frontend && npm run dev
```

Use <http://localhost:5173> for frontend work; Vite proxies `/api` and
`/icons` to the backend at port 3000. The backend also serves the last built
frontend at <http://localhost:3000>.

## Verify Changes

```sh
(cd backend && npm test)
(cd frontend && npm run lint && npm test)
```

Build the production frontend locally with `cd frontend && npm run build`.
This writes generated assets into `backend/public/`; edit source files under
`frontend/src/`, not generated output. The Docker build uses a separate
temporary output directory.

## Project Guides

- [Backend development, data formats, and scripts](backend/README.md)
- [Frontend development, tests, and fixtures](frontend/README.md)
