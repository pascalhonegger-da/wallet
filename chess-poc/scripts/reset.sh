#!/usr/bin/env bash
# Wipe all state (sandbox is in-memory; gateway sqlite stores live in .run) and restart.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
"$D/down.sh"
rm -f "$D/../.run/"*.sqlite* "$D/../.run/"*.log
"$D/up.sh"
