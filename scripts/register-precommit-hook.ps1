$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$marker = '# taskmaster-validate-hook'
$validatePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\validate.ps1'))
$hookValidatePath = $validatePath -replace '\\', '/'

function Resolve-GitPath {
  param(
    [Parameter(Mandatory = $true)]
    [string] $GitPath
  )

  $resolvedPath = (& git --no-pager -C $repoRoot rev-parse --git-path $GitPath).Trim()
  if ([string]::IsNullOrWhiteSpace($resolvedPath)) {
    throw "Failed to resolve the git path for $GitPath."
  }

  if (-not [System.IO.Path]::IsPathRooted($resolvedPath)) {
    $resolvedPath = Join-Path $repoRoot $resolvedPath
  }

  return [System.IO.Path]::GetFullPath($resolvedPath)
}

function Install-Hook {
  param(
    [Parameter(Mandatory = $true)]
    [string] $HookName,

    [Parameter(Mandatory = $true)]
    [string] $Content
  )

  $hookPath = Resolve-GitPath "hooks/$HookName"
  $hookDir = Split-Path -Parent $hookPath
  $backupPath = "$hookPath.taskmaster-backup"

  New-Item -ItemType Directory -Force -Path $hookDir | Out-Null

  if (Test-Path -LiteralPath $hookPath) {
    $currentContent = Get-Content -LiteralPath $hookPath -Raw
    if ($currentContent -notmatch [regex]::Escape($marker)) {
      if (Test-Path -LiteralPath $backupPath) {
        throw "Refusing to overwrite $hookPath because $backupPath already exists."
      }

      Move-Item -LiteralPath $hookPath -Destination $backupPath
    }
  }

  Set-Content -LiteralPath $hookPath -Value $Content

  Write-Host "Installed $HookName hook at $hookPath"
  if (Test-Path -LiteralPath $backupPath) {
    Write-Host "Preserved previous $HookName hook at $backupPath"
  }
}

$verifySentinelPath = (Resolve-GitPath 'hooks/taskmaster-verified') -replace '\\', '/'
$preCommitBackupPath = ((Resolve-GitPath 'hooks/pre-commit') + '.taskmaster-backup') -replace '\\', '/'
$preMergeCommitBackupPath =
  ((Resolve-GitPath 'hooks/pre-merge-commit') + '.taskmaster-backup') -replace '\\', '/'
$prepareCommitMsgBackupPath =
  ((Resolve-GitPath 'hooks/prepare-commit-msg') + '.taskmaster-backup') -replace '\\', '/'

$preCommitContent = @(
  '#!/usr/bin/env sh'
  'set -eu'
  $marker
  ''
  "BACKUP_PATH='$preCommitBackupPath'"
  "VERIFY_SENTINEL_PATH='$verifySentinelPath'"
  ''
  'rm -f "$VERIFY_SENTINEL_PATH"'
  'if [ -f "$BACKUP_PATH" ]; then'
  '  "$BACKUP_PATH" "$@"'
  'fi'
  ''
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File '$hookValidatePath'"
  'mkdir -p "$(dirname "$VERIFY_SENTINEL_PATH")"'
  ': >"$VERIFY_SENTINEL_PATH"'
) -join "`n"

$preMergeCommitContent = @(
  '#!/usr/bin/env sh'
  'set -eu'
  $marker
  ''
  "BACKUP_PATH='$preMergeCommitBackupPath'"
  "VERIFY_SENTINEL_PATH='$verifySentinelPath'"
  ''
  'rm -f "$VERIFY_SENTINEL_PATH"'
  'if [ -f "$BACKUP_PATH" ]; then'
  '  "$BACKUP_PATH" "$@"'
  'fi'
  ''
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File '$hookValidatePath'"
  'mkdir -p "$(dirname "$VERIFY_SENTINEL_PATH")"'
  ': >"$VERIFY_SENTINEL_PATH"'
) -join "`n"

$prepareCommitMsgContent = @(
  '#!/usr/bin/env sh'
  'set -eu'
  $marker
  ''
  "BACKUP_PATH='$prepareCommitMsgBackupPath'"
  "VERIFY_SENTINEL_PATH='$verifySentinelPath'"
  ''
  'if [ -f "$BACKUP_PATH" ]; then'
  '  "$BACKUP_PATH" "$@"'
  'fi'
  ''
  'if [ ! -f "$VERIFY_SENTINEL_PATH" ]; then'
  '  printf ''%s\n'' ''Verified commits are required in this repo; git commit --no-verify is disabled.'' >&2'
  '  exit 1'
  'fi'
  ''
  'rm -f "$VERIFY_SENTINEL_PATH"'
) -join "`n"

Install-Hook -HookName 'pre-commit' -Content $preCommitContent
Install-Hook -HookName 'pre-merge-commit' -Content $preMergeCommitContent
Install-Hook -HookName 'prepare-commit-msg' -Content $prepareCommitMsgContent
