[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference='Stop'
$workspace=Get-Content "$PSScriptRoot/model/workspace.json" -Raw|ConvertFrom-Json -AsHashtable
$requirements=Get-Content "$PSScriptRoot/receipts/requirements-snapshot.json" -Raw|ConvertFrom-Json -AsHashtable
$previous=Get-Content "$PSScriptRoot/traceability.json" -Raw|ConvertFrom-Json -AsHashtable
$referenceByFr=@{}
foreach($entry in $previous.items){foreach($reference in $entry.references){
    if($reference.fr -in $requirements.functional.id){
        $reference.tr=@($reference.tr | Where-Object {$_ -in $requirements.technical.id})
        $reference.uc=@($reference.uc | Where-Object {$_ -ne 10192})
        $referenceByFr[$reference.fr]=$reference
    }
}}
$referenceByFr['FR-FRENEMY-113']=@{
 fr='FR-FRENEMY-113';tr=@('TR-FRENEMY-ARCH-117');test='TEST-FRENEMY-113'
 uc=@(10186..10197|Where-Object {$_ -ne 10192})
 ac=@(($requirements.functional|Where-Object id -EQ FR-FRENEMY-113).acceptanceCriteria.id)
 testCases=@(($requirements.testing|Where-Object id -EQ TEST-FRENEMY-113).acceptanceCriteria.id)
 implementationPhases=@(2)
}
$nodes=[System.Collections.Generic.List[object]]::new()
$edges=[System.Collections.Generic.List[object]]::new()
$byId=@{}
function Read-ModelNode {
 param([hashtable]$Node,[string]$Parent,[string]$Kind)
 if($Node.id){
    $key=if($Node.properties){$Node.properties['structurizr.dsl.identifier']}else{$null}
    if(-not $key){$key=$Parent+'/'+$Node.name}
    if($Node.containerId){$key=$Parent+'/containerInstance/'+$Node.containerId}
    if($Node.softwareSystemId){$key=$Parent+'/softwareSystemInstance/'+$Node.softwareSystemId}
    $entry=@{node=$Node;key=$key;kind=$Kind;parent=$Parent}
    $nodes.Add($entry);$byId[$Node.id]=$entry
    foreach($edge in $Node.relationships){$edges.Add($edge)}
    $Parent=$key
 }
 foreach($childKind in @('people','softwareSystems','containers','components','deploymentNodes','containerInstances','softwareSystemInstances','infrastructureNodes')){
    foreach($child in $Node[$childKind]){Read-ModelNode $child $Parent $childKind}
 }
}
Read-ModelNode $workspace.model 'model' 'model'
# Deployment instance keys use stable logical identifiers rather than numeric model IDs.
foreach($entry in $nodes){
 $node=$entry.node
 if($node.containerId){$entry.key=$entry.parent+'/containerInstance/'+$byId[$node.containerId].key}
 if($node.softwareSystemId){$entry.key=$entry.parent+'/softwareSystemInstance/'+$byId[$node.softwareSystemId].key}
}
function Get-TraceReference {
 param([string]$Identity)
 $ids=switch -Regex ($Identity){
  '^baseline|Baseline-' {113;break}
  '\.installer|target\.settings|Target-|Windows user|Linux user' {111;break}
  '\.scheduler' {109;break}
  '\.policy' {106;break}
  '\.recovery' {105;break}
  '\.events' {103;108;110;break}
  '\.store|target\.jobs' {102;103;105;110;break}
  '\.process' {104;106;108;break}
  '\.repo' {102;106;break}
  'target\.bridge|\.api' {101;102;103;104;105;break}
  'auth' {108;break}
  'claude|codex|grok|cline' {101;105;106;108;break}
  default {101;111}
 }
 return @($ids | ForEach-Object {$referenceByFr['FR-FRENEMY-'+$_]})
}
$records=[System.Collections.Generic.List[object]]::new()
foreach($entry in $nodes){
 $node=$entry.node
 $origin=$entry.key
 if($node.containerId){$origin=$byId[$node.containerId].key}
 if($node.softwareSystemId){$origin=$byId[$node.softwareSystemId].key}
 $change=@($node.tags -split ',' | Where-Object {$_ -in @('Added','Modified','Unchanged','Replaced')})[0]
 if(-not $change){$change=if($entry.key -match 'Target|DESIGN'){'Added'}else{'Unchanged'}}
 $records.Add(@{key=$entry.key;modelId=$node.id;kind='element';name=$node.name;origin=$origin;change=$change;references=@(Get-TraceReference $origin);architectureGate='FR-FRENEMY-113 / TR-FRENEMY-ARCH-117 / TEST-FRENEMY-113';sourceEvidence=if($origin -like 'baseline*'){'source-evidence.md and receipts/source-pins.json; immutable baseline'}else{'Corrected approved plan and contracts.md; DESIGN, not implemented'}})
}
foreach($edge in $edges){
 $source=$byId[$edge.sourceId];$destination=$byId[$edge.destinationId]
 if(-not $source -or -not $destination){throw 'Unknown model endpoint'}
 $change=@($edge.tags -split ',' | Where-Object {$_ -in @('Added','Modified','Unchanged','Replaced')})[0]
 if(-not $change){$change='Added'}
 $refs=@(@(Get-TraceReference $source.key)+@(Get-TraceReference $destination.key)|Group-Object fr|ForEach-Object {$_.Group[0]})
 $records.Add(@{key=$source.key+' -> '+$destination.key+' :: '+$edge.description;kind='relationship';modelId=$edge.id;source=$source.key;destination=$destination.key;sourceId=$edge.sourceId;destinationId=$edge.destinationId;description=$edge.description;derivedFrom=$edge.linkedRelationshipId;change=$change;references=$refs;architectureGate='FR-FRENEMY-113 / TR-FRENEMY-ARCH-117 / TEST-FRENEMY-113';sourceEvidence='source-evidence.md for baseline; corrected plan/contracts.md for target DESIGN'})
}
$result=@{baseline=$previous.baseline;legend=$previous.legend;items=$records.ToArray()}
if($PSCmdlet.ShouldProcess("$PSScriptRoot/traceability.json",'Regenerate complete model traceability for corrected scope')){
 $old=Get-Content "$PSScriptRoot/traceability.json" -Raw
 Update-MatchInFile -LiteralPath "$PSScriptRoot/traceability.json" -OldText $old -Replacement ($result|ConvertTo-Json -Depth 40) | Out-Null
}
