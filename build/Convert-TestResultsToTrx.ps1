<#
.SYNOPSIS
Converts retained JUnit or NUnit XML results into one truthful TRX file.

.DESCRIPTION
Reads every test case from the supplied result files, preserves pass, fail,
and skipped outcomes, and writes a Visual Studio TRX result for the named test
project. Each input must have a sibling .timing.json receipt containing the
measured process start and finish. The converter never changes a test outcome
or substitute conversion time for execution time.

.PARAMETER InputPath
JUnit or NUnit XML result files.

.PARAMETER OutputPath
Destination TRX path.

.PARAMETER RunName
Name recorded for the test run.

.NOTES
Change log:
- 2026-11-06, TEST-FRENEMY-114 and TEST-FRENEMY-115, AC-TEST-FRENEMY-115-06:
  Added retained TRX generation for the separate Node and Pester projects.
- 2026-11-07, TEST-FRENEMY-117, AC-TEST-FRENEMY-117-07 and
  AC-TEST-FRENEMY-117-08: Bound TRX timestamps to measured source-test process
  timing receipts instead of the later conversion time.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string[]]$InputPath,

    [Parameter(Mandatory)]
    [string]$OutputPath,

    [Parameter(Mandatory)]
    [string]$RunName
)

$ErrorActionPreference = 'Stop'
$tests = [System.Collections.Generic.List[object]]::new()

foreach ($path in $InputPath) {
    $timingPath = "$path.timing.json"
    if (-not (Test-Path -LiteralPath $timingPath -PathType Leaf)) { throw "Measured timing receipt is missing: $timingPath" }
    $timing = [IO.File]::ReadAllText($timingPath) | ConvertFrom-Json -DateKind String
    $runStartedAt = [DateTimeOffset]::Parse([string]$timing.startedAt, [Globalization.CultureInfo]::InvariantCulture)
    $runFinishedAt = [DateTimeOffset]::Parse([string]$timing.finishedAt, [Globalization.CultureInfo]::InvariantCulture)
    if ($runFinishedAt -lt $runStartedAt) { throw "Measured timing receipt finishes before it starts: $timingPath" }
    [xml]$document = Get-Content -LiteralPath $path -Raw
    $junitCases = @($document.SelectNodes('//*[local-name()="testcase"]'))
    foreach ($case in $junitCases) {
        $outcome = if ($case.failure -or $case.error) { 'Failed' } elseif ($case.skipped) { 'NotExecuted' } else { 'Passed' }
        $message = if ($case.failure) { [string]$case.failure.message } elseif ($case.error) { [string]$case.error.message } else { '' }
        $seconds = if ($case.time) { [double]::Parse([string]$case.time, [Globalization.CultureInfo]::InvariantCulture) } else { 0.0 }
        $tests.Add([pscustomobject]@{
            Name = [string]$case.name
            ClassName = if ($case.classname) { [string]$case.classname } else { $RunName }
            Outcome = $outcome
            Message = $message
            Duration = [TimeSpan]::FromSeconds($seconds)
            RunStartedAt = $runStartedAt
            RunFinishedAt = $runFinishedAt
        })
    }

    if ($junitCases.Count -eq 0) {
        foreach ($case in @($document.SelectNodes('//*[local-name()="test-case"]'))) {
            $result = [string]$case.result
            $outcome = if ($result -in @('Success', 'Passed')) { 'Passed' } elseif ($result -in @('Ignored', 'Skipped', 'Inconclusive')) { 'NotExecuted' } else { 'Failed' }
            $messageNode = $case.SelectSingleNode('./*[local-name()="failure"]/*[local-name()="message"]')
            $seconds = if ($case.time) { [double]::Parse([string]$case.time, [Globalization.CultureInfo]::InvariantCulture) } else { 0.0 }
            $tests.Add([pscustomobject]@{
                Name = [string]$case.name
                ClassName = if ($case.classname) { [string]$case.classname } else { $RunName }
                Outcome = $outcome
                Message = if ($messageNode) { [string]$messageNode.InnerText } else { '' }
                Duration = [TimeSpan]::FromSeconds($seconds)
                RunStartedAt = $runStartedAt
                RunFinishedAt = $runFinishedAt
            })
        }
    }
}

if ($tests.Count -eq 0) {
    throw 'No test cases were found in the supplied result files.'
}

$namespace = 'http://microsoft.com/schemas/VisualStudio/TeamTest/2010'
$runId = [guid]::NewGuid()
$testListId = [guid]'19431567-8539-422a-85d7-44ee4e166bda'
$firstStart = ($tests | Sort-Object RunStartedAt | Select-Object -First 1).RunStartedAt
$lastFinish = ($tests | Sort-Object RunFinishedAt -Descending | Select-Object -First 1).RunFinishedAt
$settingsId = [guid]::NewGuid()
$xml = [Xml.XmlDocument]::new()
$run = $xml.CreateElement('TestRun', $namespace)
$run.SetAttribute('id', $runId.ToString())
$run.SetAttribute('name', $RunName)
$run.SetAttribute('runUser', [Environment]::UserName)
[void]$xml.AppendChild($run)

