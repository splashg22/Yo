#!/usr/bin/env bash
# Copies data/ (the books and the ledger) into a dated archive.
#   deploy/backup.sh [backup-dir]        default: ~/dacity-bot-backups
# Run it hourly from cron, e.g.:
#   0 * * * * /path/to/Yo/deploy/backup.sh
# Keeps the newest 500 archives. Point backup-dir at a synced or remote disk:
# a backup on the same disk does not survive losing the machine.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="${1:-$HOME/dacity-bot-backups}"
mkdir -p "$dest"
# Every coin's books: data/ for the default coin, data/<coin>/ for the others.
if [ -z "$(find "$repo/data" \( -name state.json -o -name ledger.jsonl \) -print -quit 2>/dev/null)" ]; then
  echo "nothing to back up yet"
  exit 0
fi
archive="$dest/data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -czf "$archive" -C "$repo" --exclude='.lock' --exclude='*.tmp' data
ls -1t "$dest"/data-*.tar.gz | tail -n +501 | while read -r old; do rm -f -- "$old"; done
echo "saved $archive"
