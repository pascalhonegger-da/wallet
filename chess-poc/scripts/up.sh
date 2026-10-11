#!/usr/bin/env bash
# Start mock OAuth (admin identity only), Canton sandbox 3.6 (JSON API :7575) and Wallet Gateway (:3030).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; REPO="$ROOT/.."
RUN="$ROOT/.run"; mkdir -p "$RUN"
start() { # name, cmd...
  local n=$1; shift
  if [ -f "$RUN/$n.pid" ] && kill -0 "$(cat "$RUN/$n.pid")" 2>/dev/null; then echo "$n already running"; return; fi
  (cd "$WORKDIR" && nohup setsid "$@" > "$RUN/$n.log" 2>&1 & echo $! > "$RUN/$n.pid")
}
waitfor() { # name, url
  for _ in $(seq 1 90); do curl -sf -o /dev/null "$2" && { echo "$1 up"; return; }; sleep 2; done
  echo "$1 failed to start, see $RUN/$1.log"; exit 1
}
WORKDIR="$REPO/mock-oauth2" start oauth pnpm start
waitfor oauth http://127.0.0.1:8889/.well-known/openid-configuration
DPM_SDK_VERSION=3.6.0 WORKDIR="$RUN" start sandbox "$HOME/.dpm/bin/dpm" sandbox --json-api-port 7575 \
  -c "$ROOT/gateway/sandbox-auth.conf" --no-tty
waitfor sandbox http://127.0.0.1:7575/livez
# The participant id (token audience) and synchronizer id change on every reset: template the gateway config.
ADMIN=$(curl -sf -X POST http://127.0.0.1:8889/token -u participant_admin:admin-client-secret \
  -d grant_type=client_credentials -d scope=daml_ledger_api -d audience=https://chess.local \
  | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
PARTICIPANT_ID=$(curl -sf -H "Authorization: Bearer $ADMIN" http://127.0.0.1:7575/v2/parties/participant-id \
  | sed -E 's/.*"participantId":"([^"]+)".*/\1/')
SYNC_ID=""
for _ in $(seq 1 60); do
  SYNC_ID=$(curl -sf -H "Authorization: Bearer $ADMIN" http://127.0.0.1:7575/v2/state/connected-synchronizers \
    | sed -nE 's/.*"synchronizerId":"([^"]+)".*/\1/p')
  [ -n "$SYNC_ID" ] && break; sleep 2
done
[ -n "$SYNC_ID" ] || { echo "no synchronizer connected"; exit 1; }
echo "participant $PARTICIPANT_ID, synchronizer $SYNC_ID"
sed -e "s|@PARTICIPANT_ID@|$PARTICIPANT_ID|" -e "s|@SYNCHRONIZER_ID@|$SYNC_ID|" \
  "$ROOT/gateway/config.template.json" > "$RUN/config.json"
"$ROOT/scripts/deploy-dar.sh"
WORKDIR="$RUN" start gateway node "$REPO/wallet-gateway/remote/dist/index.js" -c "$RUN/config.json"
waitfor gateway http://127.0.0.1:3030/
# Players: self-issued users, each with an authentication party created through the gateway UI.
USERS="${CHESS_USERS:-alice bob lobby}"
for u in $USERS; do node "$ROOT/scripts/onboard.mjs" "$u"; done
# Web app: production build + preview (the Vite dev server breaks the SDK's wallet-picker popup).
# Party ids change on every reset, so the app reads them from web/public/config.json (copied into every build).
mkdir -p "$ROOT/web/public"
curl -sf -H "Authorization: Bearer $ADMIN" http://127.0.0.1:7575/v2/parties | USERS="$USERS" python3 -c '
import json, os, sys
parties = [p["party"] for p in json.load(sys.stdin)["partyDetails"]]
players = {u: next(p for p in parties if p.startswith(u + "::")) for u in os.environ["USERS"].split()}
json.dump({"players": players, "lobby": players.get("lobby")}, open(sys.argv[1], "w"), indent=2)
' "$ROOT/web/public/config.json"
(cd "$ROOT/web" && ./node_modules/.bin/vite build >/dev/null 2>&1)
WORKDIR="$ROOT/web" start web ./node_modules/.bin/vite preview --port 5173 --host 0.0.0.0 --strictPort
waitfor web http://localhost:5173/
echo "Stack is up. Gateway UI http://localhost:3030, app http://localhost:5173"
