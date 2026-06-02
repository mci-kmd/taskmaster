$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Label,

    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]] $Command
  )

  Write-Host ""
  Write-Host "==> $Label"
  if ($Command.Length -eq 1) {
    & $Command[0]
  } else {
    & $Command[0] $Command[1..($Command.Length - 1)]
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed: $Label"
  }
}

Invoke-Step "Formatting code" bun run format
Invoke-Step "Staging formatter changes" git add -u
Invoke-Step "Linting" bun run lint
Invoke-Step "Running tests" bun run test
Invoke-Step "Typechecking" bun run typecheck
Invoke-Step "Building" bun run build
