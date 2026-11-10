<#
.SYNOPSIS
Provides a test-only prompt-protection event stream for the independent mock gate.

.PARAMETER OwnedDirectory
Absolute invocation-owned directory.

.PARAMETER EventPath
File that records the protection event for the test assertion.

.NOTES
Change log:
- 2026-11-06, AC-FRENEMY-114-05 and AC-TEST-FRENEMY-114-05: Added a test-only
  provider that proves protection precedes prompt writes without changing an ACL.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OwnedDirectory,
    [Parameter(Mandatory)][string]$EventPath
)

$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathFullyQualified($OwnedDirectory)) { throw 'OwnedDirectory must be absolute.' }
if (-not (Test-Path -LiteralPath $OwnedDirectory -PathType Container)) { throw 'OwnedDirectory must exist.' }
[IO.File]::WriteAllText($EventPath, "protect`n", [Text.UTF8Encoding]::new($false))
