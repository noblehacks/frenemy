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
    [datetimeoffset] $EndUtc
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($EndUtc -le $StartUtc) {
    throw 'EndUtc must be later than StartUtc.'
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
                    $record = $line | ConvertFrom-Json
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
            finally {
                $writer.Dispose()
            }
        }
        finally {
            $destination.Dispose()
        }
    }
    finally {
        $reader.Dispose()
    }
}
finally {
    $source.Dispose()
}

$manifest = [ordered]@{
    createdAtLocal = Get-Date -Format s
    sourcePath = $SourcePath
    sourceSessionId = '01a1a79a-c917-78d2-9c56-74a811b3bc8a'
    sourceThread = 'parent implementer chat'
    redacted = $false
    startUtc = $StartUtc.ToString('o')
    endUtc = $EndUtc.ToString('o')
    lineCount = $written
    bytes = (Get-Item -LiteralPath $DestinationPath).Length
    sha256 = (Get-FileHash -LiteralPath $DestinationPath -Algorithm SHA256).Hash
}
$manifest | ConvertTo-Json -Depth 4 | Out-File -LiteralPath $ManifestPath -Encoding utf8
$manifest | ConvertTo-Json -Depth 4
