<#
.SYNOPSIS
Validates the test-side Windows Grok prompt ACL provider on a real temporary filesystem.

.DESCRIPTION
Exercises ACL creation before prompt writes, verifies the two permitted security identifiers,
and rejects paths outside an invocation-owned directory. These are integration tests because
they depend on Windows filesystem ACL behavior.

.NOTES
Change log:
- 2026-11-06, FR-FRENEMY-114, TEST-FRENEMY-114, AC-FRENEMY-114-05 and
  AC-TEST-FRENEMY-114-05: Added Windows native-qualification coverage for the protected
  prompt transport before production helper implementation.
#>

Describe 'ProtectGrokPromptIntegrationTests Windows ACL contract' -Tag 'Integration', 'Windows' {
    BeforeAll {
        $script:Provider = Join-Path $PSScriptRoot '../native/Protect-GrokPrompt.ps1'
    }

    It 'protects the directory and empty file before prompt bytes are written' {
        $owned = Join-Path $TestDrive 'owned'
        $prompt = Join-Path $owned 'prompt.txt'
        $result = & $script:Provider -OwnedDirectory $owned -PromptPath $prompt

        $result.Protected | Should -BeTrue
        (Get-Item -LiteralPath $prompt).Length | Should -Be 0
        $security = [IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]::new($prompt))
        $rules = @($security.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
        $actual = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
        $actual | Should -Be @($result.SystemSid, $result.UserSid | Sort-Object -Unique)
    }

    It 'rejects a prompt path outside the owned directory' {
        $owned = Join-Path $TestDrive 'owned-outside'
        $outside = Join-Path $TestDrive 'outside.txt'
        { & $script:Provider -OwnedDirectory $owned -PromptPath $outside } | Should -Throw '*directly beneath*'
    }

    It 'rejects a pre-existing owned directory' {
        $owned = Join-Path $TestDrive 'existing'
        [IO.Directory]::CreateDirectory($owned) | Out-Null
        { & $script:Provider -OwnedDirectory $owned -PromptPath (Join-Path $owned 'prompt.txt') } | Should -Throw '*must not already exist*'
    }
}
