#!/usr/bin/env bash
# A throwaway Postgres on this machine, for running the flow tests against a real database.
# Usage: scripts/local-postgres.sh start | stop      Listens on 127.0.0.1:${LOCAL_PG_PORT:-5544}, no password, data in a temp folder.
set -euo pipefail
PORT="${LOCAL_PG_PORT:-5544}"
DIR="${LOCAL_PG_DIR:-/tmp/ringpad-postgres}"
BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
# Postgres refuses to run as root; on a machine where we are root, it runs as the postgres user.
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
case "${1:-}" in
  start)
    if "$BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT"; then exit 0; fi
    rm -rf "$DIR" && mkdir -p "$DIR"
    if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; fi
    as_pg "$BIN/initdb" -D "$DIR" -U postgres --auth=trust >/dev/null
    as_pg "$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DIR" -l "$DIR/log" -w start >/dev/null
    ;;
  stop)
    if [ -d "$DIR" ]; then as_pg "$BIN/pg_ctl" -D "$DIR" -m fast -w stop >/dev/null 2>&1 || true; rm -rf "$DIR"; fi
    ;;
  *) echo "usage: $0 start|stop"; exit 2 ;;
esac
