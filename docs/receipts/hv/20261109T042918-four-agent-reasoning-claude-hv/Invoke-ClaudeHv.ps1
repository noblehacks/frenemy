<#
.SYNOPSIS
Launches the PLAN-FRENEMY-002 Claude Code hostile validation and retains paired receipts.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$ClaudePath,
    [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$PromptPath,
    [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$ChatSessionPath,
    [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })][string]$WorkspacePath,
    [Parameter(Mandatory)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })][string]$ReceiptDirectory
)

$workspaceFullPath = [IO.Path]::GetFullPath($WorkspacePath)
$receiptFullPath = [IO.Path]::GetFullPath($ReceiptDirectory)
$promptFullPath = [IO.Path]::GetFullPath($PromptPath)
$chatCopyPath = Join-Path $receiptFullPath 'visible-chat-unredacted-current-session.jsonl'
$readinessPath = Join-Path $receiptFullPath 'pre-hv-readiness.json'
$requestPath = Join-Path $receiptFullPath 'request.jsonl'
$responsePath = Join-Path $receiptFullPath 'response.jsonl'
$stderrPath = Join-Path $receiptFullPath 'stderr.log'
foreach ($path in @($chatCopyPath, $readinessPath, $requestPath, $responsePath, $stderrPath)) {
    if (Test-Path -LiteralPath $path) { throw "Receipt already exists: $path" }
}

