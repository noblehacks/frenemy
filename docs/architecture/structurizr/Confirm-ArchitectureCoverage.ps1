[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference='Stop'
$w=Get-Content "$PSScriptRoot/model/workspace.json" -Raw|ConvertFrom-Json -AsHashtable
$trace=Get-Content "$PSScriptRoot/traceability.json" -Raw|ConvertFrom-Json -AsHashtable
$r=Get-Content "$PSScriptRoot/receipts/requirements-snapshot.json" -Raw|ConvertFrom-Json -AsHashtable
$ucs=Get-Content "$PSScriptRoot/receipts/usecases-snapshot.json" -Raw|ConvertFrom-Json -AsHashtable
$allViews=@($w.views.Keys|Where-Object {$_ -like '*Views'}|ForEach-Object {$w.views[$_]})
$components=@($w.model.softwareSystems.containers.components)
$componentViewElements=@($w.views.componentViews.elements.id)
$containers=@($w.model.softwareSystems.containers|Where-Object {$_.components.Count -gt 0})
foreach($component in $components){if($component.id -notin $componentViewElements){throw "Missing component view coverage: $($component.name)"}}
foreach($container in $containers){if($container.id -notin $w.views.imageViews.elementId){throw "Missing code view: $($container.name)"}}
foreach($mapping in $r.mappings){
 if($mapping.frId -notin $r.functional.id){throw 'Dangling FR mapping'}
 foreach($id in $mapping.trIds){if($id -notin $r.technical.id){throw "Dangling TR $id"}}
 foreach($id in $mapping.testIds){if($id -notin $r.testing.id){throw "Dangling TEST $id"}}
}
foreach($item in $trace.items){foreach($ref in $item.references){foreach($uc in $ref.uc){if($uc -notin $ucs.items.useCaseId){throw "Missing UC $uc"}}}}
$identifiers=@($trace.items|Where-Object kind -EQ element|ForEach-Object {$_.origin})
foreach($forbidden in @('plugins','qbrain','git','target.service.worktree','target.service.audit','target.trees')){
 if($forbidden -in $identifiers){throw "Excluded model dependency $forbidden"}
}
if($allViews.key -contains 'target-audit-retry'){throw 'Excluded audit flow remains'}
if(($trace.items.modelId|Sort-Object -Unique).Count -ne $trace.items.Count){throw 'Duplicate model trace identity'}
$receipt=[ordered]@{
 checkedLocal=(Get-Date -Format s);result='PASS';ownedComponentCount=$components.Count
 ownedExecutableContainerCount=$containers.Count;viewCount=$allViews.Count;traceCount=$trace.items.Count
 useCasesVerified=$ucs.items.Count;excludedActiveIds=@('FR-FRENEMY-107','TEST-FRENEMY-107','TR-FRENEMY-GIT-108','TR-FRENEMY-AUDIT-113','UC10192')
 productionACsSatisfied=@($r.functional|Where-Object id -Match '-1\d\d$'|ForEach-Object {$_.acceptanceCriteria}|Where-Object isSatisfied).Count
 independentReview='PENDING'
 artifacts=@(Get-ChildItem $PSScriptRoot -File -Recurse|Where-Object {$_.FullName -notmatch 'coverage-validation.json$'}|ForEach-Object {@{path=$_.FullName.Substring($PSScriptRoot.Length+1).Replace('\','/');sha256=(Get-FileHash $_.FullName).Hash}})
}
if($PSCmdlet.ShouldProcess("$PSScriptRoot/receipts/coverage-validation.json",'Save architecture coverage receipt')){
 $path="$PSScriptRoot/receipts/coverage-validation.json";$text=$receipt|ConvertTo-Json -Depth 15
 if(Test-Path $path){$old=Get-Content $path -Raw;Update-MatchInFile -LiteralPath $path -OldText $old -Replacement $text|Out-Null}
 else{Add-LinesToFile -LiteralPath $path -Content $text|Out-Null}
}
$receipt|Select-Object checkedLocal,result,ownedComponentCount,ownedExecutableContainerCount,viewCount,traceCount,useCasesVerified,productionACsSatisfied
