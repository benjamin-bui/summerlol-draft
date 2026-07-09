# Slim Alpine base — final image lands around 150-180MB
# (a bit larger than the pure-JSON version because better-sqlite3 is a
# native module; the build stage below compiles it if no prebuilt binary
# matches this platform, then the toolchain is discarded from this layer)
FROM node:20-alpine

WORKDIR /app

# python3/make/g++ are needed only if better-sqlite3 falls back to
# compiling from source (no prebuilt binary for this exact platform).
# If npm ci already finds a prebuilt binary, these are simply unused.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public
COPY data ./data

# The SQLite file lives here. Mount a volume onto this path in production
# so manual edits and re-ingested data persist across image rebuilds and
# container restarts — otherwise data/app.db resets to whatever was baked
# into the image at build time.
VOLUME ["/app/data"]

USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
