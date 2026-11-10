#Requires -Version 7.4

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $TargetDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module PSScriptAnalyzer -ErrorAction Stop

$scripts = @(Get-ChildItem -LiteralPath $TargetDirectory -File -Filter '*.ps1' | Sort-Object Name)
$results = foreach ($script in $scripts) {
    $tokens = $null
    $parserErrors = $null
    [void] [Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref] $tokens, [ref] $parserErrors)
    $analyzerFindings = @(Invoke-ScriptAnalyzer -Path $script.FullName -Severity Warning, Error)
    [ordered]@{
        name = $script.Name
        parserErrorCount = @($parserErrors).Count
        analyzerFindingCount = $analyzerFindings.Count
    }
}

$receipt = [ordered]@{
    createdAtLocal = Get-Date -Format s
    psscriptAnalyzerVersion = (Get-Module PSScriptAnalyzer).Version.ToString()
    scriptCount = $results.Count
    parserErrorCount = @($results | Where-Object { $_.parserErrorCount -ne 0 }).Count
    analyzerFindingCount = @($results | Where-Object { $_.analyzerFindingCount -ne 0 }).Count
    scripts = @($results)
}
$receipt | ConvertTo-Json -Depth 6
if ($receipt.parserErrorCount -ne 0 -or $receipt.analyzerFindingCount -ne 0) { exit 1 }
