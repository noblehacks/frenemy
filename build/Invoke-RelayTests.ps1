<#
.SYNOPSIS
Runs Frenemy's separate unit and integration test projects for a Nuke target.

.DESCRIPTION
Invokes Node's built-in test runner and Pester without a shell, retains their
original XML reports, converts them to TRX, and rejects failures, skips, empty
selections, unknown projects, and unknown test classes.

.PARAMETER Target
Nuke target implemented by this script.

.PARAMETER TestRunId
Stable result directory identifier.

.PARAMETER TestGroupsJson
JSON array of project-to-class selections for the TestGroups target.

.PARAMETER GrokExecutable
Absolute native Grok executable selected for native qualification.

.PARAMETER ClineExecutable
Absolute native Cline executable selected for native qualification.

.PARAMETER ClaudeExecutable
Absolute Claude Code executable selected for the four-agent integration.

.PARAMETER CodexExecutable
Absolute Codex executable selected for the four-agent integration.

.NOTES
Change log:
- 2026-11-06, TEST-FRENEMY-114 and TEST-FRENEMY-115, AC-TEST-FRENEMY-114-01
  through AC-TEST-FRENEMY-115-06: Added the independent mock gate and retained
  unit/integration result orchestration.
 - 2026-11-06, TEST-FRENEMY-114, AC-TEST-FRENEMY-114-01: Retained Node's raw
   JUnit while excluding name-filtered, unselected cases from the focused group
   result so only selected classes contribute to the zero-skip gate.
 - 2026-11-06, TEST-FRENEMY-114 and TEST-FRENEMY-115,
   AC-TEST-FRENEMY-114-01 through AC-TEST-FRENEMY-115-06: Bound the shared
   relay contract to the production MCP entry point as a JavaScript integration
   project and made it selectable through TestGroups.
 - 2026-11-07, FR-FRENEMY-117, TR-FRENEMY-ORCH-121, TEST-FRENEMY-117,
   AC-TEST-FRENEMY-117-06: Added the deterministic four-agent reasoning mock
   contract class to the Nuke TestGroups routing without live-data dependency.
 - 2026-11-07, FR-FRENEMY-117, TR-FRENEMY-ORCH-121, TEST-FRENEMY-117,
   AC-FRENEMY-117-01 through AC-FRENEMY-117-05,
   AC-TR-FRENEMY-ORCH-121-01 through AC-TR-FRENEMY-ORCH-121-06, and
   AC-TEST-FRENEMY-117-07 through AC-TEST-FRENEMY-117-08: Added opt-in live
   four-agent execution, retained reports, always-run archive finalization, and
   mechanical ZIP validation without adding the paid target to Validate.
 - 2026-11-07, FR-FRENEMY-117, TR-FRENEMY-ORCH-121, TEST-FRENEMY-117,
   AC-FRENEMY-117-04, AC-TR-FRENEMY-ORCH-121-05, and
   AC-TEST-FRENEMY-117-07 through AC-TEST-FRENEMY-117-08: Retained measured
   test timing, failed-run reports, executable versions, post-validation archive
   receipts, tested-source verification, and a production-bound archive contract.
 - 2026-11-07, TEST-FRENEMY-117, AC-TEST-FRENEMY-117-08: Added the independent
   ZIP parser contract to the tested-source manifest for live archive validation.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('VerifyMocks', 'VerifyFourAgentReasoningMocks', 'NativeQualification', 'TestUnitRelay', 'TestIntegrationRelay', 'FourAgentReasoningIntegration', 'Validate', 'TestGroups')]
    [string]$Target,

    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$TestRunId,

    [ValidateNotNullOrEmpty()]
    [string]$TestGroupsJson = '[]',

    [string]$GrokExecutable,

    [string]$ClineExecutable,

    [string]$ClaudeExecutable,

    [string]$CodexExecutable
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$resultRoot = Join-Path $repo "TestResults/$TestRunId"
$converter = Join-Path $PSScriptRoot 'Convert-TestResultsToTrx.ps1'
$TestGroups = @($TestGroupsJson | ConvertFrom-Json)
$script:SelectedGrokExecutable = $GrokExecutable
$script:SelectedClineExecutable = $ClineExecutable
$script:SelectedClaudeExecutable = $ClaudeExecutable
$script:SelectedCodexExecutable = $CodexExecutable