Copy-Item -LiteralPath $ChatSessionPath -Destination $chatCopyPath
$sourceFiles = @(
    'docs/plans/four-agent-reasoning-integration.md',
    'docs/testing/validation.md',
    'tests/contracts/four-agent-reasoning.mjs',
    'tests/unit/four-agent-reasoning.contract.test.mjs',
    'tests/integration/four-agent-reasoning.integration.test.mjs',
    'tests/integration/four-agent-reasoning.archive.test.mjs',
    'build/Invoke-RelayTests.ps1'
)
$sourceReceipts = foreach ($relativePath in $sourceFiles) {
    $fullPath = Join-Path $workspaceFullPath $relativePath
    $item = Get-Item -LiteralPath $fullPath
    [ordered]@{
        path = $relativePath.Replace('\', '/')
        bytes = $item.Length
        lastWriteTimeLocal = $item.LastWriteTime.ToString('s')
        sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
    }
}
$readiness = [ordered]@{
    timestampLocal = Get-Date -Format 's'
    workspacePath = $workspaceFullPath
    reviewer = [ordered]@{ agent = 'ClaudeCode'; model = 'claude-opus-5-5'; effort = 'high' }
    scope = 'Existing JavaScript Frenemy server Grok Build and Cline CLI support plus the approved test-only four-agent reasoning validation.'
    sourceFiles = $sourceReceipts
    chat = [ordered]@{
        sourcePath = [IO.Path]::GetFullPath($ChatSessionPath)
        copiedPath = $chatCopyPath
        bytes = (Get-Item -LiteralPath $chatCopyPath).Length
        sha256 = (Get-FileHash -LiteralPath $chatCopyPath -Algorithm SHA256).Hash
        complete = $true
        redacted = $false
    }
    evidence = [ordered]@{
        focusedMock = 'TestResults/20261107T200421-four-agent-r10-remediation-mock'
        missingSessionMetadata = 'TestResults/20261107T200437-four-agent-r10-missing-session-metadata'
        extraDisclosed = 'TestResults/20261107T200558'
        fullGate = 'TestResults/20261107T200628-four-agent-r10-final-validate'
        liveBinding = 'TestResults/20261107T201715-four-agent-r10-final-live'
    }
    bounds = [ordered]@{ timeout = $null; maxTurns = $null; outputSize = $null; maxBudgetUsd = $null }
    readOnly = $true
    activePaidClineSessionsAtLaunch = 0
}
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($readinessPath, (($readiness | ConvertTo-Json -Depth 100) + "`n"), $utf8)

$prompt = [IO.File]::ReadAllText($promptFullPath)
$arguments = @(
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--include-hook-events',
    '--permission-mode', 'plan',
    '--permission-prompts', 'none',
    '--model', 'claude-opus-5-5',
    '--effort', 'high',
    '--name', 'PLAN-FRENEMY-002-HV',
    $prompt
)
$receiptArguments = @(
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--include-hook-events',
    '--permission-mode', 'plan',
    '--permission-prompts', 'none',
    '--model', 'claude-opus-5-5',
    '--effort', 'high',
    '--name', 'PLAN-FRENEMY-002-HV',
    '<prompt from promptPath>'
)
$chatCopyRelative = [IO.Path]::GetRelativePath($workspaceFullPath, $chatCopyPath).Replace('\', '/')
$readinessRelative = [IO.Path]::GetRelativePath($workspaceFullPath, $readinessPath).Replace('\', '/')
$evidencePaths = @(
    'docs/plans/four-agent-reasoning-integration.md',
    'docs/testing/validation.md',
    'docs/receipts/hv/20261107T193400-four-agent-reasoning-r10/verdict.md',
    'docs/receipts/hv/20261107T193400-four-agent-reasoning-r10/request.jsonl',
    'docs/receipts/hv/20261107T193400-four-agent-reasoning-r10/response.jsonl',
    'docs/receipts/hv/20261107T203051-four-agent-reasoning-r11/pre-hv-self-review.md',
    'docs/receipts/hv/20261107T234831-four-agent-reasoning-grok-hv/pre-hv-readiness.md',
    'docs/receipts/hv/20261107T234831-four-agent-reasoning-grok-hv/requirement-readbacks.json',
    'docs/receipts/hv/20261107T234831-four-agent-reasoning-grok-hv/visible-chat-unredacted-complete.md',
    'docs/receipts/hv/20261107T234831-four-agent-reasoning-grok-hv/visible-chat-chunks/chat-chunks-manifest.json',
    'docs/receipts/hv/20261108T214204-four-agent-reasoning-cline-hv/infrastructure-interruption-retry1.md',
    'docs/receipts/hv/20261108T214204-four-agent-reasoning-cline-hv/response-retry1.jsonl',
    $chatCopyRelative,
    $readinessRelative,
    'TestResults/20261107T200421-four-agent-r10-remediation-mock',
    'TestResults/20261107T200437-four-agent-r10-missing-session-metadata',
    'TestResults/20261107T200558',
    'TestResults/20261107T200628-four-agent-r10-final-validate',
    'TestResults/20261107T201715-four-agent-r10-final-live'
)
$request = [ordered]@{
    timestampLocal = Get-Date -Format 's'
    workspacePath = $workspaceFullPath
    reviewer = [ordered]@{ agent = 'ClaudeCode'; model = 'claude-opus-5-5'; effort = 'high' }
    authorization = 'Operator explicitly directed normal Claude Code with claude-opus-5-5 and high effort for this HV.'
    gate = 'PLAN-FRENEMY-002 independent hostile validation through Claude Code'
    todo = 'PLAN-FRENEMY-002'
    promptPath = $promptFullPath
    promptSha256 = (Get-FileHash -LiteralPath $promptFullPath -Algorithm SHA256).Hash
    evidencePaths = $evidencePaths
    launch = [ordered]@{
        executable = [IO.Path]::GetFullPath($ClaudePath)
        arguments = $receiptArguments
        timeout = $null
        maxTurns = $null
        outputSizeBound = $null
        maxBudgetUsd = $null
        readOnlyPlanMode = $true
    }
    prompt = $prompt
}
[IO.File]::WriteAllText($requestPath, (($request | ConvertTo-Json -Depth 100 -Compress) + "`n"), $utf8)

$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = [IO.Path]::GetFullPath($ClaudePath)
$startInfo.WorkingDirectory = $workspaceFullPath
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
foreach ($argument in $arguments) { $startInfo.ArgumentList.Add($argument) }

$process = [Diagnostics.Process]::new()
$process.StartInfo = $startInfo
$writer = [IO.StreamWriter]::new($responsePath, $false, $utf8)
$writer.AutoFlush = $true
$stderr = ''
$exitCode = $null
try {
    [void]$process.Start()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    while ($null -ne ($line = $process.StandardOutput.ReadLine())) { $writer.WriteLine($line) }
    $process.WaitForExit()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $exitCode = $process.ExitCode
}
finally {
    $writer.Dispose()
    $process.Dispose()
}
[IO.File]::WriteAllText($stderrPath, $stderr, $utf8)

[ordered]@{
    exitCode = $exitCode
    request = [ordered]@{ path = $requestPath; bytes = (Get-Item -LiteralPath $requestPath).Length; sha256 = (Get-FileHash -LiteralPath $requestPath -Algorithm SHA256).Hash }
    response = [ordered]@{ path = $responsePath; bytes = (Get-Item -LiteralPath $responsePath).Length; sha256 = (Get-FileHash -LiteralPath $responsePath -Algorithm SHA256).Hash }
    stderr = [ordered]@{ path = $stderrPath; bytes = (Get-Item -LiteralPath $stderrPath).Length; sha256 = (Get-FileHash -LiteralPath $stderrPath -Algorithm SHA256).Hash }
} | ConvertTo-Json -Depth 6
if ($exitCode -ne 0) { throw "Claude Code hostile validation exited with code $exitCode." }
