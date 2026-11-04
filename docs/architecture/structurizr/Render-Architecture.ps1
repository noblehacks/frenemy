[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ToolDirectory = (Join-Path $PSScriptRoot '../../../cache/architecture-tools'),
    [string]$JavaPath
)
$ErrorActionPreference = 'Stop'
$pins = Get-Content (Join-Path $PSScriptRoot 'tool-pins.json') -Raw | ConvertFrom-Json
if (-not $JavaPath) { $JavaPath = Join-Path $ToolDirectory $pins.java.relativeExecutable }
foreach ($tool in @($pins.structurizr, $pins.plantuml)) {
    $path = Join-Path $ToolDirectory $tool.file
    if ((Get-FileHash $path -Algorithm SHA256).Hash -ne $tool.sha256) { throw "Tool hash mismatch: $path" }
}
if (-not $PSCmdlet.ShouldProcess($PSScriptRoot, 'Validate and render architecture; replace generated exports and receipts')) { return }
function Set-ArtifactText {
    [CmdletBinding(SupportsShouldProcess)]
    param([string]$Path, [string]$Text)
    if (-not $PSCmdlet.ShouldProcess($Path, 'Write generated architecture artifact')) { return }
    if (Test-Path -LiteralPath $Path) {
        $prior = Get-Content -LiteralPath $Path -Raw
        Update-MatchInFile -LiteralPath $Path -OldText $prior -Replacement $Text | Out-Null
    } else {
        Add-LinesToFile -LiteralPath $Path -Content $Text | Out-Null
    }
}
# The generated directories are wholly owned by this renderer. The previous scope draft is retained in docs/receipts/scope.
foreach ($generated in @('model','site','exports')) {
    $targetPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $generated))
    $boundary = [IO.Path]::GetFullPath($PSScriptRoot) + [IO.Path]::DirectorySeparatorChar
    if (-not $targetPath.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'Generated output escaped architecture root' }
    if (Test-Path -LiteralPath $targetPath) { Remove-Item -LiteralPath $targetPath -Recurse -Force }
}
$javaArchive = Join-Path $ToolDirectory $pins.java.archive
if ((Get-FileHash $javaArchive -Algorithm SHA256).Hash -ne $pins.java.sha256) { throw 'Java archive hash mismatch' }
$commands = [System.Collections.Generic.List[object]]::new()
function Invoke-ArchitectureTool {
    param([string[]]$ToolArguments)
    $output = & $JavaPath @ToolArguments 2>&1 | Out-String
    $code = $LASTEXITCODE
    $commands.Add([ordered]@{ executable = $JavaPath; arguments = $ToolArguments; exitCode = $code; output = $output })
    if ($code -ne 0) { throw "Architecture tool failed ($code): $output" }
}
Invoke-ArchitectureTool @('-version')
Invoke-ArchitectureTool @('-jar', (Join-Path $ToolDirectory 'structurizr.war'), 'version')
Invoke-ArchitectureTool @('-jar', (Join-Path $ToolDirectory 'plantuml.jar'), '-version')
Invoke-ArchitectureTool @('-jar', (Join-Path $ToolDirectory 'plantuml.jar'), '-tsvg', '-charset', 'UTF-8', (Join-Path $PSScriptRoot 'code/*.puml'))
$dsl = Join-Path $PSScriptRoot 'workspace.dsl'
Invoke-ArchitectureTool @('-jar', (Join-Path $ToolDirectory 'structurizr.war'), 'validate', '-workspace', $dsl)
foreach ($format in @('json', 'static', 'plantuml')) {
    $destination = switch ($format) { 'json' { 'model' } 'static' { 'site' } 'plantuml' { 'exports' } }
    Invoke-ArchitectureTool @('-jar', (Join-Path $ToolDirectory 'structurizr.war'), 'export', '-workspace', $dsl, '-format', $format, '-output', (Join-Path $PSScriptRoot $destination))
}
# Keep the exported viewer on the model's light palette without changing browser/user settings.
$siteIndex = Join-Path $PSScriptRoot 'site/index.html'
$siteText = Get-Content $siteIndex -Raw
$siteText = $siteText.Replace("structurizr.ui.initDarkMode('./css/structurizr-static-dark.css');", '// Frenemy export: fixed light palette for readable relationship labels.')
$siteText = $siteText.Replace('structurizr.ui.isDarkMode()', 'false')
Set-ArtifactText $siteIndex $siteText
foreach ($file in Get-ChildItem (Join-Path $PSScriptRoot 'exports') -Filter '*.puml') {
    $old = Get-Content $file.FullName -Raw
    $new = $old.Replace('@startuml', "@startuml`n!pragma layout smetana")
    Set-ArtifactText $file.FullName $new
}
Invoke-ArchitectureTool @('-jar', (Join-Path $ToolDirectory 'plantuml.jar'), '-tsvg', '-charset', 'UTF-8', (Join-Path $PSScriptRoot 'exports/*.puml'))
$workspace = Get-Content (Join-Path $PSScriptRoot 'model/workspace.json') -Raw | ConvertFrom-Json -AsHashtable
$requirements = Get-Content (Join-Path $PSScriptRoot 'receipts/requirements-snapshot.json') -Raw | ConvertFrom-Json -AsHashtable
$trace = Get-Content (Join-Path $PSScriptRoot 'traceability.json') -Raw | ConvertFrom-Json -AsHashtable
& (Join-Path $PSScriptRoot 'Update-ArchitectureTrace.ps1')
$trace = Get-Content (Join-Path $PSScriptRoot 'traceability.json') -Raw | ConvertFrom-Json -AsHashtable
$requiredKeys = @('baseline-context','baseline-containers','baseline-relay','baseline-windows-installer','baseline-unix-installer','baseline-image-helper','target-context','target-containers','target-bridge','target-runtime','target-adapters','target-installer','baseline-code-relay','baseline-code-installers','baseline-code-helper','target-code-runtime','target-code-installation','baseline-code-unix','target-code-bridge','baseline-windows-deployment','baseline-linux-deployment','baseline-macos-deployment','target-windows-deployment','target-linux-deployment','target-submission','target-execution','target-permissions','target-cancellation','target-recovery','target-installer-rollback')
$allViews = @($workspace.views.Keys | Where-Object { $_ -like '*Views' } | ForEach-Object { $workspace.views[$_] })
foreach ($key in $requiredKeys) { if ($key -notin $allViews.key) { throw "Missing required view: $key" } }
foreach ($record in $trace.items) {
    if (-not $record.key -or -not $record.change -or -not $record.references.Count) { throw 'Incomplete architecture trace record' }
    foreach ($link in $record.references) {
        $fr = $requirements.functional | Where-Object id -EQ $link.fr
        $test = $requirements.testing | Where-Object id -EQ $link.test
        if (-not $fr -or -not $test -or -not $link.uc.Count -or -not $link.implementationPhases.Count) { throw "Invalid requirement linkage: $($record.key)" }
        foreach ($tr in $link.tr) { if ($tr -notin $requirements.technical.id) { throw "Missing TR $tr" } }
        foreach ($ac in $link.ac) { if ($ac -notin $fr.acceptanceCriteria.id) { throw "Missing AC $ac" } }
        foreach ($case in $link.testCases) { if ($case -notin $test.acceptanceCriteria.id) { throw "Missing TEST case $case" } }
    }
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
foreach ($source in (Get-Content (Join-Path $PSScriptRoot 'receipts/source-pins.json') -Raw | ConvertFrom-Json)) {
    $actual = & git -C $root hash-object -- $source.file
    if ($LASTEXITCODE -ne 0 -or $actual -ne $source.gitBlob) { throw "Source baseline mismatch: $($source.file)" }
}
$svgFiles = @(Get-ChildItem (Join-Path $PSScriptRoot 'code'), (Join-Path $PSScriptRoot 'exports') -Filter '*.svg')
foreach ($svg in $svgFiles) {
    $xml = [xml](Get-Content $svg.FullName -Raw)
    if ($xml.DocumentElement.LocalName -ne 'svg' -or $xml.InnerText -match 'Syntax Error') { throw "Invalid render: $($svg.Name)" }
}
$receipt = [ordered]@{
    generatedLocal = (Get-Date -Format s)
    baseline = 'c7338ad39b646e695e7c4b5fbd998d45be914c02'
    phase = 2
    architectureChecks = 'PASS'
    independentReview = 'PENDING - this receipt is not architecture acceptance'
    productTests = 'Not run: explicitly deferred until architecture acceptance; baseline has no automated suite'
    requiredViews = $requiredKeys.Count
    renderedSvgCount = $svgFiles.Count
    traceRecords = $trace.items.Count
    commands = $commands.ToArray()
    artifacts = @(Get-ChildItem (Join-Path $PSScriptRoot 'code'), (Join-Path $PSScriptRoot 'exports') -File | ForEach-Object { @{path=$_.FullName.Substring($PSScriptRoot.Length+1).Replace('\','/');sha256=(Get-FileHash $_.FullName).Hash} })
}
Set-ArtifactText (Join-Path $PSScriptRoot 'receipts/render-validation.json') ($receipt | ConvertTo-Json -Depth 30)
[pscustomobject]$receipt | Select-Object generatedLocal, requiredViews, renderedSvgCount, traceRecords, architectureChecks, independentReview
