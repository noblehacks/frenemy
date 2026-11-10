#Requires -Version 7.4

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string] $WorkspacePath,
    [Parameter(Mandatory)]
    [string[]] $RelativeSources,
    [Parameter(Mandatory)]
    [string] $ReceiptPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path -LiteralPath $WorkspacePath).Path
$markerText = [IO.File]::ReadAllText((Join-Path $workspaceRoot 'AGENTS-README-FIRST.yaml'))
$apiKeyMatch = [regex]::Match($markerText, '(?m)^apiKey:\s*(\S+)\s*$')
if (-not $apiKeyMatch.Success) { throw 'The workspace marker API key could not be located.' }
$apiKey = $apiKeyMatch.Groups[1].Value
$replacement = '[REDACTED_WORKSPACE_API_KEY]'

$results = foreach ($relativeSource in $RelativeSources) {
    $sourcePath = Join-Path $workspaceRoot $relativeSource
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Required reviewer artifact is missing: $relativeSource" }
    $sourceItem = Get-Item -LiteralPath $sourcePath
    $destinationName = '{0}.public-credential-safe{1}' -f $sourceItem.BaseName, $sourceItem.Extension
    $destinationPath = Join-Path $sourceItem.DirectoryName $destinationName
    if (Test-Path -LiteralPath $destinationPath) { throw "Credential-safe destination already exists: $destinationPath" }
    $sourceText = [IO.File]::ReadAllText($sourcePath)
    $sourceCount = ([regex]::Matches($sourceText, [regex]::Escape($apiKey))).Count
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash

    if ($PSCmdlet.ShouldProcess($destinationPath, "Create credential-safe copy of $relativeSource")) {
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
        if ($sourceCount -gt 0) { Update-MatchInFile -LiteralPath $destinationPath -OldText $apiKey -Replacement $replacement | Out-Null }
        $destinationText = [IO.File]::ReadAllText($destinationPath)
        $remaining = ([regex]::Matches($destinationText, [regex]::Escape($apiKey))).Count
        if ($remaining -ne 0) { throw "Credential-safe copy still contains the workspace API key: $destinationPath" }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash -ne $sourceHash) { throw "Original reviewer artifact changed: $sourcePath" }
        [pscustomobject]@{
            sourcePath = $relativeSource
            sourceSha256 = $sourceHash
            sourceOccurrenceCount = $sourceCount
            publicPath = [IO.Path]::GetRelativePath($workspaceRoot, $destinationPath).Replace('\', '/')
            publicSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $destinationPath).Hash
            remainingSecretCount = $remaining
        }
    }
    else {
        [pscustomobject]@{ sourcePath = $relativeSource; sourceSha256 = $sourceHash; sourceOccurrenceCount = $sourceCount; disposition = 'WhatIf' }
    }
}

if (-not $WhatIfPreference) {
    $receipt = [ordered]@{
        createdAtLocal = Get-Date -Format s
        purpose = 'Additional credential-safe public copies. Originals remain unmodified and are the full unredacted HV evidence.'
        reviewerEvidenceRedacted = $false
        files = @($results)
    }
    Add-LinesToFile -LiteralPath $ReceiptPath -Content ($receipt | ConvertTo-Json -Depth 10)
}
$results
