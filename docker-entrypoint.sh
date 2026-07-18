#!/bin/sh
# Two modes, chosen automatically based on how the container was started:
#
# 1. `docker run` with NO --user flag (container starts as root, the
#    Dockerfile's default): chown /app/data to the "node" user, then drop
#    to it. This is what fixes a freshly-mounted volume of unknown
#    ownership so the app can write app.db — but it also means every file
#    the app touches ends up owned by "node"'s UID (1000 in node:alpine),
#    which is annoying to edit from the host afterward without sudo/chown.
#
# 2. `docker run --user "$(id -u):$(id -g)"` (container starts as YOUR
#    host UID instead of root): this script detects it's not root and
#    skips the chown entirely — there's no root privilege to chown with
#    anyway, and none is needed, since files created by the container
#    already belong to your own host user from the start. This is the
#    recommended way to run this if you plan to hand-edit the CSV on the
#    host between container restarts; see the README for the exact
#    command. No more permission dance in either direction.
set -e

mkdir -p /app/data

if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data
  exec su-exec node "$@"
else
  exec "$@"
fi
