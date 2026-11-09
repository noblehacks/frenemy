<#
.SYNOPSIS
Creates and verifies a Windows-only protected Grok prompt file.

.DESCRIPTION
Creates the invocation-owned directory, replaces inherited access with explicit
FullControl for the current user and SYSTEM, creates an empty prompt file, applies
the same two-principal policy to the file, and verifies the explicit allow rules.
Prompt bytes are never accepted by this helper.

.PARAMETER OwnedDirectory
Absolute invocation-owned directory that does not already exist.

.PARAMETER PromptPath
Absolute prompt-file path directly beneath OwnedDirectory.

.OUTPUTS
An object containing the protected paths and verified security identifiers.

.NOTES
Change log:
- 2026-11-06, FR-FRENEMY-114, TEST-FRENEMY-114, AC-FRENEMY-114-05 and
  AC-TEST-FRENEMY-114-05: Added the production Windows ACL provider required
  before the Frenemy relay writes Grok prompt bytes.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OwnedDirectory,
    [Parameter(Mandatory)][string]$PromptPath
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows Grok prompt protection requires Windows.' }
if (-not [IO.Path]::IsPathFullyQualified($OwnedDirectory)) { throw 'OwnedDirectory must be absolute.' }
if (-not [IO.Path]::IsPathFullyQualified($PromptPath)) { throw 'PromptPath must be absolute.' }

$ownedFull = [IO.Path]::GetFullPath($OwnedDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
$promptFull = [IO.Path]::GetFullPath($PromptPath)
if ([IO.Path]::GetDirectoryName($promptFull) -ne $ownedFull) { throw 'PromptPath must be directly beneath OwnedDirectory.' }
if (Test-Path -LiteralPath $ownedFull) { throw 'OwnedDirectory must not already exist.' }

$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$allow = [Security.AccessControl.AccessControlType]::Allow
$fullControl = [Security.AccessControl.FileSystemRights]::FullControl
$inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
$nonePropagation = [Security.AccessControl.PropagationFlags]::None

$directoryInfo = [IO.Directory]::CreateDirectory($ownedFull)
$directorySecurity = [Security.AccessControl.DirectorySecurity]::new()
$directorySecurity.SetOwner($userSid)
$directorySecurity.SetAccessRuleProtection($true, $false)
$directorySecurity.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($userSid, $fullControl, $inheritance, $nonePropagation, $allow))
$directorySecurity.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, $fullControl, $inheritance, $nonePropagation, $allow))
[IO.FileSystemAclExtensions]::SetAccessControl($directoryInfo, $directorySecurity)

$stream = [IO.FileStream]::new($promptFull, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
$stream.Dispose()
$fileInfo = [IO.FileInfo]::new($promptFull)
$fileSecurity = [Security.AccessControl.FileSecurity]::new()
$fileSecurity.SetOwner($userSid)
$fileSecurity.SetAccessRuleProtection($true, $false)
$fileSecurity.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($userSid, $fullControl, $allow))
$fileSecurity.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, $fullControl, $allow))
[IO.FileSystemAclExtensions]::SetAccessControl($fileInfo, $fileSecurity)

$verified = [IO.FileSystemAclExtensions]::GetAccessControl($fileInfo)
$rules = @($verified.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
$actualSids = @($rules | Where-Object AccessControlType -eq $allow | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
$expectedSids = @($systemSid.Value, $userSid.Value | Sort-Object -Unique)
if (Compare-Object -ReferenceObject $expectedSids -DifferenceObject $actualSids) { throw 'Prompt ACL verification failed.' }
if ($rules | Where-Object AccessControlType -ne $allow) { throw 'Prompt ACL contains an explicit deny rule.' }

[pscustomobject]@{
    OwnedDirectory = $ownedFull
    PromptPath = $promptFull
    UserSid = $userSid.Value
    SystemSid = $systemSid.Value
    Protected = $verified.AreAccessRulesProtected
}
