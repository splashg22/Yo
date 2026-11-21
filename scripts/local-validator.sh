#!/usr/bin/env bash
# Starts a local Solana validator that already contains pump.fun and the Privacy Rings
# programs, copied from devnet by `npm run local:fetch`. No network needed once fetched.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN="${SOLANA_BIN:-/opt/solana/bin}"
[ -d local/accounts ] || { echo "Run: npm run local:fetch"; exit 1; }
ARGS=()
for f in local/accounts/*.json; do ARGS+=(--account "$(basename "$f" .json)" "$f"); done
exec "$BIN/solana-test-validator" --reset --quiet --ledger local/ledger --rpc-port "${LOCAL_RPC_PORT:-8799}" --faucet-port "${LOCAL_FAUCET_PORT:-9799}" --gossip-port 8701 --dynamic-port-range 8710-8740 --bind-address 127.0.0.1 "${ARGS[@]}"