function Invoke-NodeTestProject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Project,
        [Parameter(Mandatory)][string]$TestFile,
        [Parameter(Mandatory)][string]$OutputDirectory,
        [string]$TestNamePattern,
        [hashtable]$Environment = @{}
    )

    $node = (Get-Command node -ErrorAction Stop).Source
    $testStem = [IO.Path]::GetFileNameWithoutExtension($TestFile)
    $junit = Join-Path $OutputDirectory "$Project.$testStem.node.junit.xml"
    $stderr = Join-Path $OutputDirectory "$Project.$testStem.node.stderr.log"
    [IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $node
    $startInfo.WorkingDirectory = $repo
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($entry in $Environment.GetEnumerator()) { $startInfo.Environment[$entry.Key] = [string]$entry.Value }
    $startInfo.ArgumentList.Add('--test')
    $startInfo.ArgumentList.Add('--test-reporter=junit')
    if ($TestNamePattern) {
        $startInfo.ArgumentList.Add('--test-name-pattern')
        $startInfo.ArgumentList.Add($TestNamePattern)
    }
    $startInfo.ArgumentList.Add($TestFile)
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $startedAt = [DateTimeOffset]::Now
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $errorText = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $finishedAt = [DateTimeOffset]::Now
    [IO.File]::WriteAllText($junit, $stdout, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($stderr, $errorText, [Text.UTF8Encoding]::new($false))
    $timing = [ordered]@{ startedAt=$startedAt.ToString('o'); finishedAt=$finishedAt.ToString('o'); exitCode=$process.ExitCode }
    [IO.File]::WriteAllText("$junit.timing.json", "$(($timing | ConvertTo-Json -Depth 4))`n", [Text.UTF8Encoding]::new($false))
    if ($process.ExitCode -ne 0) { throw "$Project Node tests failed with exit code $($process.ExitCode). See $stderr" }
    [xml]$document = $stdout
    if ($TestNamePattern) {
        $unselected = @($document.SelectNodes('//*[local-name()="testcase"]') | Where-Object {
            $_.SelectSingleNode('./*[local-name()="skipped"]') -and [string]$_.name -notmatch $TestNamePattern
        })
        if ($unselected.Count -gt 0) {
            $rawJunit = Join-Path $OutputDirectory "$Project.$testStem.node.raw.junit.xml"
            [IO.File]::WriteAllText($rawJunit, $stdout, [Text.UTF8Encoding]::new($false))
            foreach ($case in $unselected) { [void]$case.ParentNode.RemoveChild($case) }
            [IO.File]::WriteAllText($junit, $document.OuterXml, [Text.UTF8Encoding]::new($false))
        }
    }
    $skipped = @($document.SelectNodes('//*[local-name()="testcase"]/*[local-name()="skipped"]')).Count
    if ($skipped -gt 0) { throw "$Project Node tests skipped $skipped case(s)." }
    if (@($document.SelectNodes('//*[local-name()="testcase"]')).Count -eq 0) { throw "$Project Node selection executed no test case." }
    return $junit
}

function Invoke-PesterTestProject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Project,
        [Parameter(Mandatory)][string]$TestFile,
        [Parameter(Mandatory)][string]$Tag,
        [Parameter(Mandatory)][string]$OutputDirectory,
        [string]$FullNamePattern
    )

    Import-Module Pester -MinimumVersion 5.7.1 -ErrorAction Stop
    $nunit = Join-Path $OutputDirectory "$Project.pester.nunit.xml"
    $configuration = New-PesterConfiguration
    $configuration.Run.Path = $TestFile
    $configuration.Run.PassThru = $true
    $configuration.Filter.Tag = @($Tag)
    if ($FullNamePattern) { $configuration.Filter.FullName = @($FullNamePattern) }
    $configuration.TestResult.Enabled = $true
    $configuration.TestResult.OutputFormat = 'NUnitXml'
    $configuration.TestResult.OutputPath = $nunit
    $configuration.Output.Verbosity = 'Detailed'
    $startedAt = [DateTimeOffset]::Now
    try {
        $result = Invoke-Pester -Configuration $configuration
    }
    finally {
        $finishedAt = [DateTimeOffset]::Now
        $timing = [ordered]@{ startedAt=$startedAt.ToString('o'); finishedAt=$finishedAt.ToString('o') }
        [IO.File]::WriteAllText("$nunit.timing.json", "$(($timing | ConvertTo-Json -Depth 4))`n", [Text.UTF8Encoding]::new($false))
    }
    if ($result.FailedCount -gt 0) { throw "$Project Pester tests failed $($result.FailedCount) case(s)." }
    if ($result.SkippedCount -gt 0) { throw "$Project Pester tests skipped $($result.SkippedCount) case(s)." }
    if ($result.TotalCount -eq 0) { throw "$Project Pester selection executed no test case." }
    return $nunit
}

