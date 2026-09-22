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

run_tests() (
  # Tests create their own repositories; do not inherit the hook's Git paths.
  while IFS= read -r git_variable; do
    unset "$git_variable"
  done < <(git rev-parse --local-env-vars)
  bun run test
)

cd "$REPO_ROOT"

run_step "Formatting code" bun run format
run_step "Staging formatter changes" git add -u
run_step "Linting" bun run lint
run_step "Running tests" run_tests
run_step "Typechecking" bun run typecheck
run_step "Building" bun run build
