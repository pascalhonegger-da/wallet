#!/usr/bin/env bash
# Build the chess-poc package, then run the Daml script tests that live in the separate daml-test package.
# Prints one line per test and exits non-zero if the build or any test failed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DPM_SDK_VERSION=3.6.0
(cd "$ROOT/daml" && "$HOME/.dpm/bin/dpm" build > "$ROOT/.run/daml-build.out" 2>&1) || {
  grep -i -B2 -A6 "error" "$ROOT/.run/daml-build.out" | head -40; echo "daml build failed"; exit 1; }
out="$ROOT/.run/daml-test.out"
(cd "$ROOT/daml-test" && "$HOME/.dpm/bin/dpm" test > "$out" 2>&1)
sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -E "^daml/[A-Za-z]+\.daml:[A-Za-z0-9]+: (ok|failed)" | cut -c1-100
if sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -qE "^daml/[A-Za-z]+\.daml:[A-Za-z0-9]+: failed|Script execution failed"; then
  sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -E "Failed with status" | cut -c1-240; echo "daml tests FAILED"; exit 1; fi
echo "all daml tests passed"
