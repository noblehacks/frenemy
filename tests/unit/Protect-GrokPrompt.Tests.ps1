<#
.SYNOPSIS
Proves the Windows prompt-protection assertion with platform-neutral mocks.

.NOTES
Change log:
- 2026-11-06, TEST-FRENEMY-114 and AC-TEST-FRENEMY-114-05: Added the green
  protection-order mock and deliberate negative control before product helper code.
#>

Describe 'ProtectGrokPromptTests independent protection contract' -Tag 'Unit' {
    BeforeAll {
        $script:Provider = Join-Path $PSScriptRoot 'Protect-GrokPrompt.Mock.ps1'
        function Assert-ProtectionOrder {
            param([Parameter(Mandatory)][string[]]$Events)
            if ($Events.Count -eq 0 -or $Events[0] -ne 'protect') { throw 'Protection must be the first event.' }
            if ($Events -contains 'prompt-bytes') { throw 'The protection provider must not receive prompt bytes.' }
        }
    }

    It 'records protection first without prompt bytes' {
        $owned = Join-Path $TestDrive 'owned'
        $events = Join-Path $TestDrive 'events.txt'
        [IO.Directory]::CreateDirectory($owned) | Out-Null
        & $script:Provider -OwnedDirectory $owned -EventPath $events
        $observed = @(Get-Content -LiteralPath $events)
        { Assert-ProtectionOrder -Events $observed } | Should -Not -Throw
        $observed | Should -Be @('protect')
    }

    It 'rejects a relative owned directory' {
        { & $script:Provider -OwnedDirectory 'relative/path' -EventPath (Join-Path $TestDrive 'events.txt') } | Should -Throw '*absolute*'
    }

    It 'negative control rejects writing before protection' {
        { Assert-ProtectionOrder -Events @('prompt-bytes', 'protect') } | Should -Throw '*first event*'
    }
}
