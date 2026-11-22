#!/usr/bin/env bash
# One command to put a launch on Railway:   npm run deploy -- terminal     or     npm run deploy -- launchpad
#
# It refuses to go on unless the whole suite passes and the settings for that launch are complete, then hands the
# repository to Railway, which builds the Dockerfile and runs it. It needs the Railway CLI, logged in by you
# (`railway login`), and a service of the same name in your Railway project with the variables of
# deploy/<launch>.env.example set there. No secret is read, printed or stored by this script.
#
# NOT YET RUN AGAINST RAILWAY: there was no account to run it against. The first run is the test of it.
set -euo pipefail
launch="${1:-}"
if [ "$launch" != "terminal" ] && [ "$launch" != "launchpad" ]; then
  echo "say which launch: terminal (mainnet, read only) or launchpad (devnet)"; exit 2
fi
command -v railway >/dev/null || { echo "the Railway CLI is not installed: npm i -g @railway/cli, then railway login"; exit 2; }
echo "1 of 4  no secret in the repository";            npm run -s scan
echo "2 of 4  types, lint, format, every test";        npm run -s check
echo "3 of 4  the settings this launch needs, as Railway holds them"
missing=0
for name in $(grep -oE '^[A-Z_]+=' "deploy/$launch.env.example" | tr -d '='); do
  case "$name" in DATABASE_URL|PREVIEW_PASSWORD|PINATA_JWT|NODE_USE_ENV_PROXY) continue ;; esac
  if ! railway variables --service "ringpad-$launch" --kv 2>/dev/null | grep -q "^$name="; then echo "   missing on Railway: $name"; missing=1; fi
done
[ "$missing" = 0 ] || { echo "set those in Railway (the service's Variables tab), then run this again"; exit 1; }
echo "4 of 4  deploy"
railway up --service "ringpad-$launch" --detach
echo "Sent. Watch it come up: railway logs --service ringpad-$launch     then open <your address>/health"
