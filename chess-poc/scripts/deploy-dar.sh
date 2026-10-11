#!/usr/bin/env bash
# Build the Daml package and upload the DAR to the running sandbox (admin token from mock OAuth).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$ROOT/daml" && DPM_SDK_VERSION=3.6.0 "$HOME/.dpm/bin/dpm" build 2>&1 | grep -E "ERROR|error|Created" || true)
ADMIN=$(curl -sf -X POST http://127.0.0.1:8889/token -u participant_admin:admin-client-secret \
  -d grant_type=client_credentials -d scope=daml_ledger_api -d audience=https://chess.local \
  | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
curl -sf -X POST http://127.0.0.1:7575/v2/packages -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/octet-stream' --data-binary @"$ROOT/daml/.daml/dist/chess-poc-0.0.1.dar" >/dev/null
echo "DAR uploaded"