function Invoke-UnitProject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$OutputDirectory,
        [string[]]$Classes = @('RelayContractMockTests', 'FourAgentReasoningMockTests', 'ProtectGrokPromptTests')
    )

    $resultFiles = [System.Collections.Generic.List[string]]::new()
    if ($Classes -contains 'RelayContractMockTests') {
        $resultFiles.Add((Invoke-NodeTestProject -Project 'Frenemy.Relay.UnitTests' -TestFile (Join-Path $repo 'tests/unit/relay.contract.test.mjs') -OutputDirectory $OutputDirectory -TestNamePattern 'RelayContractMockTests'))
    }
    if ($Classes -contains 'FourAgentReasoningMockTests') {
        $resultFiles.Add((Invoke-NodeTestProject -Project 'Frenemy.Relay.UnitTests' -TestFile (Join-Path $repo 'tests/unit/four-agent-reasoning.contract.test.mjs') -OutputDirectory $OutputDirectory -TestNamePattern 'FourAgentReasoningMockTests'))
    }
    if ($Classes -contains 'ProtectGrokPromptTests') {
        $resultFiles.Add((Invoke-PesterTestProject -Project 'Frenemy.Relay.UnitTests' -TestFile (Join-Path $repo 'tests/unit/Protect-GrokPrompt.Tests.ps1') -Tag 'Unit' -OutputDirectory $OutputDirectory -FullNamePattern '*ProtectGrokPromptTests*'))
    }
    if ($resultFiles.Count -eq 0) { throw 'The selected unit classes executed no test project.' }
    $trx = Join-Path $OutputDirectory 'Frenemy.Relay.UnitTests.trx'
    & $converter -InputPath @($resultFiles) -OutputPath $trx -RunName 'Frenemy.Relay.UnitTests' | Write-Output
}

function Invoke-NativeQualificationProject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$OutputDirectory,
        [string[]]$Classes = @(
            'NativeQualificationTestsQ01',
            'NativeQualificationTestsQ02',
            'NativeProductionQualificationTestsQ01',
            'NativeProductionQualificationTestsQ02',
            'ProtectGrokPromptIntegrationTests'
        )
    )

    foreach ($selection in @(@{ Name='GrokExecutable'; Path=$script:SelectedGrokExecutable }, @{ Name='ClineExecutable'; Path=$script:SelectedClineExecutable })) {
        if ([string]::IsNullOrWhiteSpace($selection.Path) -or -not [IO.Path]::IsPathFullyQualified($selection.Path) -or -not (Test-Path -LiteralPath $selection.Path -PathType Leaf)) {
            throw "$($selection.Name) must name an existing absolute file for NativeQualification."
        }
    }
    if ($IsWindows -and [IO.Path]::GetExtension($script:SelectedGrokExecutable) -ine '.exe') { throw 'GrokExecutable must be an .exe file on Windows.' }
    if ($IsWindows -and [IO.Path]::GetExtension($script:SelectedClineExecutable) -ine '.exe') { throw 'ClineExecutable must be an .exe file on Windows.' }

    $powerShellExecutable = (Get-Command pwsh -ErrorAction Stop).Source
    $nativeResultDirectory = Join-Path $OutputDirectory 'fixtures'
    $environment = @{
        FRENEMY_GROK_EXECUTABLE = [IO.Path]::GetFullPath($script:SelectedGrokExecutable)
        FRENEMY_CLINE_EXECUTABLE = [IO.Path]::GetFullPath($script:SelectedClineExecutable)
        FRENEMY_PWSH_EXECUTABLE = $powerShellExecutable
        FRENEMY_NATIVE_RESULT_DIR = $nativeResultDirectory
    }
    $resultFiles = [System.Collections.Generic.List[string]]::new()
    $nodeClasses = @($Classes | Where-Object { $_ -in @('NativeQualificationTestsQ01', 'NativeQualificationTestsQ02') })
    if ($nodeClasses.Count -gt 0) {
        $resultFiles.Add((Invoke-NodeTestProject -Project 'Frenemy.Relay.NativeQualification' -TestFile (Join-Path $repo 'tests/native/native-qualification.test.mjs') -OutputDirectory $OutputDirectory -TestNamePattern ($nodeClasses -join '|') -Environment $environment))
    }
    $productClasses = @($Classes | Where-Object { $_ -in @('NativeProductionQualificationTestsQ01', 'NativeProductionQualificationTestsQ02') })
    if ($productClasses.Count -gt 0) {
        $resultFiles.Add((Invoke-NodeTestProject -Project 'Frenemy.Relay.NativeQualification' -TestFile (Join-Path $repo 'tests/native/production-native-qualification.test.mjs') -OutputDirectory $OutputDirectory -TestNamePattern ($productClasses -join '|') -Environment $environment))
    }
    if ($IsWindows -and $Classes -contains 'ProtectGrokPromptIntegrationTests') {
        $resultFiles.Add((Invoke-PesterTestProject -Project 'Frenemy.Relay.NativeQualification' -TestFile (Join-Path $repo 'tests/integration/Protect-GrokPrompt.Tests.ps1') -Tag 'Integration' -OutputDirectory $OutputDirectory -FullNamePattern '*ProtectGrokPromptIntegrationTests*'))
    }
    if ($resultFiles.Count -eq 0) { throw 'The selected native qualification classes executed no test project.' }
    $trx = Join-Path $OutputDirectory 'Frenemy.Relay.NativeQualification.trx'
    & $converter -InputPath @($resultFiles) -OutputPath $trx -RunName 'Frenemy.Relay.NativeQualification' | Write-Output
}

