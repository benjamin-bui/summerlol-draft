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

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN npm install ts-trueskill

COPY server.js entrypoint.js ./
COPY public ./public
COPY src ./src
COPY data ./data
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

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
