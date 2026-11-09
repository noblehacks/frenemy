#Requires -Version 7.4

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string] $MarkerPath,

    [Parameter(Mandatory)]
    [string] $ResponsePath,

    [Parameter(Mandatory)]
    [string] $PublicResponsePath,

    [Parameter(Mandatory)]
    [string] $ManifestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$marker = Get-Content -LiteralPath $MarkerPath -Raw | ConvertFrom-Yaml
$workspaceApiKey = [string] $marker.apiKey
if ([string]::IsNullOrWhiteSpace($workspaceApiKey)) {
    throw 'The workspace marker does not contain an API key.'
}

$response = Get-Content -LiteralPath $ResponsePath -Raw
$redactionCount = ([regex]::Matches($response, [regex]::Escape($workspaceApiKey))).Count
$publicResponse = $response.Replace($workspaceApiKey, '[REDACTED_WORKSPACE_API_KEY]')

if (-not $PSCmdlet.ShouldProcess($PublicResponsePath, 'Create the credential-safe public response derivative')) {
    return
}

[IO.File]::WriteAllText($PublicResponsePath, $publicResponse, [Text.UTF8Encoding]::new($false))
$manifest = [ordered]@{
    originalFile = [IO.Path]::GetFileName($ResponsePath)
    originalSha256 = (Get-FileHash -LiteralPath $ResponsePath -Algorithm SHA256).Hash
    publicFile = [IO.Path]::GetFileName($PublicResponsePath)
    publicSha256 = (Get-FileHash -LiteralPath $PublicResponsePath -Algorithm SHA256).Hash
    redactionCount = $redactionCount
    redaction = 'workspace API key only'
    originalRetainedLocally = $true
    reviewInputWasUnredacted = $true
}
$manifest | ConvertTo-Json -Depth 4 | Out-File -LiteralPath $ManifestPath -Encoding utf8
$manifest | ConvertTo-Json -Depth 4
