#Requires -Version 7.4

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string] $WorkspacePath,
    [Parameter(Mandatory)]
    [string] $PromptPath,
    [Parameter(Mandatory)]
    [string] $SourceBindingPath,
    [Parameter(Mandatory)]
    [string] $ChatManifestPath,
    [Parameter(Mandatory)]
    [string] $OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $WorkspacePath

$prompt = [IO.File]::ReadAllText($PromptPath)
$sourceBinding = [IO.File]::ReadAllText($SourceBindingPath) | ConvertFrom-Json -DateKind String
$chatManifest = [IO.File]::ReadAllText($ChatManifestPath) | ConvertFrom-Json -DateKind String
$evidencePaths = @(
    'docs/plans/four-agent-reasoning-integration.md'
    'docs/testing/validation.md'
    'docs/Project/wiki/azure/Four-Agent-Reasoning-Integration-Test.md'
    'docs/Project/wiki/azure/Validation-Status.md'
    'docs/Project/wiki/github/Four-Agent-Reasoning-Integration-Test.md'
    'docs/Project/wiki/github/Validation-Status.md'
    'docs/requirements/requirements-wiki-documents.zip'
    'docs/receipts/hv/20261109T140625-four-agent-reasoning-claude-hv-r18/correction-20261109T145809.md'
    'docs/receipts/hv/20261109T151227-four-agent-reasoning-claude-hv-r19/request.jsonl'
    'docs/receipts/hv/20261109T151227-four-agent-reasoning-claude-hv-r19/verdict.full.md'
    'docs/receipts/hv/20261109T151227-four-agent-reasoning-claude-hv-r19/correction-20261109T155052.md'
    'docs/receipts/hv/20261109T151227-four-agent-reasoning-claude-hv-r19/r20-documentation-validation.json'
    'docs/receipts/hv/20261109T164138-four-agent-reasoning-claude-hv-r20/response.jsonl'
    'docs/receipts/hv/20261109T164138-four-agent-reasoning-claude-hv-r20/stopped-over-scoped.json'
    'docs/receipts/hv/20261109T170519-four-agent-reasoning-claude-hv-r21/source-binding.json'
    'docs/receipts/hv/20261109T170519-four-agent-reasoning-claude-hv-r21/todo-readback.yaml'
    'docs/receipts/hv/20261109T170519-four-agent-reasoning-claude-hv-r21/todo-readback-summary.json'
    'docs/receipts/hv/20261109T170519-four-agent-reasoning-claude-hv-r21/parent-chat-unredacted-r20-to-r21.jsonl'
    'docs/receipts/hv/20261109T170519-four-agent-reasoning-claude-hv-r21/parent-chat-unredacted-r20-to-r21.manifest.json'
    'docs/receipts/hv/20261109T170519-four-agent-reasoning-claude-hv-r21/parent-chat-unredacted-r20-to-r21.public-credential-safe.jsonl'
    'docs/receipts/hv/20261109T170519-four-agent-reasoning-claude-hv-r21/credential-safe-copies-receipt.json'
    'docs/receipts/hv/20261109T170519-four-agent-reasoning-claude-hv-r21/review-prompt.md'
    'docs/receipts/hv/20261109T170519-four-agent-reasoning-claude-hv-r21/pre-launch-readiness.json'
)

$missing = @($evidencePaths | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($missing.Count -ne 0) { throw "Required R21 evidence is missing: $($missing -join ', ')" }

$request = [ordered]@{
    schemaVersion = 1
    timestampLocal = Get-Date -Format s
    workspacePath = $WorkspacePath
    gate = 'PLAN-FRENEMY-002 R21 remediation-delta hostile validation'
    reviewer = [ordered]@{ agent = 'ClaudeCode'; model = 'claude-opus-5-5'; effort = 'high' }
    launchCommand = "& 'F:\GitHub\frenemy\docs\receipts\hv\20261109T170519-four-agent-reasoning-claude-hv-r21\Invoke-ClaudeHv.ps1' -WorkspacePath 'F:\GitHub\frenemy' -PromptPath '$PromptPath' -ResponsePath 'F:\GitHub\frenemy\docs\receipts\hv\20261109T170519-four-agent-reasoning-claude-hv-r21\response.jsonl' -StandardErrorPath 'F:\GitHub\frenemy\docs\receipts\hv\20261109T170519-four-agent-reasoning-claude-hv-r21\stderr.log' -ResultPath 'F:\GitHub\frenemy\docs\receipts\hv\20261109T170519-four-agent-reasoning-claude-hv-r21\launcher-result.json'"
    head = [string] $sourceBinding.currentHead
    originMain = [string] $sourceBinding.originMain
    trackedPorcelainCount = [int] $sourceBinding.trackedPorcelainCount
    remediationBase = '49365a078fe2c3554cbdba5dc799e099a9715db5'
    remediationHead = '82e90f9df5047634767a3395a72ba76150e80d44'
    priorReview = [ordered]@{
        round = 'R19'
        verdict = 'DISAGREE'
        passCount = 48
        originalGatingFailCount = 2
        operatorNonGatingFindingCount = 1
        effectiveGatingFindingCount = 1
        unknownCount = 0
        verdictPath = 'docs/receipts/hv/20261109T151227-four-agent-reasoning-claude-hv-r19/verdict.full.md'
        verdictSha256 = '6D5FAD61CCFAD6D155303B71CD7388634F8151DFD1B446CF24DFFC4186037824'
    }
    scope = [ordered]@{
        type = 'remediation-delta'
        gatingRecheck = @('F-R19-01')
        operatorNonGating = @('F-R19-02')
        acceptedBaselinePassCount = 48
        reopenAcceptedItemOnlyIfDeltaChangedItsEvidenceOrBehavior = $true
        holisticReview = $false
    }
    stoppedRun = [ordered]@{
        round = 'R20'
        status = 'stopped'
        verdict = $null
        evidenceUse = 'Transparency only. Not a verdict and not acceptance evidence.'
    }
    unresolvedNonGatingGrokBalanceCases = @(
        [ordered]@{ case = 'NativeQualificationTestsQ01'; status = 'unresolved'; pass = $false }
        [ordered]@{ case = 'NativeProductionQualificationTestsQ01'; status = 'unresolved'; pass = $false }
        [ordered]@{ case = 'FourAgentReasoningIntegration live case'; status = 'unresolved'; pass = $false }
    )
    sourceReceipt = [ordered]@{ path = $SourceBindingPath; sha256 = (Get-FileHash -LiteralPath $SourceBindingPath -Algorithm SHA256).Hash }
    parentChat = [ordered]@{
        path = 'docs/receipts/hv/20261109T170519-four-agent-reasoning-claude-hv-r21/parent-chat-unredacted-r20-to-r21.jsonl'
        manifestPath = $ChatManifestPath
        manifestSha256 = (Get-FileHash -LiteralPath $ChatManifestPath -Algorithm SHA256).Hash
        chatSha256 = [string] $chatManifest.sha256
        contiguous = [bool] $chatManifest.contiguousWithPrevious
        redacted = $false
    }
    evidencePaths = $evidencePaths
    promptPath = $PromptPath
    promptSha256 = (Get-FileHash -LiteralPath $PromptPath -Algorithm SHA256).Hash
    prompt = $prompt
}

$jsonLine = $request | ConvertTo-Json -Depth 20 -Compress
if (-not $PSCmdlet.ShouldProcess($OutputPath, 'Write R21 remediation-delta request JSONL')) {
    $jsonLine
    return
}
Add-LinesToFile -LiteralPath $OutputPath -Content $jsonLine
$jsonLine
