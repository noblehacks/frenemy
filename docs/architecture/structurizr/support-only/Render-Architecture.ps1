#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'PowerShell.MCP'; ModuleVersion = '1.14.0' }
[CmdletBinding(SupportsShouldProcess)]
param([string]$ToolDirectory='F:/GitHub/frenemy/cache/architecture-tools')
$ErrorActionPreference='Stop'
$pins=Get-Content (Join-Path $PSScriptRoot '../tool-pins.json') -Raw | ConvertFrom-Json
foreach($pin in @($pins.plantuml,$pins.structurizr)){
 if((Get-FileHash (Join-Path $ToolDirectory $pin.file)).Hash -ne $pin.sha256){throw "Hash mismatch: $($pin.file)"}
}
if((Get-FileHash (Join-Path $ToolDirectory $pins.java.archive)).Hash -ne $pins.java.sha256){throw 'Java archive hash mismatch'}
$java=Join-Path $ToolDirectory $pins.java.relativeExecutable
$out=Join-Path $PSScriptRoot ('renders/'+(Get-Date -Format yyyyMMddTHHmmss))
if(-not $PSCmdlet.ShouldProcess($out,'Render fresh local architecture artifacts without deleting prior outputs')){return}
if(Test-Path $out){throw 'Output already exists; retain it and use a new timestamp'}
New-Item -ItemType Directory -Path "$out/source/code" -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'workspace.dsl') -Destination "$out/source/workspace.dsl"
 Get-ChildItem (Join-Path $PSScriptRoot 'code') -Filter *.puml | Where-Object BaseName -NE 'target-setup' | Copy-Item -Destination "$out/source/code"
$commands=[System.Collections.Generic.List[object]]::new()
function Invoke-LocalTool {
 param([string[]]$Arguments)
 $output=& $java @Arguments 2>&1 | Out-String
 $exit=$LASTEXITCODE
 $commands.Add([ordered]@{arguments=$Arguments;exitCode=$exit;output=$output})
 if($exit -ne 0){throw "Tool exit ${exit}: $output"}
}
Invoke-LocalTool @('-version')
Invoke-LocalTool @('-jar',"$ToolDirectory/structurizr.war",'version')
Invoke-LocalTool @('-jar',"$ToolDirectory/plantuml.jar",'-version')
Invoke-LocalTool @('-jar',"$ToolDirectory/plantuml.jar",'-tsvg','-charset','UTF-8',"$out/source/code/*.puml")
Invoke-LocalTool @('-jar',"$ToolDirectory/structurizr.war",'validate','-workspace',"$out/source/workspace.dsl")
foreach($format in @('json','static','plantuml')){
 $folder=switch($format){'json'{'model'} 'static'{'site'} 'plantuml'{'exports'}}
 Invoke-LocalTool @('-jar',"$ToolDirectory/structurizr.war",'export','-workspace',"$out/source/workspace.dsl",'-format',$format,'-output',"$out/$folder")
}
foreach($puml in Get-ChildItem "$out/exports" -Filter *.puml){
 $var1=(Get-Content $puml.FullName -Raw).Replace('@startuml',"@startuml`n!pragma layout smetana")
 Update-LinesInFile $puml.FullName -Content $var1 | Out-Null
}
Invoke-LocalTool @('-jar',"$ToolDirectory/plantuml.jar",'-tsvg','-charset','UTF-8',"$out/exports/*.puml")
$index="$out/site/index.html"
$var1=(Get-Content $index -Raw).Replace("structurizr.ui.initDarkMode('./css/structurizr-static-dark.css');",'// Fixed light palette for diagram readability.')
$var1=$var1.Replace('structurizr.ui.isDarkMode()', 'false')
Update-LinesInFile $index -Content $var1 | Out-Null
$files=@(Get-ChildItem $out -Recurse -File | ForEach-Object { [ordered]@{path=[IO.Path]::GetRelativePath($out,$_.FullName);sha256=(Get-FileHash $_.FullName).Hash} })
$var1=[ordered]@{createdAt=(Get-Date -Format s);scope='Grok Build and Cline CLI support only';baseline='c7338ad39b646e695e7c4b5fbd998d45be914c02';toolPins=$pins;javaExecutableSha256=(Get-FileHash $java).Hash;commands=@($commands);files=$files;acceptance='Architecture rendering evidence only; acceptance is recorded separately and does not establish product correctness'} | ConvertTo-Json -Depth 12
Add-LinesToFile "$out/receipt.json" -Content $var1 | Out-Null
[pscustomobject]@{renderDirectory=$out;commands=$commands.Count;files=$files.Count;receipt="$out/receipt.json"} | ConvertTo-Json
