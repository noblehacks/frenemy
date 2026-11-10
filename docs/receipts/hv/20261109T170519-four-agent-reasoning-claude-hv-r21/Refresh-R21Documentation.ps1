#Requires -Version 7.4

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string] $WorkspacePath,

    [Parameter(Mandatory)]
    [string] $BackupZipPath,

    [Parameter(Mandatory)]
    [string] $GeneratedZipPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspace = (Resolve-Path -LiteralPath $WorkspacePath).Path
$wikiRoot = Join-Path $workspace 'docs/Project/wiki'
$zipPath = Join-Path $workspace 'docs/requirements/requirements-wiki-documents.zip'
$projections = @(
    [pscustomobject]@{
        Source = Join-Path $workspace 'docs/plans/four-agent-reasoning-integration.md'
        Targets = @(
            Join-Path $wikiRoot 'azure/Four-Agent-Reasoning-Integration-Test.md'
            Join-Path $wikiRoot 'github/Four-Agent-Reasoning-Integration-Test.md'
        )
    }
    [pscustomobject]@{
        Source = Join-Path $workspace 'docs/testing/validation.md'
        Targets = @(
            Join-Path $wikiRoot 'azure/Validation-Status.md'
            Join-Path $wikiRoot 'github/Validation-Status.md'
        )
    }
)

$wikiFiles = @(Get-ChildItem -LiteralPath $wikiRoot -Recurse -Force -File | Sort-Object FullName)
if ($wikiFiles.Count -ne 39) {
    throw "Expected 39 wiki files, found $($wikiFiles.Count)."
}

if (-not $PSCmdlet.ShouldProcess($wikiRoot, 'Refresh the four plan and validation projections and package all wiki files')) {
    [pscustomobject]@{
        disposition = 'WhatIf'
        wikiFileCount = $wikiFiles.Count
        projectionCount = 4
        zipPath = $zipPath
        backupZipPath = $BackupZipPath
        generatedZipPath = $GeneratedZipPath
    }
    return
}

if (Test-Path -LiteralPath $BackupZipPath) {
    throw "Backup ZIP already exists: $BackupZipPath"
}
if (Test-Path -LiteralPath $GeneratedZipPath) {
    throw "Generated ZIP already exists: $GeneratedZipPath"
}

$originalZipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
Copy-Item -LiteralPath $zipPath -Destination $BackupZipPath
$backupZipHash = (Get-FileHash -LiteralPath $BackupZipPath -Algorithm SHA256).Hash
if ($backupZipHash -ne $originalZipHash) {
    throw 'The retained ZIP backup does not match the original ZIP.'
}

foreach ($projection in $projections) {
    foreach ($target in $projection.Targets) {
        Copy-Item -LiteralPath $projection.Source -Destination $target -Force
        $sourceHash = (Get-FileHash -LiteralPath $projection.Source -Algorithm SHA256).Hash
        $targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
        if ($sourceHash -ne $targetHash) {
            throw "Projection hash mismatch: $target"
        }
    }
}

Add-Type -AssemblyName System.IO.Compression
$generatedStream = [IO.FileStream]::new($GeneratedZipPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    $archive = [IO.Compression.ZipArchive]::new($generatedStream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($file in $wikiFiles) {
            $relative = [IO.Path]::GetRelativePath($wikiRoot, $file.FullName).Replace('\', '/')
            $entry = $archive.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [DateTimeOffset]::new($file.LastWriteTimeUtc)
            $entryStream = $entry.Open()
            try {
                $sourceStream = $file.OpenRead()
                try {
                    $sourceStream.CopyTo($entryStream)
                }
                finally {
                    $sourceStream.Dispose()
                }
            }
            finally {
                $entryStream.Dispose()
            }
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    $generatedStream.Dispose()
}

$readStream = [IO.File]::OpenRead($GeneratedZipPath)
try {
    $archive = [IO.Compression.ZipArchive]::new($readStream, [IO.Compression.ZipArchiveMode]::Read, $false)
    try {
        if ($archive.Entries.Count -ne $wikiFiles.Count) {
            throw "ZIP entry count mismatch: expected $($wikiFiles.Count), found $($archive.Entries.Count)."
        }

        $mismatches = [Collections.Generic.List[string]]::new()
        foreach ($entry in $archive.Entries) {
            $filePath = Join-Path $wikiRoot $entry.FullName
            if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
                $mismatches.Add("missing:$($entry.FullName)")
                continue
            }

            $entryStream = $entry.Open()
            try {
                $memory = [IO.MemoryStream]::new()
                try {
                    $entryStream.CopyTo($memory)
                    $entryHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($memory.ToArray()))
                }
                finally {
                    $memory.Dispose()
                }
            }
            finally {
                $entryStream.Dispose()
            }

            $fileHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
            if ($entryHash -ne $fileHash) {
                $mismatches.Add("hash:$($entry.FullName)")
            }
        }

        if ($mismatches.Count -ne 0) {
            throw "ZIP validation failed: $($mismatches -join ', ')"
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    $readStream.Dispose()
}

Copy-Item -LiteralPath $GeneratedZipPath -Destination $zipPath -Force
$generatedZipHash = (Get-FileHash -LiteralPath $GeneratedZipPath -Algorithm SHA256).Hash
$installedZipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
if ($generatedZipHash -ne $installedZipHash) {
    throw 'The installed ZIP does not match the retained generated ZIP.'
}

[pscustomobject]@{
    completedAtLocal = Get-Date -Format s
    exportMode = 'local-projection-and-package-after-supported-export-timeout'
    wikiFileCount = $wikiFiles.Count
    projectionCount = 4
    mismatchCount = 0
    originalZipSha256 = $originalZipHash
    backupZipPath = $BackupZipPath
    backupZipSha256 = $backupZipHash
    generatedZipPath = $GeneratedZipPath
    generatedZipSha256 = $generatedZipHash
    installedZipPath = $zipPath
    installedZipSha256 = $installedZipHash
}
