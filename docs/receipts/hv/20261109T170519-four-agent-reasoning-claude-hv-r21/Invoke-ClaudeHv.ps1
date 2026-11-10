#Requires -Version 7.4

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string] $WorkspacePath,
    [Parameter(Mandatory)]
    [string] $PromptPath,
    [Parameter(Mandatory)]
    [string] $ResponsePath,
    [Parameter(Mandatory)]
    [string] $StandardErrorPath,
    [Parameter(Mandatory)]
    [string] $ResultPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$claude = (Get-Command claude -ErrorAction Stop).Source
$prompt = [IO.File]::ReadAllText($PromptPath)
$arguments = @(
    '--print'
    '--output-format'
    'stream-json'
    '--verbose'
    '--include-partial-messages'
    '--include-hook-events'
    '--permission-mode'
    'auto'
    '--permission-prompts'
    'none'
    '--model'
    'claude-opus-5-5'
    '--effort'
    'high'
    '--name'
    'PLAN-FRENEMY-002-HV-R21'
    $prompt
)

if (-not $PSCmdlet.ShouldProcess($WorkspacePath, 'Run normal Claude Code hostile validation')) { return }

Set-Location -LiteralPath $WorkspacePath
$env:MCP_FAILSAFE_DRAIN_DISABLED = '1'
$env:CLAUDE_PLUGIN_ROOT = 'F:\GitHub\mcpserver-claude-code-plugin'
$env:PLUGIN_AGENT_NAME = 'Claude'
$startedAt = Get-Date -Format s
try {
    & $claude @arguments 2> $StandardErrorPath | Tee-Object -FilePath $ResponsePath
    $exitCode = $LASTEXITCODE
    $status = if ($exitCode -eq 0) { 'completed' } else { 'failed' }
}
catch {
    $exitCode = -1
    $status = 'exception'
    $_ | Out-String | Add-LinesToFile -LiteralPath $StandardErrorPath
}
finally {
    $result = [ordered]@{
        startedAtLocal = $startedAt
        completedAtLocal = Get-Date -Format s
        status = $status
        exitCode = $exitCode
        responsePath = $ResponsePath
        responseExists = Test-Path -LiteralPath $ResponsePath
        responseBytes = if (Test-Path -LiteralPath $ResponsePath) { (Get-Item -LiteralPath $ResponsePath).Length } else { 0 }
        responseSha256 = if (Test-Path -LiteralPath $ResponsePath) { (Get-FileHash -LiteralPath $ResponsePath -Algorithm SHA256).Hash } else { $null }
        stderrPath = $StandardErrorPath
        stderrBytes = if (Test-Path -LiteralPath $StandardErrorPath) { (Get-Item -LiteralPath $StandardErrorPath).Length } else { 0 }
    } | ConvertTo-Json -Depth 4
    Add-LinesToFile -LiteralPath $ResultPath -Content $result
}
exit $exitCode
