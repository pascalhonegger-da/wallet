#!/usr/bin/env bash
# Stop everything this PoC started (matched by command line; pid files are unreliable under setsid).
RUN="$(cd "$(dirname "$0")/.." && pwd)/.run"
pkill -f 'wallet-gateway/remote/dist/index.js' 2>/dev/null
pkill -f 'canton-open-source.*sandbox' 2>/dev/null
pkill -f 'mock-oauth2' 2>/dev/null
pkill -f 'tsx src/index.ts' 2>/dev/null
pkill -f 'tsx.*src/index.ts' 2>/dev/null
rm -f "$RUN"/*.pid
for _ in $(seq 1 20); do pgrep -f 'canton-open-source|wallet-gateway/remote/dist' >/dev/null || break; sleep 1; done
echo "stopped"
