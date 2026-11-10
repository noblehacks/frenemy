#!/usr/bin/env pwsh
<#
.SYNOPSIS
Runs the Frenemy Nuke build.

.DESCRIPTION
Bootstraps the repository-local Nuke project with PowerShell 7 and forwards all
arguments. The public --test-groups spelling is normalized to the Nuke Groups
parameter so the operator-facing command remains stable.

.NOTES
Change log:
- 2026-11-06, TR-FRENEMY-ADAPTER-118, AC-FRENEMY-114-01 through AC-FRENEMY-115-06:
  Added Phase 3 Nuke orchestration for the BDPv4 mock, binding, and validation gates.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$BuildArguments
)

$ErrorActionPreference = 'Stop'
$forwarded = foreach ($argument in $BuildArguments) {
    if ($argument -eq '--test-groups') { '--groups' } else { $argument }
}

$buildProject = Join-Path $PSScriptRoot 'build' '_build.csproj'
& dotnet run --project $buildProject -- @forwarded
exit $LASTEXITCODE