$times = $xml.CreateElement('Times', $namespace)
$times.SetAttribute('creation', $firstStart.ToString('o'))
$times.SetAttribute('queuing', $firstStart.ToString('o'))
$times.SetAttribute('start', $firstStart.ToString('o'))
$times.SetAttribute('finish', $lastFinish.ToString('o'))
[void]$run.AppendChild($times)

$settings = $xml.CreateElement('TestSettings', $namespace)
$settings.SetAttribute('name', 'default')
$settings.SetAttribute('id', $settingsId.ToString())
[void]$run.AppendChild($settings)

$results = $xml.CreateElement('Results', $namespace)
$definitions = $xml.CreateElement('TestDefinitions', $namespace)
$entries = $xml.CreateElement('TestEntries', $namespace)
[void]$run.AppendChild($results)
[void]$run.AppendChild($definitions)
[void]$run.AppendChild($entries)

foreach ($test in $tests) {
    $testId = [guid]::NewGuid()
    $executionId = [guid]::NewGuid()
    $result = $xml.CreateElement('UnitTestResult', $namespace)
    $result.SetAttribute('executionId', $executionId.ToString())
    $result.SetAttribute('testId', $testId.ToString())
    $result.SetAttribute('testName', $test.Name)
    $result.SetAttribute('computerName', [Environment]::MachineName)
    $result.SetAttribute('duration', $test.Duration.ToString('c'))
    $result.SetAttribute('startTime', $test.RunStartedAt.ToString('o'))
    $result.SetAttribute('endTime', $test.RunFinishedAt.ToString('o'))
    $result.SetAttribute('testType', '13cdc9d9-ddb5-4fa4-a97d-d965ccfc6d4b')
    $result.SetAttribute('outcome', $test.Outcome)
    $result.SetAttribute('testListId', $testListId.ToString())
    if ($test.Message) {
        $output = $xml.CreateElement('Output', $namespace)
        $errorInfo = $xml.CreateElement('ErrorInfo', $namespace)
        $message = $xml.CreateElement('Message', $namespace)
        $message.InnerText = $test.Message
        [void]$errorInfo.AppendChild($message)
        [void]$output.AppendChild($errorInfo)
        [void]$result.AppendChild($output)
    }
    [void]$results.AppendChild($result)

    $definition = $xml.CreateElement('UnitTest', $namespace)
    $definition.SetAttribute('name', $test.Name)
    $definition.SetAttribute('storage', $RunName)
    $definition.SetAttribute('id', $testId.ToString())
    $execution = $xml.CreateElement('Execution', $namespace)
    $execution.SetAttribute('id', $executionId.ToString())
    $method = $xml.CreateElement('TestMethod', $namespace)
    $method.SetAttribute('codeBase', $RunName)
    $method.SetAttribute('adapterTypeName', 'Frenemy.ContractAdapter')
    $method.SetAttribute('className', $test.ClassName)
    $method.SetAttribute('name', $test.Name)
    [void]$definition.AppendChild($execution)
    [void]$definition.AppendChild($method)
    [void]$definitions.AppendChild($definition)

    $entry = $xml.CreateElement('TestEntry', $namespace)
    $entry.SetAttribute('testId', $testId.ToString())
    $entry.SetAttribute('executionId', $executionId.ToString())
    $entry.SetAttribute('testListId', $testListId.ToString())
    [void]$entries.AppendChild($entry)
}

$lists = $xml.CreateElement('TestLists', $namespace)
$list = $xml.CreateElement('TestList', $namespace)
$list.SetAttribute('name', 'Results Not in a List')
$list.SetAttribute('id', $testListId.ToString())
[void]$lists.AppendChild($list)
[void]$run.AppendChild($lists)

$passed = @($tests | Where-Object Outcome -eq 'Passed').Count
$failed = @($tests | Where-Object Outcome -eq 'Failed').Count
$notExecuted = @($tests | Where-Object Outcome -eq 'NotExecuted').Count
$summary = $xml.CreateElement('ResultSummary', $namespace)
$summaryOutcome = if ($failed -gt 0) { 'Failed' } elseif ($notExecuted -gt 0) { 'NotExecuted' } else { 'Completed' }
$summary.SetAttribute('outcome', $summaryOutcome)
$counters = $xml.CreateElement('Counters', $namespace)
$counterValues = [ordered]@{ total=$tests.Count; executed=$passed+$failed; passed=$passed; failed=$failed; error=0; timeout=0; aborted=0; inconclusive=0; passedButRunAborted=0; notRunnable=0; notExecuted=$notExecuted; disconnected=0; warning=0; completed=$tests.Count; inProgress=0; pending=0 }
foreach ($pair in $counterValues.GetEnumerator()) {
    $counters.SetAttribute($pair.Key, [string]$pair.Value)
}
[void]$summary.AppendChild($counters)
[void]$run.AppendChild($summary)

$directory = Split-Path -Parent $OutputPath
[IO.Directory]::CreateDirectory($directory) | Out-Null
$writerSettings = [Xml.XmlWriterSettings]@{ Indent = $true; Encoding = [Text.UTF8Encoding]::new($false) }
$writer = [Xml.XmlWriter]::Create($OutputPath, $writerSettings)
try { $xml.Save($writer) } finally { $writer.Dispose() }

[pscustomobject]@{ Total=$tests.Count; Passed=$passed; Failed=$failed; Skipped=$notExecuted; OutputPath=$OutputPath }
