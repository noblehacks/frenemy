#Requires -Version 7.0
[CmdletBinding(SupportsShouldProcess)]
param([string]$ToolDirectory=(Join-Path ([IO.Path]::GetTempPath()) 'frenemy-architecture-tools'))
$ErrorActionPreference='Stop'
if(-not $IsWindows){throw 'These pinned render binaries target Windows x64; Linux deployment views do not claim a Linux renderer.'}
$pins=Get-Content (Join-Path $PSScriptRoot '../tool-pins.json') -Raw | ConvertFrom-Json
foreach($pin in @($pins.plantuml,$pins.structurizr,$pins.java)){
 $name=if($pin.file){$pin.file}else{$pin.archive}
 $destination=Join-Path $ToolDirectory $name
 if(Test-Path -LiteralPath $destination){
  if((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $pin.sha256){throw "Existing tool hash mismatch: $destination; retain for diagnosis"}
 }elseif($PSCmdlet.ShouldProcess($destination,"Download pinned release $($pin.url)")){
  New-Item -ItemType Directory -Path $ToolDirectory -Force | Out-Null
  Invoke-WebRequest -Uri $pin.url -OutFile $destination
  if((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $pin.sha256){throw "Downloaded hash mismatch: $destination; retained, do not execute"}
 }
}
$java=Join-Path $ToolDirectory $pins.java.relativeExecutable
if(-not(Test-Path -LiteralPath $java)){
 $archive=Join-Path $ToolDirectory $pins.java.archive
 if($PSCmdlet.ShouldProcess((Join-Path $ToolDirectory 'java21'),'Extract verified pinned Java archive')){
  if((Get-FileHash -LiteralPath $archive).Hash -ne $pins.java.sha256){throw 'Java archive hash mismatch'}
  Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $ToolDirectory 'java21')
 }
}
