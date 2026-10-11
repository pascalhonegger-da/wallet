#!/usr/bin/env bash
# Container entrypoint: the same steps as chess-poc/scripts/up.sh, with everything under /var/chess and nginx in
# front. All state is in memory or under /var/chess, so a new container starts from scratch.
set -euo pipefail
# APP, RUN and NGINX_CMD can be overridden to try the script outside the image
APP="${CHESS_APP:-/opt/chess}"
RUN="${CHESS_RUN:-/var/chess}"; mkdir -p "$RUN"; cd "$RUN"
NGINX_CMD="${NGINX_CMD:-nginx}"
PUBLIC_URL="${PUBLIC_URL%/}"
SCHEME="${PUBLIC_URL%%://*}"
HOST="${PUBLIC_URL#*://}"; HOST="${HOST%%/*}"
PIDS=()
start() { local n=$1; shift; "$@" > "$RUN/$n.log" 2>&1 & PIDS+=($!); }
waitfor() { for _ in $(seq 1 120); do curl -sf -o /dev/null "$2" && { echo "$1 up"; return; }; sleep 2; done
  echo "$1 failed to start:"; tail -30 "$RUN/$1.log"; exit 1; }
trap 'kill "${PIDS[@]}" 2>/dev/null || true' EXIT

cd "$APP/mock-oauth" && start oauth ./node_modules/.bin/tsx src/index.ts; cd "$RUN"
waitfor oauth http://127.0.0.1:8889/.well-known/openid-configuration
start sandbox dpm sandbox --json-api-port 7575 -c "$APP/gateway-config/sandbox-auth.conf" --no-tty
waitfor sandbox http://127.0.0.1:7575/livez

TOKEN() { curl -sf -X POST http://127.0.0.1:8889/token -u participant_admin:admin-client-secret \
  -d grant_type=client_credentials -d scope=daml_ledger_api -d audience=https://chess.local \
  | sed -E 's/.*"access_token":"([^"]+)".*/\1/'; }
ADMIN=$(TOKEN)
auth=(-H "Authorization: Bearer $ADMIN")
PARTICIPANT_ID=$(curl -sf "${auth[@]}" http://127.0.0.1:7575/v2/parties/participant-id | sed -E 's/.*"participantId":"([^"]+)".*/\1/')
SYNC_ID=""
for _ in $(seq 1 60); do
  SYNC_ID=$(curl -sf "${auth[@]}" http://127.0.0.1:7575/v2/state/connected-synchronizers | sed -nE 's/.*"synchronizerId":"([^"]+)".*/\1/p')
  [ -n "$SYNC_ID" ] && break; sleep 2
done
[ -n "$SYNC_ID" ] || { echo "no synchronizer connected"; exit 1; }
echo "participant $PARTICIPANT_ID, synchronizer $SYNC_ID"

# gateway config: the template from the PoC, plus the public URL (the gateway lives under /wallet-gateway)
sed -e "s|@PARTICIPANT_ID@|$PARTICIPANT_ID|" -e "s|@SYNCHRONIZER_ID@|$SYNC_ID|" \
  "$APP/gateway-config/config.template.json" \
  | PUBLIC_URL="$PUBLIC_URL" node -e '
      const c = JSON.parse(require("fs").readFileSync(0, "utf8"))
      c.kernel.publicUrl = process.env.PUBLIC_URL + "/wallet-gateway"
      c.server.allowedOrigins = [process.env.PUBLIC_URL]
      c.server.trustProxy = true
      process.stdout.write(JSON.stringify(c, null, 2))' > "$RUN/gateway.json"

curl -sf -X POST http://127.0.0.1:7575/v2/packages "${auth[@]}" -H 'Content-Type: application/octet-stream' \
  --data-binary @"$APP/daml/.daml/dist/chess-poc-0.0.1.dar" >/dev/null && echo "DAR uploaded"
start gateway node "$APP/gateway/dist/index.js" -c "$RUN/gateway.json"
waitfor gateway http://127.0.0.1:3030/healthz

LOBBY=$(curl -sf -X POST http://127.0.0.1:7575/v2/parties "${auth[@]}" -H 'Content-Type: application/json' \
  -d '{"partyIdHint":"lobby","identityProviderId":""}' | sed -E 's/.*"party":"([^"]+)".*/\1/')
echo "lobby $LOBBY"
start grantread node "$APP/grant-lobby-read.mjs" "$LOBBY"

# the app finds the lobby (and, by default, the gateway under /wallet-gateway) in config.json
echo "{\"lobby\": \"$LOBBY\"}" > "$APP/web/config.json"
sed -e "s|@HOST@|$HOST|g" -e "s|@SCHEME@|$SCHEME|g" "$APP/docker/nginx.conf.template" > "$RUN/nginx.conf"
start nginx $NGINX_CMD -c "$RUN/nginx.conf"
waitfor nginx http://127.0.0.1:8080/wallet-gateway/healthz
echo "Canton Chess is up at $PUBLIC_URL (container port 8080)"
# if any process dies the container stops, so a restart policy gives a clean new state
wait -n
echo "a process exited, stopping" >&2
exit 1
