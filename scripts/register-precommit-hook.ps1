$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$hookPath = (& git --no-pager -C $repoRoot rev-parse --git-path hooks/pre-commit).Trim()

if ([string]::IsNullOrWhiteSpace($hookPath)) {
  throw 'Failed to resolve the git pre-commit hook path.'
}

if (-not [System.IO.Path]::IsPathRooted($hookPath)) {
  $hookPath = Join-Path $repoRoot $hookPath
}

$hookPath = [System.IO.Path]::GetFullPath($hookPath)
$hookDir = Split-Path -Parent $hookPath
$backupPath = "$hookPath.taskmaster-backup"
$marker = '# taskmaster-validate-hook'
$validatePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\validate.ps1'))
$hookValidatePath = $validatePath -replace '\\', '/'
$hookBackupPath = $backupPath -replace '\\', '/'

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

$hookContent = @(
  '#!/usr/bin/env sh'
  'set -eu'
  $marker
  ''
  "BACKUP_PATH='$hookBackupPath'"
  'if [ -f "$BACKUP_PATH" ]; then'
  '  "$BACKUP_PATH" "$@"'
  'fi'
  ''
  "exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File '$hookValidatePath'"
) -join "`n"

Set-Content -LiteralPath $hookPath -Value $hookContent

Write-Host "Installed pre-commit hook at $hookPath"
if (Test-Path -LiteralPath $backupPath) {
  Write-Host "Preserved previous hook at $backupPath"
}
