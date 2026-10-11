#!/usr/bin/env bash
# Build the chess-poc package, then run the Daml script tests that live in the separate daml-test package.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DPM_SDK_VERSION=3.6.0
(cd "$ROOT/daml" && "$HOME/.dpm/bin/dpm" build 2>&1 | grep -E "ERROR|error|warning" || true)
cd "$ROOT/daml-test" && "$HOME/.dpm/bin/dpm" test 2>&1 | grep -E "ChessTest.*:|FAILED|rror" | grep -v ScriptService
