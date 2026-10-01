# syntax=docker/dockerfile:1

# ---- Stage 1: build the React frontend -------------------------------
# Isolated build environment -- only frontend/ is visible here, so this
# never touches (or depends on) whatever happens to already be sitting in
# backend/public/ from a local `npm run build`.
FROM node:20-alpine AS frontend-build
WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# Build to a throwaway dir inside this stage rather than the default
# ../backend/public (which only makes sense for a local, non-Docker build
# where frontend/ and backend/ are real sibling directories) -- see
# vite.config.js. The final stage below copies the result into place.
ENV VITE_OUT_DIR=/frontend/dist
RUN npm run build

# ---- Stage 2: the backend, same as the original Dockerfile ------------
# Slim Alpine base — final image lands around 150-180MB
# (a bit larger than the pure-JSON version because better-sqlite3 is a
# native module; the build stage below compiles it if no prebuilt binary
# matches this platform, then the toolchain is discarded from this layer)
FROM node:20-alpine

WORKDIR /app

# python3/make/g++ are needed only if better-sqlite3 falls back to
# compiling from source (no prebuilt binary for this exact platform).
# su-exec lets the entrypoint drop from root to the "node" user after
# fixing volume permissions (see docker-entrypoint.sh).
RUN apk add --no-cache python3 make g++ su-exec

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
RUN npm install ts-trueskill

COPY backend/server.js backend/entrypoint.js ./
COPY backend/src ./src
COPY backend/data ./data
COPY backend/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Only the static assets that aren't part of the frontend build (champion
# icons, rank badges, etc.) come from the repo's checked-in public/ dir.
# index.html and the JS/CSS bundle come exclusively from the frontend-build
# stage above, so there's never a stale bundle left over from someone's
# local build sitting alongside a fresh one.
COPY backend/public/icons ./public/icons
COPY --from=frontend-build /frontend/dist/ ./public/

# The SQLite file lives here. Mount a volume onto this path in production
# so manual edits and re-ingested data persist across image rebuilds and
# container restarts — otherwise data/app.db resets to whatever was baked
# into the image at build time.
VOLUME ["/app/data"]

# Deliberately no `USER node` here — the container starts as root so
# docker-entrypoint.sh can chown the (possibly freshly mounted, possibly
# wrong-UID-owned) /app/data volume, then it drops to the "node" user
# itself before running the app. See docker-entrypoint.sh.

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "entrypoint.js"]