function Invoke-IntegrationProject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$OutputDirectory,
        [string[]]$Classes = @('RelayContractIntegrationTests')
    )

    if ($Classes -notcontains 'RelayContractIntegrationTests') {
        throw 'The selected integration classes executed no test project.'
    }
    $junit = Invoke-NodeTestProject `
        -Project 'Frenemy.Relay.IntegrationTests' `
        -TestFile (Join-Path $repo 'tests/integration/relay.contract.test.mjs') `
        -OutputDirectory $OutputDirectory `
        -TestNamePattern 'RelayContractIntegrationTests'
    $trx = Join-Path $OutputDirectory 'Frenemy.Relay.IntegrationTests.trx'
    & $converter -InputPath @($junit) -OutputPath $trx -RunName 'Frenemy.Relay.IntegrationTests' | Write-Output
}

function Assert-FourAgentExecutable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathFullyQualified($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Name must name an existing absolute executable file for FourAgentReasoningIntegration."
    }
    if ($IsWindows -and [IO.Path]::GetExtension($Path) -ine '.exe') {
        throw "$Name must be an .exe file on Windows."
    }
}

function Get-FourAgentExecutableVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Path
    )

    $timeoutMilliseconds = 10000
    $process = [Diagnostics.Process]::new()
    try {
        $startInfo = [Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $Path
        $startInfo.WorkingDirectory = $repo
        $startInfo.UseShellExecute = $false
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.ArgumentList.Add('--version')
        $process.StartInfo = $startInfo
        [void]$process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($timeoutMilliseconds)) {
            try { $process.Kill($true) } catch { }
            return "ERROR: $Name --version timed out after $timeoutMilliseconds ms."
        }
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $version = @($stdout, $stderr | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "`n"
        $version = $version.Trim()
        if ($process.ExitCode -ne 0) { return "ERROR: $Name --version failed with exit code $($process.ExitCode). $version".Trim() }
        if ([string]::IsNullOrWhiteSpace($version)) { return "ERROR: $Name --version returned no version text." }
        return $version
    }
    catch {
        return "ERROR: $Name --version failed: $($_.Exception.Message)"
    }
    finally {
        $process.Dispose()
    }
}

