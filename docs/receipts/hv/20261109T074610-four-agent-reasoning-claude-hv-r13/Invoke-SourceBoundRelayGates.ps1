#Requires -Version 7.0
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9]{8}T[0-9]{6}-[a-z0-9-]+$')]
    [string]$RunId,

    [string]$WorkspacePath = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).ProviderPath,

    [string]$ReceiptPath = (Join-Path $PSScriptRoot "source-bound-$RunId.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$testedSourcePaths = @(
    'ask-claude-mcp.mjs'
    'build/Build.cs'
    'build/Convert-TestResultsToTrx.ps1'
    'build/Invoke-RelayTests.ps1'
    'tests/fixtures/four-agent-reasoning-questions.json'
    'tests/contracts/four-agent-reasoning.mjs'
    'tests/contracts/zip-archive.mjs'
    'tests/unit/four-agent-reasoning.contract.test.mjs'
    'tests/integration/four-agent-reasoning.integration.test.mjs'
    'tests/integration/four-agent-reasoning.archive.test.mjs'
)

$targets = @(
    'TestIntegrationRelay'
    'TestUnitRelay'
    'VerifyMocks'
)

function Invoke-GitText {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $output = @(& git @Arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }

    return @($output | ForEach-Object { [string]$_ })
}

function Get-TestedSourceSnapshot {
    param([Parameter(Mandatory)][string]$Root)

    return @($testedSourcePaths | ForEach-Object {
        $relativePath = $_
        $fullPath = Join-Path $Root $relativePath
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            throw "Tested source does not exist: $relativePath"
        }

        $item = Get-Item -LiteralPath $fullPath
        [ordered]@{
            relativePath = $relativePath
            sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
            length = $item.Length
        }
    })
}

function Get-TrxReceipt {
    param([Parameter(Mandatory)][System.IO.FileInfo]$File)

    $document = [xml][System.IO.File]::ReadAllText($File.FullName)
    $counters = $document.TestRun.ResultSummary.Counters
    return [ordered]@{
        path = $File.FullName
        sha256 = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash
        total = [int]$counters.total
        executed = [int]$counters.executed
        passed = [int]$counters.passed
        failed = [int]$counters.failed
        notExecuted = [int]$counters.notExecuted
    }
}

$workspace = (Resolve-Path -LiteralPath $WorkspacePath).ProviderPath
$buildScript = Join-Path $workspace 'build.ps1'
$resultRoot = Join-Path $workspace (Join-Path 'TestResults' $RunId)
$receiptFullPath = [System.IO.Path]::GetFullPath($ReceiptPath)

if (-not (Test-Path -LiteralPath $buildScript -PathType Leaf)) {
    throw "Nuke launcher does not exist: $buildScript"
}

