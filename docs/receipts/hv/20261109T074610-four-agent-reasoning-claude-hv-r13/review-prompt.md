# PLAN-FRENEMY-002 R13 hostile validation

You are the independent hostile reviewer running through normal Claude Code. The operator explicitly selected Claude Code with model `claude-opus-5-5` and `high` effort.

Before reviewing, execute the complete add-profile workflow. Read the full operator profile, the complete workspace marker, and all live Global and active Workspace MCP memories except `MEMORY-PROCESS-007`. Report verified counts. Use the Claude Code MCP plugin, including its hook-validation skill. Create your own MCP session and dedicated session-log turn. Persist the complete final verdict, read it back, and verify its bytes or SHA-256. If MCP or persistence infrastructure fails, record that separately and continue the substantive review under MEMORY-HV-001 Rule 6 when sufficient evidence is otherwise available.

Stay read-only. Do not edit repository files, requirements, TODO state, or configuration. Do not commit or push. Do not build, restore, run tests, launch agents, or launch subagents. The request supplies the required test evidence. If tests are inadequate, FAIL the affected criterion and prescribe the needed AC or test instead of running one yourself.

Emit meaningful progress entries with a measured completion percentage and ETA throughout the retained response JSONL. Review time and output size are unbounded. Stop only if the response stream has no update for more than 30 minutes.

## Exact approved scope

The only product feature scope is Grok Build and Cline CLI support in the existing JavaScript Frenemy relay. The approved integration-test increment is test-only: Claude Code, Codex, Grok Build, and Cline CLI answer the five exact TEST-FRENEMY-117 questions at medium effort; every answer is judged by the other three agents and must score at least 50 percent; the complete orchestration chat and all 40 individual sessions are archived for human review.

Do not introduce, require, or score unrelated job services, schedulers, durable storage, worktrees, installer changes, QBrain integration, plugin management, workstation configuration, authentication changes, or C# product code or tests. Existing installers, configuration, instructions, and the optional image helper may appear only as baseline context. The operator's environment and plugins are not Frenemy product scope.

Thorough testing, direct negative controls, precise evidence, accurate metadata, and clean documentation are required within the approved scope. Thoroughness is not permission to add product requirements.

## Head and change under review

- Local and `origin/main` HEAD: `13e2d651629ed4ff966c96b05efa01abbb34ba72`.
- Product/support commit: `48bb179409f92693fc8bf47a382aaf3bf930d37d`.
- Test-integration commit: `86402e4e64e3d06183f16a3323401c014e99fc2f`.
- Validation documentation commits: `7c579b3f6382def936c4c018a8d5b7480bd6cd25` and `13e2d651629ed4ff966c96b05efa01abbb34ba72`.
- The change under review is the complete current Grok/Cline support increment plus the approved four-agent test, with special focus on remediation of R12 findings `F-RR-01` through `F-RR-05`.
- The working tree has zero tracked modifications. Untracked local receipts and historical evidence are not proposed product changes.

## Required task treatment

- Task 1: completed under R3 at 99/99. Review for regression only because its requirement is shared with the current change.
- Task 2: open. Fully adjudicate the deterministic independent-mock and direct negative-control contract.
- Task 3: completed under R12 at 98/98. Review for regression only, especially failure retention and archive integrity.
- Task 4: open. Fully adjudicate regression evidence, documentation, TODO currency, transparency, source-control state, and this final review package.

Return the required requirements matrix showing every plan task, its requirements, the requirements in flux, the changes under review, full-adjudication tasks, regression-only tasks, and out-of-scope tasks.

## R12 findings that must be independently rechecked

1. `F-RR-01`: verify every formerly uncovered contract assertion now has an executed direct negative control, or a technically valid dominance reason, and that deleting or weakening a contract assertion is detected.
2. `F-RR-02`: verify the fixture, contracts, unit tests, integration tests, PowerShell runner, plan, requirement projections, and relevant receipts are committed at the reviewed head; verify retained test evidence identifies committed source.
3. `F-RR-03`: verify the R9 and R11 self-review corrections are append-only and preserve original text and conclusion order.
4. `F-RR-04`: read live `PLAN-FRENEMY-002` through the Claude plugin and verify `done:false`, Tasks 1 and 3 completed, Tasks 2 and 4 open, final-head evidence recorded, and remaining work limited to this independent review.
5. `F-RR-05`: verify the full requirement-readback hash and correction of the obsolete no-control-needed claim.

Search for siblings of each failure class inside the exact approved scope. Do not turn the sibling search into new product scope.

## Required semantic checks

- Independently inspect the requirements, ACs, plan, code, tests, archives, receipts, git history, and live TODO. Do not accept implementer claims merely because they appear in chat or documentation.
- Verify the five fixture questions match TEST-FRENEMY-117 exactly and their pins are correct.
- Verify unit tests use only version-controlled deterministic fixtures and scripted data. They must be reproducible with or without harvested or live data.
- Verify all four agent adapters are configured at medium effort for the five-question live integration.
- Verify every answer receives exactly three distinct peer judgments, never self-judgment, and every score must be at least 50.
- Verify partial and failed runs retain all settled sessions, transcripts, orchestration events, failure artifacts, reports, and archive members needed for human review.
- Verify the successful live archive has 5 questions, 20 answers, 40 sessions and transcripts, 60 judgments, minimum accuracy 83, and a valid 110-file ZIP with no mismatches.
- Verify the current final-head deterministic gate has 40/40 integration, 227/227 unit, and 227/227 independent-mock executions, with 0 failed and 0 skipped/not executed.
- Verify the focused direct-control gate has 155/155 passed with 0 failed and 0 skipped.
- Verify the prior complete native gate has 7/7 passed. Also inspect the current committed-source native receipt: Cline passed and Grok failed only because the installed Grok Build service returned external HTTP 402 usage-balance exhaustion. Apply MEMORY-HV-001 Rule 6: infrastructure failures do not by themselves force DISAGREE, lower a score, or block acceptance when sufficient review evidence exists. If this prevents proof of a named criterion, identify that criterion and the missing evidence precisely.
- Verify the active Structurizr target contains only the current relay, Grok, Cline, selector configuration, protected Grok prompt boundary, and retained baseline context. Explicit exclusion statements are not integrations. No withdrawn job-service, scheduler, durable-storage, worktree, QBrain, plugin-management, audit-delivery, or installer-change design may remain active.
- Verify the effective requirement store contains current Grok/Cline records `FR-FRENEMY-113` through `FR-FRENEMY-117`, their TRs and TESTs, and no withdrawn future job-service records `101` through `112`.
- Verify no credentials are committed. The raw R12 response and all chat evidence are supplied to you unredacted. The raw R12 response contains a workspace API key because the reviewer read the marker. It is intentionally retained locally and intentionally not committed. The public repository contains only the credential-safe derivative and manifest. This publication safety measure must not be treated as redaction of the evidence sent to HV.

