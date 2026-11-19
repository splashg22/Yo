#!/usr/bin/env bash
# Publishes the public proof page (the web/ folder) to the gh-pages branch,
# which GitHub Pages serves. Only web/ is published: never .env, keys or data/.
#
#   npm run web [coin]     # writes config.json + ledger.jsonl next to that coin's page
#   npm run web:publish    # pushes web/ (every coin's page) to gh-pages
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="${PAGES_BRANCH:-gh-pages}"
REMOTE="${PAGES_REMOTE:-origin}"

# Every coin's page lives under web/: the default one at the top, the others in web/<slug>/.
for page in web/index.html web/*/index.html; do
  [ -f "$page" ] || continue
  config="$(dirname "$page")/config.json"
  if [ -f "$config" ]; then
    # "tokenized" (as in tokenized stock) is fine; an RPC key or secret is not.
    if grep -Eiq 'api[-_]?key|secret|access[-_]?token|[?&]token=' "$config"; then
      echo "$config looks like it carries a key. Set PUBLIC_RPC_URL to a keyless RPC and rerun npm run web." >&2
      exit 1
    fi
  else
    echo "Note: $config is missing, so $(dirname "$page")/ will show its launching-soon state." >&2
  fi
done

GIT_DIR_ABS="$(git rev-parse --absolute-git-dir)"
STAGE="$(mktemp -d)"
INDEX="$(mktemp)"; rm -f "$INDEX"
trap 'rm -rf "$STAGE" "$INDEX"' EXIT

cp -R web/. "$STAGE"/
touch "$STAGE/.nojekyll"

git fetch -q "$REMOTE" "$BRANCH" 2>/dev/null || true
PARENT="$(git rev-parse -q --verify "refs/remotes/$REMOTE/$BRANCH" || true)"

export GIT_DIR="$GIT_DIR_ABS" GIT_WORK_TREE="$STAGE" GIT_INDEX_FILE="$INDEX"
git add -A -f .
TREE="$(git write-tree)"
unset GIT_WORK_TREE GIT_INDEX_FILE

if [ -n "$PARENT" ] && [ "$(git rev-parse "$PARENT^{tree}")" = "$TREE" ]; then
  echo "Nothing changed; $BRANCH already matches web/."
  exit 0
fi
MSG="Publish proof page from $(git rev-parse --short HEAD) on $(date -u +%Y-%m-%dT%H:%MZ)"
COMMIT="$(git commit-tree "$TREE" ${PARENT:+-p "$PARENT"} -m "$MSG")"
git update-ref "refs/heads/$BRANCH" "$COMMIT"
git push -q "$REMOTE" "refs/heads/$BRANCH:refs/heads/$BRANCH"
echo "Published $(git rev-parse --short "$COMMIT") to $REMOTE/$BRANCH: $(git ls-tree --name-only "$TREE" | tr '\n' ' ')"
