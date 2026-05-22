#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
MARKER="# taskmaster-validate-hook"

quote_for_sh() {
  local value="$1"
  value="${value//\'/\'\"\'\"\'}"
  printf "'%s'" "$value"
}

resolve_git_path() {
  local git_path
  git_path="$(git --no-pager -C "$REPO_ROOT" rev-parse --git-path "$1")"
  if [[ "$git_path" != /* ]]; then
    git_path="$REPO_ROOT/$git_path"
  fi
  printf '%s' "$git_path"
}

install_hook() {
  local hook_name="$1"
  local hook_path backup_path hook_dir
  hook_path="$(resolve_git_path "hooks/$hook_name")"
  backup_path="${hook_path}.taskmaster-backup"
  hook_dir="$(dirname "$hook_path")"

  mkdir -p "$hook_dir"

  if [[ -f "$hook_path" ]] && ! grep -Fq "$MARKER" "$hook_path"; then
    if [[ -f "$backup_path" ]]; then
      printf 'Refusing to overwrite %s because %s already exists.\n' "$hook_path" "$backup_path" >&2
      exit 1
    fi

    mv "$hook_path" "$backup_path"
  fi

  cat >"$hook_path"
  chmod +x "$hook_path"

  printf 'Installed %s hook at %s\n' "$hook_name" "$hook_path"
  if [[ -f "$backup_path" ]]; then
    printf 'Preserved previous %s hook at %s\n' "$hook_name" "$backup_path"
  fi
}

VALIDATE_PATH_QUOTED="$(quote_for_sh "$REPO_ROOT/scripts/validate.sh")"
VERIFY_SENTINEL_PATH="$(resolve_git_path "hooks/taskmaster-verified")"
VERIFY_SENTINEL_PATH_QUOTED="$(quote_for_sh "$VERIFY_SENTINEL_PATH")"

PRE_COMMIT_BACKUP_PATH="$(resolve_git_path "hooks/pre-commit").taskmaster-backup"
PRE_COMMIT_BACKUP_PATH_QUOTED="$(quote_for_sh "$PRE_COMMIT_BACKUP_PATH")"
install_hook "pre-commit" <<EOF
#!/usr/bin/env bash
set -euo pipefail
$MARKER

BACKUP_PATH=$PRE_COMMIT_BACKUP_PATH_QUOTED
VERIFY_SENTINEL_PATH=$VERIFY_SENTINEL_PATH_QUOTED

rm -f "\$VERIFY_SENTINEL_PATH"
if [ -f "\$BACKUP_PATH" ]; then
  "\$BACKUP_PATH" "\$@"
fi

$VALIDATE_PATH_QUOTED
mkdir -p "\$(dirname "\$VERIFY_SENTINEL_PATH")"
: >"\$VERIFY_SENTINEL_PATH"
EOF

PRE_MERGE_COMMIT_BACKUP_PATH="$(resolve_git_path "hooks/pre-merge-commit").taskmaster-backup"
PRE_MERGE_COMMIT_BACKUP_PATH_QUOTED="$(quote_for_sh "$PRE_MERGE_COMMIT_BACKUP_PATH")"
install_hook "pre-merge-commit" <<EOF
#!/usr/bin/env bash
set -euo pipefail
$MARKER

BACKUP_PATH=$PRE_MERGE_COMMIT_BACKUP_PATH_QUOTED
VERIFY_SENTINEL_PATH=$VERIFY_SENTINEL_PATH_QUOTED

rm -f "\$VERIFY_SENTINEL_PATH"
if [ -f "\$BACKUP_PATH" ]; then
  "\$BACKUP_PATH" "\$@"
fi

$VALIDATE_PATH_QUOTED
mkdir -p "\$(dirname "\$VERIFY_SENTINEL_PATH")"
: >"\$VERIFY_SENTINEL_PATH"
EOF

PREPARE_COMMIT_MSG_BACKUP_PATH="$(resolve_git_path "hooks/prepare-commit-msg").taskmaster-backup"
PREPARE_COMMIT_MSG_BACKUP_PATH_QUOTED="$(quote_for_sh "$PREPARE_COMMIT_MSG_BACKUP_PATH")"
install_hook "prepare-commit-msg" <<EOF
#!/usr/bin/env bash
set -euo pipefail
$MARKER

BACKUP_PATH=$PREPARE_COMMIT_MSG_BACKUP_PATH_QUOTED
VERIFY_SENTINEL_PATH=$VERIFY_SENTINEL_PATH_QUOTED

if [ -f "\$BACKUP_PATH" ]; then
  "\$BACKUP_PATH" "\$@"
fi

if [ ! -f "\$VERIFY_SENTINEL_PATH" ]; then
  printf '%s\n' 'Verified commits are required in this repo; git commit --no-verify is disabled.' >&2
  exit 1
fi

rm -f "\$VERIFY_SENTINEL_PATH"
EOF
