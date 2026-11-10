#Requires -Version 7.4

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string] $SourcePath,

    [Parameter(Mandatory)]
    [string] $DestinationPath,

    [Parameter(Mandatory)]
    [string] $ManifestPath,

    [Parameter(Mandatory)]
    [datetimeoffset] $StartUtc,

    [Parameter(Mandatory)]
    [datetimeoffset] $EndUtc,

    [Parameter(Mandatory)]
    [string] $PreviousManifestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($EndUtc -le $StartUtc) {
    throw 'EndUtc must be later than StartUtc.'
}

if (-not (Test-Path -LiteralPath $PreviousManifestPath -PathType Leaf)) {
    throw "Previous manifest not found: $PreviousManifestPath"
}

$previousManifest = [IO.File]::ReadAllText($PreviousManifestPath) | ConvertFrom-Json -DateKind String
$previousEndUtc = [datetimeoffset]::Parse([string] $previousManifest.endUtc, [Globalization.CultureInfo]::InvariantCulture)
if ($previousEndUtc -ne $StartUtc) {
    throw "Chat interval is not contiguous: previous endUtc $($previousEndUtc.ToString('o')) does not equal startUtc $($StartUtc.ToString('o'))."
}

if ($previousManifest.sourcePath -and ([IO.Path]::GetFullPath([string] $previousManifest.sourcePath) -ne [IO.Path]::GetFullPath($SourcePath))) {
    throw 'Previous manifest and current export do not reference the same source rollout.'
}

if (-not $PSCmdlet.ShouldProcess($DestinationPath, 'Copy the unredacted parent rollout segment')) {
    return
}

$source = [IO.FileStream]::new($SourcePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
try {
    $reader = [IO.StreamReader]::new($source, [Text.UTF8Encoding]::new($false), $true, 1MB, $true)
    try {
        $destination = [IO.FileStream]::new($DestinationPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $writer = [IO.StreamWriter]::new($destination, [Text.UTF8Encoding]::new($false), 1MB, $true)
            try {
                $lineNumber = 0
                $written = 0
                while ($null -ne ($line = $reader.ReadLine())) {
                    $lineNumber++
                    $record = $line | ConvertFrom-Json -DateKind String
                    $include = $lineNumber -eq 1
                    if (-not $include -and $record.timestamp) {
                        $timestamp = [datetimeoffset]::Parse([string] $record.timestamp, [Globalization.CultureInfo]::InvariantCulture)
                        $include = $timestamp -ge $StartUtc -and $timestamp -le $EndUtc
                    }
                    if ($include) {
                        $writer.WriteLine($line)
                        $written++
                    }
                }
                $writer.Flush()
            }
            finally { $writer.Dispose() }
        }
        finally { $destination.Dispose() }
    }
    finally { $reader.Dispose() }
}
finally { $source.Dispose() }

$verifySource = [IO.FileStream]::new($DestinationPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    $verifyReader = [IO.StreamReader]::new($verifySource, [Text.UTF8Encoding]::new($false), $true, 1MB, $true)
    try {
        $verifyLineNumber = 0
        $windowRecordCount = 0
        $firstRecordUtc = $null
        $lastRecordUtc = $null
        while ($null -ne ($line = $verifyReader.ReadLine())) {
            $verifyLineNumber++
            if ($verifyLineNumber -eq 1) { continue }
            $record = $line | ConvertFrom-Json -DateKind String
            if (-not $record.timestamp) { continue }
            $timestamp = [datetimeoffset]::Parse([string] $record.timestamp, [Globalization.CultureInfo]::InvariantCulture)
            if ($timestamp -lt $StartUtc -or $timestamp -gt $EndUtc) {
                throw "Retained record timestamp $($timestamp.ToString('o')) falls outside the declared UTC window."
            }
            if ($null -eq $firstRecordUtc) { $firstRecordUtc = $timestamp }
            $lastRecordUtc = $timestamp
            $windowRecordCount++
        }
    }
    finally { $verifyReader.Dispose() }
}
finally { $verifySource.Dispose() }

if ($windowRecordCount -eq 0) { throw 'The export contains no timestamped records in the declared UTC window.' }

$manifest = [ordered]@{
    createdAtLocal = Get-Date -Format s
    sourcePath = $SourcePath
    sourceSessionId = '01a1a79a-c917-78d2-9c56-74a811b3bc8a'
    sourceThread = 'parent implementer chat'
    redacted = $false
    headerRecord = 'line 1 session_meta provenance header; excluded from timestamp-window counts'
    previousManifestPath = $PreviousManifestPath
    previousManifestSha256 = (Get-FileHash -LiteralPath $PreviousManifestPath -Algorithm SHA256).Hash
    previousEndUtc = $previousEndUtc.ToString('o')
    contiguousWithPrevious = $true
    startUtc = $StartUtc.ToString('o')
    endUtc = $EndUtc.ToString('o')
    firstRecordUtc = $firstRecordUtc.ToString('o')
    lastRecordUtc = $lastRecordUtc.ToString('o')
    windowRecordCount = $windowRecordCount
    lineCount = $written
    bytes = (Get-Item -LiteralPath $DestinationPath).Length
    sha256 = (Get-FileHash -LiteralPath $DestinationPath -Algorithm SHA256).Hash
}
Add-LinesToFile -LiteralPath $ManifestPath -Content ($manifest | ConvertTo-Json -Depth 4)
$manifest | ConvertTo-Json -Depth 4