## Required evidence paths

Core plan, requirements, implementation, and tests:

- `docs/plans/four-agent-reasoning-integration.md`
- `docs/testing/validation.md`
- `docs/Project/Functional-Requirements.md`
- `docs/Project/Technical-Requirements.md`
- `docs/Project/Test-Requirements.md`
- `docs/Project/Requirements-Mapping.md`
- `tests/fixtures/four-agent-reasoning-questions.json`
- `tests/contracts/four-agent-reasoning.mjs`
- `tests/contracts/zip-archive.mjs`
- `tests/unit/four-agent-reasoning.contract.test.mjs`
- `tests/integration/four-agent-reasoning.integration.test.mjs`
- `tests/integration/four-agent-reasoning.archive.test.mjs`
- `build/Invoke-RelayTests.ps1`
- `docs/architecture/structurizr/support-only/`

R12 review and complete transparency evidence:

- `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/request.jsonl`
- `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/response.jsonl` (raw, unredacted, local)
- `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/response.public.jsonl`
- `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/response.public-manifest.json`
- `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/verdict.md`
- `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/visible-chat-unredacted-current-session.jsonl`
- `docs/receipts/hv/20261107T234831-four-agent-reasoning-grok-hv/visible-chat-unredacted-complete.md`
- `docs/receipts/hv/20261107T234831-four-agent-reasoning-grok-hv/visible-chat-chunks/chat-chunks-manifest.json` and every listed chunk in order
- `docs/receipts/hv/20261109T074610-four-agent-reasoning-claude-hv-r13/codex-chat-unredacted-current-rollout.jsonl`

R12 remediation and current evidence:

- `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/r12-remediation-self-review.md`
- `docs/receipts/hv/20261107T183919-four-agent-reasoning-r9/pre-hv-self-review.md`
- `docs/receipts/hv/20261107T203051-four-agent-reasoning-r11/pre-hv-self-review.md`
- `TestResults/20261109T045102-four-agent-r12-direct-controls/groups/Frenemy.Relay.UnitTests/Frenemy.Relay.UnitTests.trx`
- `TestResults/20261109T073830-four-agent-r12-hv-ready/integration/Frenemy.Relay.IntegrationTests/Frenemy.Relay.IntegrationTests.trx`
- `TestResults/20261109T073830-four-agent-r12-hv-ready/unit/Frenemy.Relay.UnitTests/Frenemy.Relay.UnitTests.trx`
- `TestResults/20261109T073830-four-agent-r12-hv-ready/verify-mocks/Frenemy.Relay.UnitTests/Frenemy.Relay.UnitTests.trx`
- `TestResults/20261107T200628-four-agent-r10-final-validate/native/Frenemy.Relay.NativeQualification/Frenemy.Relay.NativeQualification.trx`
- `TestResults/20261109T073120-four-agent-r12-committed-validate/native/Frenemy.Relay.NativeQualification/Frenemy.Relay.NativeQualification.native-qualification.test.node.junit.xml`
- `TestResults/20261107T201715-four-agent-r10-final-live/`
- `TestResults/20261107T200437-four-agent-r10-missing-session-metadata/`

Read the complete unredacted chat evidence. It exists so you can find implementer mistakes and operator corrections. Do not redact, suppress, or excuse those failures.

## Final response contract

Return all of the following:

- `OverallVerdict`: `AGREE` or `DISAGREE`.
- Overall accuracy and completeness percentages.
- Overall PASS, FAIL, and UNKNOWN counts.
- The complete task and requirement matrix.
- Task 1 regression result with PASS/FAIL/UNKNOWN counts.
- Task 2 verdict, accuracy, completeness, PASS/FAIL/UNKNOWN counts.
- Task 3 regression result with PASS/FAIL/UNKNOWN counts.
- Task 4 verdict, accuracy, completeness, PASS/FAIL/UNKNOWN counts.
- Independent disposition of `F-RR-01` through `F-RR-05` and every sibling found.
- Every applicable FAIL and UNKNOWN, with exact file/line or receipt anchor, failure scenario, requirement impact, and repair.
- Every regression, or an explicit statement that no regression was found.
- Model, effort, Claude Code session ID, MCP session ID, request ID, turn ID, persistence readback result, and request/response/verdict receipt paths.
- One final machine-readable JSON object containing the same result.

AGREE is permitted only when overall and every fully adjudicated in-scope open task have accuracy and completeness at least 98, every applicable criterion has a real disposition, and unresolved applicable FAIL and UNKNOWN counts are both zero. Completed tasks must have no regression. Passing test counts do not substitute for semantic proof.
