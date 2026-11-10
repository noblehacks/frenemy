# PLAN-FRENEMY-001 Phase 4 release evidence

Scope: Grok Build and Cline CLI support in the existing Frenemy JavaScript stdio relay only. Operator workstation settings, plugins, installers, QBrain product behavior, and new services are outside this evidence denominator.

## Windows

- Host: PAYTON-LEGION2, Windows x64
- Run: `20261106T205700-phase4-windows-release`
- Nuke target: `Validate`
- Result: 191 passed, 0 failed, 0 skipped
- Breakdown: 40 integration, 72 unit, 72 independent-mock, 7 native qualification
- Versions: PowerShell 7.6.5, .NET 10.0.403, Node 20.20.2, Grok 1.0.70, Cline 3.0.74
- Receipt: `windows-release-receipt.json`
- Receipt SHA-256: `DA37EEB75A28EFB4529541FE2D83D8476FEA4DDD642E08890E289275589DDAA5`
- Original reports: `TestResults/20261106T205700-phase4-windows-release/`

## Linux

- Host: LAB-OMARCHY, Omarchy Linux x64
- Run: `20261106T210700-phase4-linux-release`
- Nuke target: `Validate`
- Result: 188 passed, 0 failed, 0 skipped
- Breakdown: 40 integration, 72 unit, 72 independent-mock, 4 native qualification
- Versions: PowerShell 7.6.9, .NET 10.0.403, Node 26.12.0, Grok 1.0.70, Cline 3.0.74
- Receipt: `linux-release-receipt.json`
- Receipt SHA-256: `9442C6222A86CD2D78C4E5FABD9013D7E9A8B9CCAA100C1509378C154EDA2290`
- Results archive SHA-256: `354AD0A4C6986B8CF5DD5DA34A2478BD70737B778FEED7985908ECC4C101C645`
- Original reports: `TestResults/20261106T210700-phase4-linux-release-receipts/`

## Source identity and verification

- Git head: `6150c512ae43026cbbabc4629b85bf44dae9863e`
- Shared source archive SHA-256: `4279EA3CD3BF96C466D94F70BC98CE05660CAC221C9C4D1DC7E11B30E27547EE`
- Source manifest: `source-manifest.json`
- Source manifest SHA-256: `12662B626263F6B83A970EA0B2F8B2432CC1970270707AD8191ECDCC0B9BA668`
- Verification: every artifact hash recorded by the Windows and Linux host receipts matched the retained file after collection.

The shared source archive is a post-Windows-run provenance snapshot created after the in-place Windows lane and then shipped to Linux. Product, configuration, test, ACL-helper and Nuke source bytes match the source manifest on both hosts; transient Windows build logs were captured after that lane. The Windows and Linux host receipts use different receipt schemas, and each receipt is interpreted against its own schema. The Linux receipt's internal paths are relative to the extracted run root beneath the retained `-receipts` collection directory.

## Independent release review

- Reviewer: Claude Opus 4.8 high
- Result: AGREE, 99% accuracy, 99% completeness
- Counts: 13 PASS, 0 FAIL, 0 UNKNOWN
- Chat coverage: 8,184 lines, 1,052 messages, 14 of 14 contiguous ranges
- Receipt: `../../hv/20261106T220747-phase4-release-r3/verdict.md`
- Reviewer session: `ClaudeCode-20261107T035717Z-phase4hvr2`
- Reviewer request: `req-20261107T041032Z-002-phase4-release-hv-r3-fullchat`
- Persisted verdict SHA-256: `6656EA3479741E780CCF04BF916A79EC069E9BA35EC388129FAE3539AA1FEA9D`

The Windows and Linux selected-case totals differ only because Windows includes three platform-specific Grok prompt ACL cases. Both hosts executed every selected case with zero failures and zero skips. Phase 4 is complete.
