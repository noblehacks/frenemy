# Frenemy installer for Windows.
#
# Run it in PowerShell with:   .\install.ps1
# (If Windows blocks it:  powershell -ExecutionPolicy Bypass -File install.ps1)
# No admin rights needed. It only touches files in your user folder.
#
# This file only checks that Node.js 18 or newer is here, then hands over to
# install.mjs with the same options. Everything else lives in install.mjs.
$Dir = $PSScriptRoot
if (-not $Dir) {
  Write-Host "Please run this as a file (.\install.ps1) from inside the Frenemy folder, not by pasting it into the window."
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Frenemy needs Node.js 18 or newer, and node was not found on this computer. Install it from https://nodejs.org, open a new PowerShell window, and run this again."
  exit 1
}

$Major = 0
try { $Major = [int]((& node --version).TrimStart('v').Split('.')[0]) } catch { $Major = 0 }
if ($Major -lt 18) {
  Write-Host "Frenemy needs Node.js 18 or newer. This computer has $(& node --version). Install the current one from https://nodejs.org and run this again."
  exit 1
}

& node (Join-Path $Dir 'install.mjs') @args
exit $LASTEXITCODE
