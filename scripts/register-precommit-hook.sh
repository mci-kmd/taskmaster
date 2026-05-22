#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
HOOK_PATH="$(git --no-pager -C "$REPO_ROOT" rev-parse --git-path hooks/pre-commit)"

if [[ "$HOOK_PATH" != /* ]]; then
  HOOK_PATH="$REPO_ROOT/$HOOK_PATH"
fi

HOOK_DIR="$(dirname "$HOOK_PATH")"
BACKUP_PATH="${HOOK_PATH}.taskmaster-backup"
MARKER="# taskmaster-validate-hook"

quote_for_sh() {
  local value="$1"
  value="${value//\'/\'\"\'\"\'}"
  printf "'%s'" "$value"
}

mkdir -p "$HOOK_DIR"

if [[ -f "$HOOK_PATH" ]] && ! grep -Fq "$MARKER" "$HOOK_PATH"; then
  if [[ -f "$BACKUP_PATH" ]]; then
    printf 'Refusing to overwrite %s because %s already exists.\n' "$HOOK_PATH" "$BACKUP_PATH" >&2
    exit 1
  fi

  mv "$HOOK_PATH" "$BACKUP_PATH"
fi

VALIDATE_PATH_QUOTED="$(quote_for_sh "$REPO_ROOT/scripts/validate.sh")"
BACKUP_PATH_QUOTED="$(quote_for_sh "$BACKUP_PATH")"

cat >"$HOOK_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
$MARKER

BACKUP_PATH=$BACKUP_PATH_QUOTED
if [ -f "\$BACKUP_PATH" ]; then
  "\$BACKUP_PATH" "\$@"
fi

exec $VALIDATE_PATH_QUOTED
EOF

chmod +x "$HOOK_PATH"

printf 'Installed pre-commit hook at %s\n' "$HOOK_PATH"
if [[ -f "$BACKUP_PATH" ]]; then
  printf 'Preserved previous hook at %s\n' "$BACKUP_PATH"
fi