Push-Location $workspace
try {
    $startLocal = Get-Date
    $headBefore = Invoke-GitText -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1
    $branch = Invoke-GitText -Arguments @('branch', '--show-current') | Select-Object -First 1
    $trackedPorcelainBefore = @(Invoke-GitText -Arguments @('status', '--porcelain=v1', '--untracked-files=no'))
    $fullPorcelainBefore = @(Invoke-GitText -Arguments @('status', '--porcelain=v1'))
    $sourcesBefore = @(Get-TestedSourceSnapshot -Root $workspace)
    $commands = @($targets | ForEach-Object { ".\build.ps1 $_ --test-run-id $RunId" })

    $plan = [ordered]@{
        schemaVersion = 1
        runId = $RunId
        workspacePath = $workspace
        host = $env:COMPUTERNAME
        branch = $branch
        headBefore = $headBefore
        startedAtLocal = $startLocal.ToString('s')
        trackedPorcelainBefore = $trackedPorcelainBefore
        trackedPorcelainCountBefore = $trackedPorcelainBefore.Count
        fullPorcelainBefore = $fullPorcelainBefore
        fullPorcelainCountBefore = $fullPorcelainBefore.Count
        testedSourcesBefore = $sourcesBefore
        commands = $commands
    }

    if (-not $PSCmdlet.ShouldProcess($workspace, "Run Nuke gates and write $receiptFullPath")) {
        [pscustomobject]$plan
        return
    }

    if ($trackedPorcelainBefore.Count -ne 0) {
        throw 'The source-bound gate requires a tracked-clean working tree.'
    }

    $executions = [System.Collections.Generic.List[object]]::new()
    foreach ($target in $targets) {
        $targetStarted = Get-Date
        & $buildScript $target '--test-run-id' $RunId
        $exitCode = $LASTEXITCODE
        $executions.Add([ordered]@{
            target = $target
            command = ".\build.ps1 $target --test-run-id $RunId"
            startedAtLocal = $targetStarted.ToString('s')
            completedAtLocal = (Get-Date).ToString('s')
            exitCode = $exitCode
        })
        if ($exitCode -ne 0) {
            throw "Nuke target $target failed with exit code $exitCode."
        }
    }

    $headAfter = Invoke-GitText -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1
    $trackedPorcelainAfter = @(Invoke-GitText -Arguments @('status', '--porcelain=v1', '--untracked-files=no'))
    $fullPorcelainAfter = @(Invoke-GitText -Arguments @('status', '--porcelain=v1'))
    $sourcesAfter = @(Get-TestedSourceSnapshot -Root $workspace)
    $trxFiles = @(Get-ChildItem -LiteralPath $resultRoot -Recurse -Filter '*.trx' -File | Sort-Object FullName)
    $trxReceipts = @($trxFiles | ForEach-Object { Get-TrxReceipt -File $_ })
    $sourceHashesStable = (ConvertTo-Json $sourcesBefore -Compress -Depth 5) -ceq (ConvertTo-Json $sourcesAfter -Compress -Depth 5)

    $receipt = [ordered]@{
        schemaVersion = 1
        runId = $RunId
        workspacePath = $workspace
        host = $env:COMPUTERNAME
        branch = $branch
        headBefore = $headBefore
        headAfter = $headAfter
        headStable = $headBefore -ceq $headAfter
        startedAtLocal = $startLocal.ToString('s')
        completedAtLocal = (Get-Date).ToString('s')
        trackedPorcelainBefore = $trackedPorcelainBefore
        trackedPorcelainCountBefore = $trackedPorcelainBefore.Count
        trackedPorcelainAfter = $trackedPorcelainAfter
        trackedPorcelainCountAfter = $trackedPorcelainAfter.Count
        fullPorcelainBefore = $fullPorcelainBefore
        fullPorcelainCountBefore = $fullPorcelainBefore.Count
        fullPorcelainAfter = $fullPorcelainAfter
        fullPorcelainCountAfter = $fullPorcelainAfter.Count
        testedSourcesBefore = $sourcesBefore
        testedSourcesAfter = $sourcesAfter
        testedSourceHashesStable = $sourceHashesStable
        executions = @($executions)
        trx = $trxReceipts
        total = [int](($trxReceipts | Measure-Object -Property total -Sum).Sum)
        passed = [int](($trxReceipts | Measure-Object -Property passed -Sum).Sum)
        failed = [int](($trxReceipts | Measure-Object -Property failed -Sum).Sum)
        notExecuted = [int](($trxReceipts | Measure-Object -Property notExecuted -Sum).Sum)
    }

    $receiptDirectory = Split-Path -Parent $receiptFullPath
    [System.IO.Directory]::CreateDirectory($receiptDirectory) | Out-Null
    [System.IO.File]::WriteAllText(
        $receiptFullPath,
        ((ConvertTo-Json $receipt -Depth 10) + [Environment]::NewLine),
        [System.Text.UTF8Encoding]::new($false)
    )

    [pscustomobject]$receipt

    if (-not $receipt.headStable -or
        $receipt.trackedPorcelainCountAfter -ne 0 -or
        -not $receipt.testedSourceHashesStable -or
        $receipt.failed -ne 0 -or
        $receipt.notExecuted -ne 0) {
        throw 'Source-bound gate receipt contains a failed identity or test condition.'
    }
}
finally {
    Pop-Location
}
