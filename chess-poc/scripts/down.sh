#!/usr/bin/env bash
# Stop everything this PoC started. Patterns use the [x] trick so they never match this script's own
# command line (or a parent shell that merely mentions them).
RUN="$(cd "$(dirname "$0")/.." && pwd)/.run"
pkill -f '[w]allet-gateway/remote/dist/index.js' 2>/dev/null
pkill -f '[c]anton-open-source.*sandbox' 2>/dev/null
pkill -f '[v]ite preview' 2>/dev/null
pkill -f '[l]obby-bot.mjs' 2>/dev/null
pkill -f '[m]ock-oauth2' 2>/dev/null
pkill -f '[t]sx.*src/index.ts' 2>/dev/null
rm -f "$RUN"/*.pid
for _ in $(seq 1 20); do pgrep -f '[c]anton-open-source|[w]allet-gateway/remote/dist' >/dev/null || break; sleep 1; done
echo "stopped"
