#Requires -Version 7.4

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string] $WorkspacePath,

    [Parameter(Mandatory)]
    [string] $PriorSourceBindingPath,

    [Parameter(Mandatory)]
    [string] $PriorVerdictPath,

    [Parameter(Mandatory)]
    [string] $OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $WorkspacePath

$prior = [IO.File]::ReadAllText($PriorSourceBindingPath) | ConvertFrom-Json -DateKind String
$testHead = [string] $prior.testHead
$currentHead = (& git rev-parse HEAD).Trim()
$originMain = (& git rev-parse origin/main).Trim()
$documentationOnlyChanges = @(& git diff --name-only "$testHead..$currentHead")
$trackedPorcelain = @(& git status --short --untracked-files=no)

if ($LASTEXITCODE -ne 0) { throw 'Git inspection failed.' }
if ($currentHead -ne $originMain) { throw "HEAD $currentHead does not equal origin/main $originMain." }
if ($trackedPorcelain.Count -ne 0) { throw "Tracked porcelain is not clean: $($trackedPorcelain -join ', ')" }
if (@($documentationOnlyChanges | Where-Object { $_ -notlike 'docs/*' }).Count -ne 0) {
    throw 'The test-head to review-head delta contains a non-documentation path.'
}

$bindings = foreach ($binding in $prior.testedSourceBindings) {
    $path = [string] $binding.relativePath
    $testBlob = (& git rev-parse "$testHead`:$path").Trim()
    $currentBlob = (& git hash-object -- $path).Trim()
    [ordered]@{
        relativePath = $path
        testHeadGitBlob = $testBlob
        currentWorkingTreeGitBlob = $currentBlob
        currentWorkingTreeSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        matches = $testBlob -eq $currentBlob
    }
}

$prior.schemaVersion = 4
$prior.createdAtLocal = Get-Date -Format s
$prior.currentHead = $currentHead
$prior.originMain = $originMain
$prior.trackedPorcelainCount = $trackedPorcelain.Count
$prior.documentationOnlyChanges = $documentationOnlyChanges
$prior.testedSourceBindings = $bindings
$prior.allTestedSourcesMatch = @($bindings | Where-Object { -not $_.matches }).Count -eq 0
$prior | Add-Member -NotePropertyName reviewRound -NotePropertyValue 'R21' -Force
$prior | Add-Member -NotePropertyName priorReview -NotePropertyValue ([ordered]@{
    round = 'R19'
    verdict = 'DISAGREE'
    overallAccuracy = 97
    overallCompleteness = 98
    task4Accuracy = 96
    task4Completeness = 97
    passCount = 48
    originalGatingFailCount = 2
    operatorNonGatingFindingCount = 1
    effectiveGatingFailCount = 1
    unknownCount = 0
    unresolvedNonGatingGrokBalanceCount = 3
    verdictPath = $PriorVerdictPath
    verdictBytes = (Get-Item -LiteralPath $PriorVerdictPath).Length
    verdictSha256 = (Get-FileHash -LiteralPath $PriorVerdictPath -Algorithm SHA256).Hash
    responsePath = 'docs/receipts/hv/20261109T151227-four-agent-reasoning-claude-hv-r19/response.jsonl'
    responseSha256 = (Get-FileHash -LiteralPath 'docs/receipts/hv/20261109T151227-four-agent-reasoning-claude-hv-r19/response.jsonl' -Algorithm SHA256).Hash
    claudeCodeSessionId = '6bf9d3d8-73d2-472d-b1aa-fccd501e954b'
    mcpSessionId = 'ClaudeCode-20261109T213022Z-plugin-session'
    sessionLogRequestId = 'req-20261109T213033Z-prompt-97af'
    sessionLogPersistence = 'completeTurn persisted; readback confirmed completed turn and full response; body SHA comparison unavailable from queryHistory'
}) -Force

if (-not $prior.allTestedSourcesMatch) { throw 'At least one tested product or test source differs from the test head.' }

$json = $prior | ConvertTo-Json -Depth 20
if (-not $PSCmdlet.ShouldProcess($OutputPath, 'Write R21 source-binding receipt')) {
    $json
    return
}
Add-LinesToFile -LiteralPath $OutputPath -Content $json
$json
