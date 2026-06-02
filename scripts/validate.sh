#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

run_step() {
  local label="$1"
  shift

  printf '\n==> %s\n' "$label"
  "$@"
}

cd "$REPO_ROOT"

run_step "Formatting code" bun run format
run_step "Staging formatter changes" git add -u
run_step "Linting" bun run lint
run_step "Running tests" bun run test
run_step "Typechecking" bun run typecheck
run_step "Building" bun run build