function Complete-FourAgentReasoningArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ArtifactRoot,
        [Parameter(Mandatory)][string]$ArchivePath,
        [Parameter(Mandatory)][hashtable]$SelectedExecutables,
        [Parameter(Mandatory)][string]$RunStartedAt,
        [Parameter(Mandatory)][ValidateSet('passed', 'failed')][string]$RunStatus
    )

    [IO.Directory]::CreateDirectory($ArtifactRoot) | Out-Null
    $manifestPath = Join-Path $ArtifactRoot 'manifest.json'
    $validationPath = Join-Path $ArtifactRoot 'archive-validation.json'
    $excluded = @($manifestPath, $validationPath)
    $files = @(Get-ChildItem -LiteralPath $ArtifactRoot -Recurse -File | Where-Object { $_.FullName -notin $excluded } | Sort-Object FullName)
    $entries = @($files | ForEach-Object {
        [ordered]@{
            path = [IO.Path]::GetRelativePath($ArtifactRoot, $_.FullName).Replace('\', '/')
            size = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    })
    $targets = [ordered]@{}
    foreach ($name in @('claude', 'codex', 'grok', 'cline')) {
        $path = [IO.Path]::GetFullPath([string]$SelectedExecutables[$name])
        $targets[$name] = [ordered]@{
            path = $path
            version = Get-FourAgentExecutableVersion -Name $name -Path $path
            fileVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($path).FileVersion
            effort = 'medium'
            provider = if ($name -eq 'cline') { 'openai-codex' } else { $null }
            model = if ($name -eq 'cline') { 'gpt-5.6-luna' } else { $null }
        }
    }
    $gitHead = (& git -C $repo rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve the git head for the four-agent manifest.' }
    $sourcePaths = @(
        'ask-claude-mcp.mjs',
        'build/Build.cs',
        'build/Convert-TestResultsToTrx.ps1',
        'build/Invoke-RelayTests.ps1',
        'tests/fixtures/four-agent-reasoning-questions.json',
        'tests/contracts/four-agent-reasoning.mjs',
        'tests/contracts/zip-archive.mjs',
        'tests/unit/four-agent-reasoning.contract.test.mjs',
        'tests/integration/four-agent-reasoning.integration.test.mjs',
        'tests/integration/four-agent-reasoning.archive.test.mjs'
    )
    $sourceFiles = @($sourcePaths | ForEach-Object {
        $sourcePath = Join-Path $repo $_
        [ordered]@{
            path = $_
            size = (Get-Item -LiteralPath $sourcePath).Length
            sha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
        }
    })
    $manifest = [ordered]@{
        runId = $TestRunId
        gitHead = $gitHead
        host = [Environment]::MachineName
        participants = @('claude', 'codex', 'grok', 'cline')
        effort = 'medium'
        targets = $targets
        status = $RunStatus
        startedAt = $RunStartedAt
        completedAt = (Get-Date).ToString('s')
        sourceFiles = $sourceFiles
        entries = $entries
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText($manifestPath, "$manifestJson`n", [Text.UTF8Encoding]::new($false))
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash

    if (Test-Path -LiteralPath $ArchivePath) { throw "Archive already exists: $ArchivePath" }
    Compress-Archive -Path (Join-Path $ArtifactRoot '*') -DestinationPath $ArchivePath -CompressionLevel Optimal
    $expandedRoot = Join-Path (Split-Path -Parent $ArtifactRoot) '_four-agent-archive-validation'
    $resultRootFull = [IO.Path]::GetFullPath((Split-Path -Parent $ArtifactRoot))
    $expandedRootFull = [IO.Path]::GetFullPath($expandedRoot)
    if (-not $expandedRootFull.StartsWith($resultRootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Archive validation directory escaped the result root: $expandedRootFull"
    }
    if (Test-Path -LiteralPath $expandedRootFull) { Remove-Item -LiteralPath $expandedRootFull -Recurse -Force }
    try {
        Expand-Archive -LiteralPath $ArchivePath -DestinationPath $expandedRootFull
        $actualFiles = @(Get-ChildItem -LiteralPath $expandedRootFull -Recurse -File | Sort-Object FullName)
        $actualMembers = @($actualFiles | ForEach-Object { [IO.Path]::GetRelativePath($expandedRootFull, $_.FullName).Replace('\', '/') })
        $expectedMembers = @(@($entries.path) + @('manifest.json') | Sort-Object)
        $actualMembersSorted = @($actualMembers | Sort-Object)
        if (Compare-Object -ReferenceObject $expectedMembers -DifferenceObject $actualMembersSorted) {
            throw 'Archive member set did not match the manifest and validation receipt.'
        }
        if ((Get-FileHash -LiteralPath (Join-Path $expandedRootFull 'manifest.json') -Algorithm SHA256).Hash -ne $manifestHash) {
            throw 'Expanded archive manifest hash did not match the retained receipt.'
        }
        foreach ($entry in $entries) {
            $expandedPath = Join-Path $expandedRootFull $entry.path
            $item = Get-Item -LiteralPath $expandedPath
            if ($item.Length -ne $entry.size) { throw "Archive member size mismatch: $($entry.path)" }
            if ((Get-FileHash -LiteralPath $expandedPath -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Archive member hash mismatch: $($entry.path)" }
        }
        $expandedManifest = [IO.File]::ReadAllText((Join-Path $expandedRootFull 'manifest.json')) | ConvertFrom-Json
        foreach ($sourceFile in $expandedManifest.sourceFiles) {
            $sourcePath = Join-Path $repo ([string]$sourceFile.path)
            if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Tested source file is missing: $($sourceFile.path)" }
            $sourceItem = Get-Item -LiteralPath $sourcePath
            if ($sourceItem.Length -ne $sourceFile.size) { throw "Tested source size mismatch: $($sourceFile.path)" }
            if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne $sourceFile.sha256) { throw "Tested source hash mismatch: $($sourceFile.path)" }
        }
    }
    finally {
        if (Test-Path -LiteralPath $expandedRootFull) { Remove-Item -LiteralPath $expandedRootFull -Recurse -Force }
    }
    $archiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash
    $validation = [ordered]@{
        runId = $TestRunId
        manifestSha256 = $manifestHash
        zipSha256 = $archiveHash
        memberCount = $actualMembersSorted.Count
        members = $actualMembersSorted
        status = $RunStatus
        checks = @('zip-readable', 'member-set-exact', 'manifest-hash', 'member-size', 'member-sha256', 'tested-source-hash')
        sourceFileCount = $sourceFiles.Count
        validatedAt = (Get-Date).ToString('s')
    }
    $validationJson = $validation | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText($validationPath, "$validationJson`n", [Text.UTF8Encoding]::new($false))
    $archiveReceipt = [ordered]@{
        runId = $TestRunId
        archivePath = $ArchivePath
        archiveSha256 = $archiveHash
        manifestPath = $manifestPath
        manifestSha256 = $manifestHash
        validationPath = $validationPath
        memberCount = $validation.memberCount
        status = $RunStatus
        validatedAt = (Get-Date).ToString('s')
    }
    $archiveReceiptPath = "$ArchivePath.sha256.json"
    $archiveReceiptJson = $archiveReceipt | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($archiveReceiptPath, "$archiveReceiptJson`n", [Text.UTF8Encoding]::new($false))
    return [pscustomobject]$archiveReceipt
}

function Invoke-FourAgentReasoningIntegrationProject {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$OutputDirectory)

    $selected = @{
        claude = $script:SelectedClaudeExecutable
        codex = $script:SelectedCodexExecutable
        grok = $script:SelectedGrokExecutable
        cline = $script:SelectedClineExecutable
    }
    foreach ($entry in $selected.GetEnumerator()) { Assert-FourAgentExecutable -Name "$($entry.Key)Executable" -Path ([string]$entry.Value) }
    $artifactRoot = Join-Path $resultRoot 'four-agent-reasoning'
    $archivePath = Join-Path $resultRoot 'four-agent-reasoning-review.zip'
    $runStartedAt = (Get-Date).ToString('s')
    [IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
    [IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
    $gitHead = (& git -C $repo rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve the git head for the four-agent integration.' }
    $environment = @{
        FRENEMY_FOUR_AGENT_RUN_ID = $TestRunId
        FRENEMY_FOUR_AGENT_RESULT_ROOT = $artifactRoot
        FRENEMY_CLAUDE_EXECUTABLE = [IO.Path]::GetFullPath($selected.claude)
        FRENEMY_CODEX_EXECUTABLE = [IO.Path]::GetFullPath($selected.codex)
        FRENEMY_GROK_EXECUTABLE = [IO.Path]::GetFullPath($selected.grok)
        FRENEMY_CLINE_EXECUTABLE = [IO.Path]::GetFullPath($selected.cline)
        FRENEMY_GIT_HEAD = $gitHead
    }
    $testStem = [IO.Path]::GetFileNameWithoutExtension((Join-Path $repo 'tests/integration/four-agent-reasoning.integration.test.mjs'))
    $junitPath = Join-Path $OutputDirectory "Frenemy.Relay.IntegrationTests.$testStem.node.junit.xml"
    $trxPath = Join-Path $OutputDirectory 'Frenemy.Relay.IntegrationTests.trx'
    $nodeFailure = $null
    $reportFailure = $null
    $postFailure = $null
    try {
        $node = (Get-Command node -ErrorAction Stop).Source
        & $node --check (Join-Path $repo 'tests/integration/four-agent-reasoning.integration.test.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Four-agent integration JavaScript syntax validation failed.' }
        & $node --check (Join-Path $repo 'tests/integration/four-agent-reasoning.archive.test.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Four-agent archive integration JavaScript syntax validation failed.' }
        $null = Invoke-NodeTestProject -Project 'Frenemy.Relay.IntegrationTests' -TestFile (Join-Path $repo 'tests/integration/four-agent-reasoning.integration.test.mjs') -OutputDirectory $OutputDirectory -TestNamePattern 'FourAgentReasoningIntegrationTests' -Environment $environment
    }
    catch {
        $nodeFailure = $_
        $failure = [ordered]@{ runId=$TestRunId; stage='node-integration'; message=$_.Exception.Message; timestamp=(Get-Date).ToString('s') }
        $failureJson = $failure | ConvertTo-Json -Depth 6
        [IO.File]::WriteAllText((Join-Path $artifactRoot 'run-failure.json'), "$failureJson`n", [Text.UTF8Encoding]::new($false))
    }
    finally {
        try {
            $reports = Join-Path $artifactRoot 'reports'
            [IO.Directory]::CreateDirectory($reports) | Out-Null
            if (Test-Path -LiteralPath $junitPath) {
                try {
                    & $converter -InputPath @($junitPath) -OutputPath $trxPath -RunName 'Frenemy.Relay.IntegrationTests' | Write-Output
                }
                catch {
                    $reportFailure = $_
                }
                finally {
                    $timingPath = "$junitPath.timing.json"
                    Copy-Item -LiteralPath $junitPath -Destination (Join-Path $reports 'four-agent.node.junit.xml') -Force
                    if (Test-Path -LiteralPath $timingPath) { Copy-Item -LiteralPath $timingPath -Destination (Join-Path $reports 'four-agent.node.junit.xml.timing.json') -Force }
                    if (Test-Path -LiteralPath $trxPath) { Copy-Item -LiteralPath $trxPath -Destination (Join-Path $reports 'Frenemy.Relay.IntegrationTests.trx') -Force }
                }
            }
            $runStatus = if ($nodeFailure) { 'failed' } else { 'passed' }
            $archiveReceipt = Complete-FourAgentReasoningArchive -ArtifactRoot $artifactRoot -ArchivePath $archivePath -SelectedExecutables $selected -RunStartedAt $runStartedAt -RunStatus $runStatus
            $archiveEnvironment = @{
                FRENEMY_FOUR_AGENT_RESULT_ROOT = $artifactRoot
                FRENEMY_FOUR_AGENT_ARCHIVE_PATH = $archivePath
                FRENEMY_FOUR_AGENT_VALIDATION_PATH = [string]$archiveReceipt.validationPath
                FRENEMY_REPO_ROOT = $repo
            }
            $archiveJunit = Invoke-NodeTestProject -Project 'Frenemy.Relay.ArchiveIntegrationTests' -TestFile (Join-Path $repo 'tests/integration/four-agent-reasoning.archive.test.mjs') -OutputDirectory $OutputDirectory -TestNamePattern 'FourAgentReasoningArchiveIntegrationTests' -Environment $archiveEnvironment
            $archiveTrx = Join-Path $OutputDirectory 'Frenemy.Relay.ArchiveIntegrationTests.trx'
            & $converter -InputPath @($archiveJunit) -OutputPath $archiveTrx -RunName 'Frenemy.Relay.ArchiveIntegrationTests' | Write-Output
            $archiveReceipt | ConvertTo-Json -Depth 8 | Write-Output
        }
        catch {
            $postFailure = $_
        }
    }
    if ($nodeFailure) { throw $nodeFailure }
    if ($reportFailure) { throw $reportFailure }
    if ($postFailure) { throw $postFailure }
}

switch ($Target) {
    'VerifyMocks' {
        Invoke-UnitProject -OutputDirectory (Join-Path $resultRoot 'verify-mocks/Frenemy.Relay.UnitTests')
    }
    'VerifyFourAgentReasoningMocks' {
        Invoke-UnitProject -OutputDirectory (Join-Path $resultRoot 'verify-four-agent-mocks/Frenemy.Relay.UnitTests') -Classes @('FourAgentReasoningMockTests')
    }
    'TestUnitRelay' {
        Invoke-UnitProject -OutputDirectory (Join-Path $resultRoot 'unit/Frenemy.Relay.UnitTests')
    }
    'NativeQualification' { Invoke-NativeQualificationProject -OutputDirectory (Join-Path $resultRoot 'native/Frenemy.Relay.NativeQualification') }
    'TestIntegrationRelay' { Invoke-IntegrationProject -OutputDirectory (Join-Path $resultRoot 'integration/Frenemy.Relay.IntegrationTests') }
    'FourAgentReasoningIntegration' { Invoke-FourAgentReasoningIntegrationProject -OutputDirectory (Join-Path $resultRoot 'four-agent-integration/Frenemy.Relay.IntegrationTests') }
    'Validate' {
        Invoke-UnitProject -OutputDirectory (Join-Path $resultRoot 'unit/Frenemy.Relay.UnitTests')
        Invoke-IntegrationProject -OutputDirectory (Join-Path $resultRoot 'integration/Frenemy.Relay.IntegrationTests')
        Invoke-NativeQualificationProject -OutputDirectory (Join-Path $resultRoot 'native/Frenemy.Relay.NativeQualification')
    }
    'TestGroups' {
        if ($TestGroups.Count -eq 0) { throw 'TestGroups requires at least one project:Class selection.' }
        $classesByProject = @{}
        foreach ($selection in $TestGroups) {
            $separator = $selection.IndexOf(':')
            if ($separator -lt 1 -or $separator -eq $selection.Length - 1) { throw "Invalid test group '$selection'." }
            $project = $selection.Substring(0, $separator)
            if ($project -notin @('Frenemy.Relay.UnitTests', 'Frenemy.Relay.IntegrationTests', 'Frenemy.Relay.NativeQualification')) { throw "Unknown test project '$project'." }
            $classes = @($selection.Substring($separator + 1).Split(',') | ForEach-Object { $_.Trim() })
            if ($classes.Count -eq 0 -or @($classes | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) { throw "Invalid test group '$selection'." }
            $known = switch ($project) {
                'Frenemy.Relay.UnitTests' { @('RelayContractMockTests', 'FourAgentReasoningMockTests', 'ProtectGrokPromptTests') }
                'Frenemy.Relay.IntegrationTests' { @('RelayContractIntegrationTests', 'FourAgentReasoningIntegrationTests') }
                default {
                    @(
                        'NativeQualificationTestsQ01',
                        'NativeQualificationTestsQ02',
                        'NativeProductionQualificationTestsQ01',
                        'NativeProductionQualificationTestsQ02',
                        'ProtectGrokPromptIntegrationTests'
                    )
                }
            }
            foreach ($class in $classes) { if ($class -notin $known) { throw "Unknown test class '$class'." } }
            if (-not $classesByProject.ContainsKey($project)) { $classesByProject[$project] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal) }
            foreach ($class in $classes) { [void]$classesByProject[$project].Add($class) }
        }
        foreach ($project in $classesByProject.Keys) {
            switch ($project) {
                'Frenemy.Relay.UnitTests' {
                    Invoke-UnitProject -OutputDirectory (Join-Path $resultRoot "groups/$project") -Classes @($classesByProject[$project])
                }
                'Frenemy.Relay.IntegrationTests' {
                    $integrationClasses = @($classesByProject[$project])
                    if ($integrationClasses -contains 'FourAgentReasoningIntegrationTests') {
                        if ($integrationClasses.Count -ne 1) { throw 'FourAgentReasoningIntegrationTests must be selected alone.' }
                        Invoke-FourAgentReasoningIntegrationProject -OutputDirectory (Join-Path $resultRoot "groups/$project")
                    }
                    else {
                        Invoke-IntegrationProject -OutputDirectory (Join-Path $resultRoot "groups/$project") -Classes $integrationClasses
                    }
                }
                default {
                    Invoke-NativeQualificationProject -OutputDirectory (Join-Path $resultRoot "groups/$project") -Classes @($classesByProject[$project])
                }
            }
        }
    }
}
