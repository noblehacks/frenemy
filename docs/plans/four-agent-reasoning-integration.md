# PLAN-FRENEMY-002: Four-agent reasoning integration test

Status: In progress. The operator approved implementation on 2026-11-07. Hostile review R12 returned DISAGREE at 95 accuracy and 94 completeness with 29 PASS, 5 FAIL, and 0 UNKNOWN. Task 1 had no regression; Task 3 cleared AGREE at 98/98; Tasks 2 and 4 remain open. All five R12 findings are remediated: the direct controls are present, the tested artifacts are committed at `86402e4e64e3d06183f16a3323401c014e99fc2f`, the append-only corrections are retained, and the authoritative TODO is current. Completion still requires a later independent AGREE at 98/98 or higher with no unresolved applicable FAIL or UNKNOWN.

## Outcome

Add one opt-in integration test for the current Frenemy server. Claude Code, Codex, Grok Build, and Cline CLI will each answer the same five acceptance-criteria questions at medium effort. Each answer will be scored by the other three agents. A run passes only when every peer score is at least 50 and all required evidence is archived for human review.

Requirement records:

- `FR-FRENEMY-117`: Four-agent reasoning integration review.
- `TR-FRENEMY-ORCH-121`: Four-agent reasoning integration harness.
- `TEST-FRENEMY-117`: Validate four-agent reasoning and peer review.
- Mapping: `FR-FRENEMY-117` to `TR-FRENEMY-ORCH-121` and `TEST-FRENEMY-117`.

## Scope boundary

In scope:

- A JavaScript test harness and JavaScript assertions.
- Independent scripted fakes and negative controls before the live harness.
- Nuke and PowerShell orchestration needed to select the test, retain TRX, and create the archive.
- The existing caller-side `codex exec` path.
- The current Frenemy `ask_claude`, `ask_grok`, and `ask_cline` read-only tools.
- Directly related test documentation and validation receipts.

Out of scope:

- New Frenemy tools, services, APIs, job systems, schedulers, or persistence.
- Changes to relay product behavior, write-mode behavior, permissions, authentication, installers, agent plugins, or workstation configuration.
- C# product code or C# tests. `build/Build.cs` remains Nuke orchestration only.
- Collecting internal hidden reasoning or external CLI internals that the current Frenemy boundary does not expose.
- Redacting the orchestration conversation or agent answers. Credentials and environment dumps are never collected in the first place.

## Source-pinned baseline

- `README.md` describes the asymmetric four-agent design: Claude calls Codex through `codex exec`; Codex reaches Claude, Grok, and Cline through Frenemy.
- `CLAUDE-codex-section.md` defines the existing caller-side Codex path.
- `ask-claude-mcp.mjs` exposes the six existing read/write tools. The new test uses only `ask_claude`, `ask_grok`, and `ask_cline`.
- `ask-claude-mcp.mjs` already accepts `effort` for Claude, Grok, and Cline and maps it to each native interface.
- `build/Build.cs` and `build/Invoke-RelayTests.ps1` are the existing Nuke and PowerShell test orchestration seams.
- The local `codex exec --help` receipt confirms read-only execution, JSONL output, absolute working-directory selection, and config overrides. Codex medium effort will use `-c model_reasoning_effort=medium`.

## Canonical questions

The exact texts and rubrics are acceptance criteria `AC-TEST-FRENEMY-117-Q01` through `Q05`. The test will load one version-controlled fixture containing those exact values. It will not generate, paraphrase, replace, or select questions dynamically.

1. Math: independent component failures across five days. Canonical result: `1 - 0.98^5 = 0.0960792032`, approximately 9.61 percent.
2. Physics: a 2.0 kg block drops 5.0 m and crosses 10.0 m at kinetic-friction coefficient 0.20. Canonical result: 58.8 J final kinetic energy and approximately 7.67 m/s.
3. History: explain the Provisional Government's loss of authority from February through October 1917 by weighing and connecting at least three rubric factors.
4. Chemistry: acetic-acid/acetate buffer after 0.050 mol HCl. Canonical result: 0.050 mol acetate, 0.250 mol acid, pH approximately 4.06.
5. Economics: linear demand and supply with a 10 dollar seller tax. Canonical results: no-tax `P=20, Q=80`; tax `Pb=26, Ps=16, Q=68`; burdens 6 and 4 dollars; revenue 680 dollars; deadweight loss 60 dollars.

The MCP requirement record is the authoritative wording. The repository fixture will be checked byte-for-byte against a version-controlled projection of those criteria during implementation.

## Locked orchestration protocol

The participant IDs are `claude`, `codex`, `grok`, and `cline`.

For each question, in order:

1. Start four answer sessions concurrently, one per participant. The prompt includes the exact question and rubric identifier, requests a concise answer with supporting reasoning, forbids workspace inspection because the question is self-contained, and explicitly sets medium effort.
2. Wait for all four answers. Any launch failure, timeout, tool error, empty answer, or wrong question identity fails the run. No automatic retry or substitute agent is allowed.
3. Start four review sessions concurrently, one per participant. Each reviewer receives the exact rubric and the other three answers, never its own answer, and returns three judgments.
4. Validate each judgment as strict JSON with `questionId`, `subjectAgent`, `reviewerAgent`, integer `accuracy` from 0 through 100, `rationale`, and `rubricFindings`.
5. Require all 12 judgments for that question to be distinct and valid before advancing to the next question.

This produces 40 individual sessions: 20 answer sessions and 20 bundled peer-review sessions. It produces 20 answers and 60 peer judgments. A run passes only if every one of the 60 peer judgments is at least 50. The arithmetic mean is reported for human convenience but is not the gate.

Medium-effort bindings:

- Claude: `ask_claude` with `effort: "medium"`.
- Codex: `codex exec --sandbox read-only --json -c model_reasoning_effort=medium` with the prompt on standard input.
- Grok: `ask_grok` with `effort: "medium"`.
- Cline: `ask_cline` with `provider: "openai-codex"`, `model: "gpt-5.6-luna"`, and `effort: "medium"`, preserving the operator's existing Cline test configuration.

Claude, Grok, and Cline run through a fresh Frenemy stdio relay process for each individual session. Each transcript therefore contains the complete boundary-visible initialization, tool request, tool response, relay standard error, exit state, selected effort, and timestamps for that session. Codex transcripts retain its complete JSONL event stream and final response. The test does not claim access to hidden reasoning or target-internal events that the current relay does not expose.

## Artifact contract

The run root is `TestResults/<run-id>/four-agent-reasoning/`. The final archive is `TestResults/<run-id>/four-agent-reasoning-review.zip`.

Required contents:

- `manifest.json`: run ID, git head, host, run status, participant targets, requested provider/model/effort, timestamps, tested-source hashes, and relative paths, sizes, and SHA-256 for every retained file. Individual exit states remain in the session transcripts.
- `questions.json`: exact five questions and canonical rubrics.
- `orchestration.jsonl`: every orchestration event in order, including complete prompts, answers, peer-review prompts, peer-review results, failures, and state transitions.
- `sessions/<agent>/<questionId>/answer.jsonl` for all 20 answer sessions.
- `sessions/<agent>/<questionId>/review.jsonl` for all 20 peer-review sessions.
- `answers.json`, `peer-judgments.json`, and `summary.json`.
- The JUnit source report, converted TRX, standard-error logs, and archive-validation receipt.

Each JSONL entry carries `runId`, `questionId`, `phase`, `agent`, `sessionId`, sortable local timestamp, direction, event type, and payload. JSON and JSONL are generated from objects, never handwritten strings.

The archive is finalized in a `finally` path. A failed or interrupted run retains every artifact obtained before failure and an explicit terminal failure record. Missing files, duplicate participant/question/role identities, mismatched hashes, absent medium-effort evidence, or an unreadable ZIP fail the test.

## Implementation phases

### Phase 1: Requirement baseline and exact fixture

1. Re-read `FR-FRENEMY-117`, `TR-FRENEMY-ORCH-121`, `TEST-FRENEMY-117`, and their mapping at implementation start.
2. Verify all five exact question criteria and every operational criterion remain present with `isSatisfied: false`.
3. Add a version-controlled question fixture projected from `AC-TEST-FRENEMY-117-Q01` through `Q05` and a mechanical drift check.

Gate: requirement and mapping readback succeeds, question text and rubric hashes match the fixture, and no product code has changed.

### Phase 2: BDPv4 mock-green gate

Add first:

- `tests/fixtures/four-agent-reasoning-questions.json`.
- `tests/unit/four-agent-reasoning.contract.test.mjs` with class identity `FourAgentReasoningMockTests`.
- Independent scripted answer and review providers that do not call the relay or real CLIs.

The correct fixture must prove 4 participants, 5 questions, 20 answers, 40 sessions, 60 judgments, all medium effort, all peer scores at least 50, and a complete archive manifest.

Negative controls must independently reject:

- missing participant, answer, session, or judgment;
- wrong or duplicated question identity;
- non-medium effort;
- self-review;
- duplicate subject/reviewer pair;
- malformed, non-integer, or out-of-range score;
- a score of 49;
- agent failure, timeout, or empty answer;
- incomplete orchestration JSONL, missing session transcript, manifest mismatch, hash mismatch, or unreadable archive.

Run only the changed mock class through Nuke:

```powershell
.\build.ps1 TestGroups --groups "Frenemy.Relay.UnitTests:FourAgentReasoningMockTests" --test-run-id <yyyyMMddTHHmmss>-four-agent-mock
```

Gate: correct scripted data passes, every deliberate mutation reaches and is rejected by its intended assertion inside a passing suite, and TRX reports 0 failed and 0 skipped. The unit contract uses only deterministic version-controlled fixtures and independent scripted fakes, does not read harvested live data or integration artifacts, and produces the same result whether or not live data exists.

### Phase 3: Live integration binding

Add:

- `tests/integration/four-agent-reasoning.integration.test.mjs` with class identity `FourAgentReasoningIntegrationTests`.
- `tests/integration/four-agent-reasoning.archive.test.mjs` with class identity `FourAgentReasoningArchiveIntegrationTests`.
- Test-side helpers under `tests/contracts/` for the shared fixture, strict peer-judgment validation, archive validation, and process-boundary transcript writing.
- `FourAgentReasoningIntegration` and `VerifyFourAgentReasoningMocks` Nuke targets.
- Nuke parameters for absolute Claude, Codex, Grok, and Cline executables.
- `Invoke-RelayTests.ps1` routing for the new unit and integration class names, environment, TRX conversion, and always-run archive finalization.
- A narrow prompt correction in `tests/native/production-native-qualification.test.mjs`, mapped to `AC-TEST-FRENEMY-115-04`, that asks Cline to preserve the qualification fixture's required LF byte. The exact byte assertion is unchanged, and this is test qualification only, not product behavior.

The live test reuses the same fixture, counts, identities, schema checks, score gate, and archive assertions from Phase 2. It does not weaken an assertion or replace an expected value with live output.

Test inventory and requirement mapping:

- `FourAgentReasoningMockTests` proves the common contract for `AC-TEST-FRENEMY-117-Q01` through `Q05` and `AC-TEST-FRENEMY-117-06` through `08`, including independent negative controls.
- `FourAgentReasoningIntegrationTests` binds the same questions, rubrics, medium-effort configuration, counts, score gate, session evidence, and failure behavior to the current Frenemy and Codex process boundaries.
- `FourAgentReasoningArchiveIntegrationTests` opens and validates the live ZIP bytes, then invokes `assertFourAgentArchiveEvidence` against the independently derived member set, contents, archive hash, external validation receipt, manifest, and current tested-source bytes. It covers `AC-TEST-FRENEMY-117-08`, `AC-FRENEMY-117-04`, and `AC-TR-FRENEMY-ORCH-121-05`.

Before executing modified PowerShell, run the PowerShell parser and PSScriptAnalyzer at Warning and Error severity and fix every finding.

Focused live command:

```powershell
.\build.ps1 FourAgentReasoningIntegration --claude-executable <absolute-path> --codex-executable <absolute-path> --grok-executable <absolute-path> --cline-executable <absolute-path> --test-run-id <yyyyMMddTHHmmss>-four-agent-live
```

Gate: the live run returns 20 answers, 60 distinct peer judgments at 50 or higher, 0 failed and 0 skipped tests, 40 complete session transcripts, a valid TRX, and a mechanically validated ZIP with SHA-256.

### Phase 4: Regression, documentation, and hostile review

1. Run the focused unit and integration classes through Nuke after each related edit.
2. At the final head, run the repository's full applicable Nuke `Validate` target once on the current host, followed by the opt-in live target once at that same head.
3. Update only the directly related test design, validation status, and documentation navigation.
4. Retain commands, executable versions, git head, TRX files, archive path/hash, assertion counts, and all failure output.
5. Send Claude Opus 5.5 high the complete in-scope chat log, plan, requirement readbacks, source, tests, TRX, archive manifest, and validation receipts exactly as produced. Do not redact mistakes or failures. Credentials are excluded by not collecting them.
6. The reviewer reads the supplied evidence and does not build or run tests. Persist the full request/response JSONL and full verdict in the MCP session log.

Gate: overall and task verdicts are AGREE with accuracy at least 98, completeness at least 98, 0 unresolved applicable FAIL, and 0 unresolved applicable UNKNOWN. Only then may the TODO or requirements be marked complete.

Task completion records:

- Task 1 completed at hostile review R3 with AGREE at 99 accuracy and 99 completeness, 7 PASS, 0 FAIL, and 0 UNKNOWN. Receipts: `docs/receipts/hv/20261107T124610-four-agent-reasoning-r3/request.jsonl`, `docs/receipts/hv/20261107T124610-four-agent-reasoning-r3/response.jsonl`, reviewer session-log turn `119971`.
- Task 3 completed at hostile review R5 with AGREE at 98 accuracy and 98 completeness. Receipts: `docs/receipts/hv/20261107T142337-four-agent-reasoning-r5/request.jsonl`, `docs/receipts/hv/20261107T142337-four-agent-reasoning-r5/response.jsonl`, reviewer session-log turn `120007`.
- R8 reopened Task 3 because a failed parallel answer batch retained four transcripts but recorded only the first completed answer and failed session. Task 3 remained open until the repaired harness proved every settled session and orchestration outcome was retained before the batch failure was raised.
- Task 3 completed again at hostile review R12 with AGREE at 98 accuracy and 98 completeness, 7 PASS, 0 FAIL, and 0 UNKNOWN. Receipts: `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/request.jsonl`, `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/response.jsonl`, and `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/verdict.md`.

## Failure and rollback behavior

- A live failure never triggers product changes, authentication changes, retries, provider/model substitution, or host/plugin repair.
- The failing archive is retained for human review and the test returns failure.
- Rollback removes only the newly added four-agent test files and the exact Nuke/PowerShell routing additions, and restores only the prior Cline qualification prompt in `tests/native/production-native-qualification.test.mjs`. Existing Grok/Cline product implementation, configuration, unrelated tests, receipts, and user changes remain untouched.
- The current dirty worktree is preserved. No unrelated file is reset, deleted, moved, committed, or pushed.

## Implementation receipts

- Requirement implementation-start readback: `FR-FRENEMY-117`, `TR-FRENEMY-ORCH-121`, and `TEST-FRENEMY-117` remained pending with every AC unsatisfied; the FR retained both TR and TEST mapping rows.
- Hostile review R1: `docs/receipts/hv/20261107T084900-four-agent-reasoning-r1/` retains the complete unredacted chat, request JSONL, byte-complete response JSONL, verdict, manifest, and requirement readbacks. Claude Opus 5.5 high returned DISAGREE, 80% accuracy, 86% completeness, 4 PASS, 6 FAIL, and 1 UNKNOWN.
- R1 remediation mock gate: `TestResults/20261107T092302-four-agent-remediation-mock-r2/` contains 25 unique tests, all passed, with every negative control reaching its named assertion class.
- A retained failed live run at `TestResults/20261107T093358-four-agent-remediation-live/` completed all 40 external sessions but failed the final retained-session equality assertion. Its archive-integrity receipt incorrectly said `status: passed`; that defect is disclosed and fixed. It is not acceptance evidence.
- Corrected live proof: `TestResults/20261107T094334-four-agent-remediation-live-r2/` passed with 5 questions, 20 answers, 40 unique sessions, 60 unique peer judgments, minimum score 80, 10 retained Codex argv records, 10 observed Cline identity records, and 80 ordered orchestration events.
- Final-head full gate: `TestResults/20261107T095357-four-agent-final-validate-r2/` contains four separately reported lanes: 40 integration, 97 unit, 97 independent-mock, and 7 native qualification executions. Each lane has 0 failed and 0 skipped. The repeated unit and mock lanes are not presented as unique-test totals.
- Final live binding: `TestResults/20261107T100417-four-agent-final-live-r3/` contains 5 questions, 20 answers, 40 unique boundary-visible sessions, and 60 unique peer judgments. Every participant has 10 sessions, every session requests medium effort, the minimum peer score is 80, and the live integration TRX is 1 passed, 0 failed, 0 skipped. Its prerequisite mock TRX is 25 passed, 0 failed, 0 skipped.
- Final human-review archive: `TestResults/20261107T100417-four-agent-final-live-r3/four-agent-reasoning-review.zip`, SHA-256 `11B8A8B4791B583D69B977198C92D3F6EA28D1D27F2BFFE013A3A4DA72413F71`. Mechanical expansion verified 110 members, exact member identity, manifest SHA-256 `90E367E48298D57A47162217200E6C1D20525880217BBA565BBD8C9E7DFB7D04`, member sizes, member hashes, and tested-source hashes.
- Hostile review R2: `docs/receipts/hv/20261107T101454-four-agent-reasoning-r2/` retains the complete unredacted chat, request JSONL, byte-complete response JSONL, and full persisted verdict. Claude Opus 5.5 high returned DISAGREE, 91% accuracy, 91% completeness, 22 PASS, 9 FAIL, and 0 UNKNOWN. The nine failures were: separate live archive assertions, rubric drift not compared with the canonical AC text, missing failed-run reports, validation written before its checks, the historical mock-order statement, conversion-time TRX timestamps, the external store's hardcoded `testType: unit` projection, incorrect or missing executable versions, and the stale claim that every R1 finding was remediated.
- R2 technical remediation mock gate: `TestResults/20261107T110011-four-agent-r2-remediation-mock-r2/` reports 30 passed, 0 failed, and 0 skipped. The common contract now rejects rubric drift, missing tested source bytes, tested-source hash drift, a missing tested-source validation check, and a validation receipt that predates manifest completion.
- Failed-run report retention proof: `TestResults/20261107T121246-four-agent-failed-report-retention-bound/` deliberately supplies a substituted Claude command. The live integration correctly fails before a paid session and retains a one-case JUnit report, timing receipt, and TRX with 1 failed, 0 skipped. Both TRX timestamps exactly match the measured fractional timestamps. The failure archive has status `failed`, and its independent archive integration reports 1 passed, 0 failed, 0 skipped.
- Accepted-head full gate: `TestResults/20261107T121352-four-agent-r2-remediation-accepted-validate/` reports 40 integration, 102 unit, 102 independent-mock, and 7 native qualification executions. Every lane reports 0 failed and 0 skipped.
- Accepted-head live binding: `TestResults/20261107T122301-four-agent-r2-remediation-accepted-live/` reports 30 passed prerequisite mock cases, 1 passed live integration case, and 1 passed archive integration case, with 0 failed and 0 skipped. It retains 5 questions, 20 answers, 40 sessions, 60 judgments, and a minimum accuracy score of 80. The main and archive TRX timestamps exactly match their measured fractional timestamps.
- Accepted human-review archive: `TestResults/20261107T122301-four-agent-r2-remediation-accepted-live/four-agent-reasoning-review.zip`, SHA-256 `0017370F04BF429A1B1B059BB3A604CB3022E1C440A6404C15A1308307608C54`. The external validation receipt records 110 exact members, manifest SHA-256 `B610C5F5362FC947C1DD637500853823F1718924F0D28E36E0ED38821085B73D`, member size and hash checks, and 9 current tested-source hash checks. The manifest records Claude Code 2.1.302, Codex CLI 0.166.0, Grok 1.0.70, and Cline 3.0.74.
- External requirement-store limitation: the repository and requirement title classify `TEST-FRENEMY-117` as integration, but the MCP Server projection hardcodes every TEST record's `testType` as `unit` and exposes no update field for it. This is recorded as external infrastructure metadata, not a Frenemy product or test defect, and it does not alter the repository test classification.
- Deterministic unit-contract correction: `AC-TEST-FRENEMY-117-06` now requires version-controlled fixtures and independent scripted fakes that remain reproducible without harvested live data, external agents, authenticated CLIs, or integration artifacts. `TestResults/20261107T124507-four-agent-deterministic-unit/` reports 30 passed, 0 failed, and 0 skipped through the focused Nuke `TestGroups` target.
- Hostile review R3: `docs/receipts/hv/20261107T124610-four-agent-reasoning-r3/` retains the complete unredacted chat, request JSONL, byte-complete response JSONL, and full persisted verdict. Claude Opus 5.5 high returned DISAGREE, 91% accuracy, 88% completeness, 26 PASS, 7 FAIL, and 1 UNKNOWN. The failures were: trusting receipt-derived ZIP facts and lacking ZIP corruption controls, mocks not exercising actual relay and Codex effort request shapes, missing judgment/session and transcript-completeness controls, missing per-question judgment validation before advancement, incomplete failed-run archive members, accepted evidence preceding the final source edits, and invalid AC references and archive-test mapping. The UNKNOWN was incomplete review of the unredacted chat because the reviewer could not fit lines 1601 through 8299 in its context.
- R3 remediation unit gate: `TestResults/20261107T131140-four-agent-r3-member-set-unit/` reports 73 passed, 0 failed, and 0 skipped. The contract now opens ZIP bytes independently, validates CRC, exact members, content, and source hashes, exercises the actual effort-bearing request shapes, binds judgments to sessions, checks transcript completeness, and validates every question before advancing. Exact member equality is order-independent, with a substitution negative control.
- R3 failed-run retention proof: `TestResults/20261107T131152-four-agent-r3-failed-retention-bound/` deliberately substitutes the Claude executable and fails before any paid session. The retained failure archive contains 11 members, including `questions.json`, `summary.json`, `orchestration.jsonl`, `run-failure.json`, JUnit, timing, and TRX. The main integration reports 1 failed and 0 skipped as expected; the archive integration reports 1 passed, 0 failed, and 0 skipped. Archive SHA-256 is `3A01D2190C7A3FFB9360C5A2C7472B7E59B07FA3B589E59F22598181E2646A3F`; manifest SHA-256 is `EF9F7492BC84C2FCB0A28A6ADB2F7E1972582A87EE36985D607FC60E8014C387`.
- R4-candidate final full gate: `TestResults/20261107T131252-four-agent-r4-final-validate-bound/` reports 40 integration, 145 unit, 145 independent-mock, and 7 native qualification executions. Every lane reports 0 failed and 0 skipped.
- R4-candidate final live binding: `TestResults/20261107T132227-four-agent-r4-final-live/` reports 73 passed prerequisite mock cases, 1 passed live integration case, and 1 passed archive integration case, with 0 failed and 0 skipped. It retains 5 questions, 20 answers, 40 sessions, 60 judgments, and a minimum accuracy score of 80.
- R4-candidate human-review archive: `TestResults/20261107T132227-four-agent-r4-final-live/four-agent-reasoning-review.zip`, SHA-256 `5E30C4C904B07DB6D09F3D8FD8A23729FD1C3C04840ED5478285612A77F8BEF7`. The independent archive validation records 110 exact members, manifest SHA-256 `C3F28BF7DDAAC9590E92321A13D1FA907553440362C999F540BA6C015BFE5F66`, member sizes and hashes, CRC validation, and 10 current tested-source hashes.
- R4 hostile review: `docs/receipts/hv/20261107T133243-four-agent-reasoning-r4/` returned DISAGREE at 93 accuracy and 91 completeness with 29 PASS, 4 FAIL, and 0 UNKNOWN. F-R4-01 found that the per-question gate did not reject invalid judgments or incomplete transcripts before advancing. F-R4-02 found that archive membership still depended on receipt-derived evidence and lacked byte-level member controls. F-R4-03 found that transcripts were not bound to the read-only tool, exact prompt, response id, exit code, or retained result. F-R4-04 found documentation overclaims.
- R4 remediation focused gate: `TestResults/20261107T140052-four-agent-r4-fix-unit-final/` reports 91 passed, 0 failed, and 0 skipped at that historical head. It added judgment and transcript validation, one invalid-Q01 stop control, transcript checks for read-only routing, prompts, response correlation, exit codes and retained results, and ZIP-derived archive evidence. Later R5 and R6 review proved that several transcript, archive, and parser assertion branches still lacked direct negative controls; this historical gate therefore did not establish complete assertion coverage.
- R5-candidate full gate: `TestResults/20261107T140232-four-agent-r5-final-validate-bound/` reports 40 integration, 163 unit, 163 independent-mock, and 7 native qualification executions. Every lane reports 0 failed and 0 skipped.
- R5-candidate deliberate failed run: `TestResults/20261107T141222-four-agent-r5-failed-retention/` reports 91 passed prerequisite mocks, the expected 1 failed and 0 skipped live case before any paid session, and 1 passed archive integration case. The independently validated failed archive has 11 members, ZIP SHA-256 `D868F1D023C714EDA1DEFB743170CAFA2D51260B731181D6BBA5EB9BE7DE6EBE`, and manifest SHA-256 `49F9673816AC8EAD55D4E85560151CDC33DF4A526573AB6E2F8E63102BED6592`.
- R5-candidate final live binding: `TestResults/20261107T141257-four-agent-r5-final-live/` reports 91 passed prerequisite mocks, 1 passed live integration case, and 1 passed archive integration case, all with 0 failed and 0 skipped. It retains 5 questions, 20 answers, 40 sessions, 60 judgments, and minimum accuracy 80. The 110-member archive has ZIP SHA-256 `52D384E3C7B9251D77020CF82769B5C8B22AA410AE7F52BF2CC15C90F99F85BC` and manifest SHA-256 `0C10D8B2FF3EACB9A9100B2DE7170738F289B61A5DD2BB06EA698FD1BCF3402D`, with 10 current tested-source hashes.
- R5 hostile review: `docs/receipts/hv/20261107T142337-four-agent-reasoning-r5/` returned DISAGREE at 97 accuracy and 96 completeness with 36 PASS, 2 FAIL, and 0 UNKNOWN. F-R5-01 identified archive and ZIP-parser branches without direct controls. F-R5-02 identified stale control-coverage wording.
- R5 remediation focused gate: `TestResults/20261107T144355-four-agent-r5-fix-unit/` reports 104 passed, 0 failed, and 0 skipped. It directly covers missing and duplicate manifests, 79 orchestration events, summary count and status mismatches, ZIP central-directory bounds and sizes, truncated central entries, local-entry bounds, unsupported compression, uncompressed-size mismatch, valid failed archives, and deflate parsing.
- R6 hostile review: `docs/receipts/hv/20261107T150423-four-agent-reasoning-r6/` returned DISAGREE at 95 accuracy and 94 completeness with 34 PASS, 5 FAIL, and 0 UNKNOWN. F-R6-01 found sibling assertion branches without direct controls. F-R6-02 found incomplete source change history. F-R6-03 found residual documentation overclaims. F-R6-04 found that an R5 false claim had been deleted instead of retained and labeled. F-R6-05 found stale TODO approval, numbering, and task-completion metadata.
- R6-candidate full gate: `TestResults/20261107T144523-four-agent-r6-final-validate/` reports 40 integration, 176 unit, 176 independent-mock, and 7 native qualification executions, all with 0 failed and 0 skipped.
- R6-candidate deliberate failed run: `TestResults/20261107T145436-four-agent-r6-failed-retention/` reports 104 passed prerequisite mocks, the expected 1 failed and 0 skipped live case before paid execution, and 1 passed archive integration case. The 11-member failed archive has ZIP SHA-256 `A1F01A2652DF9E1C3E27D55FC247BD3412C7C8B31A42F93D61ABDB08A7FAABEF` and manifest SHA-256 `36A7E56ABE4BEB0FC53A2614F0B42D0BC2769BB9282EE4EE438AAF441CFB1CE0`, with 10 current tested-source hashes.
- R6-candidate final live binding: `TestResults/20261107T145452-four-agent-r6-final-live/` reports 104 passed prerequisite mocks, 1 passed live integration case, and 1 passed archive integration case, all with 0 failed and 0 skipped. It retains 5 questions, 20 answers, 40 sessions, 60 judgments, and minimum accuracy 82. The 110-member archive has ZIP SHA-256 `42F9ED1E2048031D0B804E5573E64860FFB203C7F71C65CA571EB57E5B5B2FFF` and manifest SHA-256 `68755FE2D3615BA4971BF2A810C8801660DF0BB1A289BEA6C5B75696DA777CD0`, with 10 current tested-source hashes.
- Retained R6 remediation attempt: `TestResults/20261107T153130-four-agent-r6-remediation-mock/` is not acceptance evidence. Its 124 executions contained 3 failing cases and 0 skipped cases, which led to the corrected follow-up.
- R6 remediation focused gate: `TestResults/20261107T153230-four-agent-r6-remediation-mock-r2/` reports 127 passed, 0 failed, and 0 skipped. It added direct negative controls for the then-identified sibling transcript, result, provider, model, orchestration, per-question, archive-member, ZIP-input, and failed-summary branches, plus a literal-assertion coverage scan. R7 later found six per-question assertion sites and three loader sites that the scan did not prove were reached.
- R7-candidate full gate: `TestResults/20261107T154150-four-agent-r7-final-validate-r3/` reports 40 integration, 199 unit, 199 independent-mock, and 7 native qualification executions, all with 0 failed and 0 skipped. An earlier full-gate attempt observed that Cline editor qualification did not preserve the required LF byte. The prompt was strengthened without weakening the exact-byte assertion, and the final gate recorded one successful observation; it does not by itself prove deterministic external CLI behavior.
- R7-candidate deliberate failed run: `TestResults/20261107T160318-four-agent-r7-failed-retention/` reports 127 passed prerequisite mocks, the expected 1 failed and 0 skipped live case before paid execution, and 1 passed archive integration case. The 11-member failed archive has ZIP SHA-256 `5BC53801829633DB04F26ACF93DEECFCC8F58191F0B0B5DD9C6087069746B63E` and manifest SHA-256 `218618DD3F65BFABA3854487D14C66E2C0562A5E378793168378C747097EA2A4`; independent validation confirms its exact member set and 10 current tested-source hashes.
- R7-candidate final live binding: `TestResults/20261107T155130-four-agent-r7-final-live/` reports 127 passed prerequisite mocks, 1 passed live integration case, and 1 passed archive integration case, all with 0 failed and 0 skipped. It retains 5 questions, 20 answers, 40 sessions, 60 judgments, and minimum accuracy 79. The 110-member archive has ZIP SHA-256 `F0F24270B597AD9CB4A14E4B53334A6B25688FE435CCAEBB0056F60BFCA14B5B` and manifest SHA-256 `375168CB369A1530AF3C7258EF0ACC966DA2167050B8B91A12DBF84BD7C3C264`, with 10 current tested-source hashes.
- R7 hostile review: `docs/receipts/hv/20261107T160539-four-agent-reasoning-r7/` returned DISAGREE at 95 accuracy and 95 completeness with 39 PASS, 4 FAIL, and 0 UNKNOWN. F-R7-01 found assertion-reachability gaps. F-R7-02 found that the R6 self-review had overwritten original claims. F-R7-03 found stale Task 1 completion provenance and missing plan task-completion records. F-R7-04 found documentation overclaims and an omitted native-test file boundary.
- R7 remediation focused gate: `TestResults/20261107T163954-four-agent-r7-remediation-mock-r3/` reports 133 passed, 0 failed, and 0 skipped. The six Q01 branch controls prove Q02 is not requested and the three fixture-loader controls reach their exact assertion messages. R8 later found that 24 ZIP and archive assertion sites were still accepted by fixed message patterns instead of executed controls, so this historical receipt did not establish complete assertion reachability.
- R8-candidate full gate: `TestResults/20261107T164335-four-agent-r8-final-validate/` reports 40 integration, 205 unit, 205 independent-mock, and 7 native qualification executions, all with 0 failed and 0 skipped.
- Retained non-acceptance failure attempt: `TestResults/20261107T165307-four-agent-r8-failed-retention/` deliberately misbound the Codex executable and caused one Q01 answer round to start before failing. R8 showed that this archive exposed a real harness defect: all four answer transcripts were retained, but only one completed answer and one failed session were recorded in orchestration and summary evidence.
- R8-candidate deliberate failure retention: `TestResults/20261107T165430-four-agent-r8-failed-retention-r2/` reports 133 passed prerequisite mocks, the expected live result of 0 passed, 1 failed, and 0 skipped before any external session started, plus 1 passed archive integration case. The independently validated 11-member failed archive has ZIP SHA-256 `62DB103A41F6778F22F20C9048E2880A85662966622D083F7C6C41521AB563DD`, manifest SHA-256 `5A8ABF8A87FF816222DF00A5C52584676CE9594696AF05994451427E9C76F16F`, and 10 current tested-source hashes.
- R8-candidate final live binding: `TestResults/20261107T165452-four-agent-r8-final-live/` reports 133 passed prerequisite mocks, 1 passed live integration case, and 1 passed archive integration case, all with 0 failed and 0 skipped. It retains 5 questions, 20 answers, 40 sessions, 60 judgments, and minimum accuracy 79. The independently validated 110-member archive has ZIP SHA-256 `0B14AF3EFE2B19ACEDC87A7B4BC6F855BF51D4ACD56EE328777E713DEB96F6CB`, manifest SHA-256 `956352A5DC4D67E155F7DF783287C9542820083209A45CA914E12FDD0F06AD69`, and 10 current tested-source hashes.
- R8 hostile review: `docs/receipts/hv/20261107T170539-four-agent-reasoning-r8/` returned DISAGREE at 95 accuracy and 95 completeness with 42 PASS, 5 FAIL, and 0 UNKNOWN. It found pattern-only assertion controls, three related documentation overclaims, one undated post-R6 receipt insertion, one chat timestamp and punctuation defect, and the failed parallel-session retention regression that reopened Task 3.
- R8 remediation focused gate: `TestResults/20261107T175945-four-agent-r8-remediation-mock-r2/` reports 137 passed, 0 failed, and 0 skipped. R9 later found that nine cross-site message pairs still let one observed failure cover another source occurrence, so this historical receipt did not prove site-unique one-for-one controls.
- R9 full Nuke gate: `TestResults/20261107T180514-four-agent-r9-final-validate-r3/` reports 40 integration, 209 unit, 209 independent-mock, and 7 native qualification executions, all with 0 failed and 0 skipped. The earlier `180223` and `180252` attempts are retained as non-acceptance runs because they omitted Grok from native qualification and supplied the Cline command shim instead of its native executable, respectively.
- Retained R9 failure-fixture mistake: `TestResults/20261107T181543-four-agent-r9-partial-failure/` reached four Q01 sessions, but `cmd.exe --version` waited for input and prevented archive finalization. The task-owned child process was stopped. This run is retained as non-acceptance evidence and is not used to prove failed-run archival.
- R9 deliberate partial-session failure: `TestResults/20261107T182618-four-agent-r9-partial-failure-r2/` reports 137 passed prerequisite mocks, the expected live result of 0 passed, 1 failed, and 0 skipped after all four Q01 answer sessions settled, plus 1 passed archive integration case. The failed run retains 4 session records, 4 transcripts, 4 requests, 4 responses, 1 internal failure event, 3 completed answers, 1 failed session, and 0 judgments. Its independently validated 20-file archive has ZIP SHA-256 `4925EC9DF114015405D3BCB7DBB0F3B8024BD74DAEC10F29760472B7DF2D8DE8` and manifest SHA-256 `7E726BFA704467496994E316EEAAB768BEF7F58AB12B838D90230025A8D40A4D`.
- R9 final live binding: `TestResults/20261107T182843-four-agent-r9-final-live/` reports 137 passed prerequisite mocks, 1 passed live integration case, and 1 passed archive integration case, all with 0 failed and 0 skipped. It retains 5 questions, 20 answers, 40 sessions and transcripts, 60 judgments, and minimum accuracy 81. The independently validated 110-file archive has ZIP SHA-256 `98BDBF9DE6BC114340A62AA598137A6ECA35E39F6512881B202A08AFC0BBE2D1`, manifest SHA-256 `348D812A8724DEFFE250F4EAA670BAE566B4B572701193726E58027078BB917C`, and 10 current tested-source hashes.
- R9 hostile review: `docs/receipts/hv/20261107T183919-four-agent-reasoning-r9/` returned DISAGREE at 95 accuracy and 94 completeness with 44 PASS, 5 FAIL, and 0 UNKNOWN. The full verdict is retained unchanged.
- R9 remediation focused gate: `TestResults/20261107T190800-four-agent-r9-remediation-mock-r2/` reports 139 passed, 0 failed, and 0 skipped after source-site messages and executed controls were made unambiguous.
- R9 version-probe failure proof: `TestResults/20261107T190900-four-agent-r9-version-failure/` reports 139 passed prerequisite mocks, the expected live result of 0 passed, 1 failed, and 0 skipped, plus 1 passed archive integration case. The finalizer retained explicit `--version` error evidence and produced a validated 20-file failed archive with ZIP SHA-256 `7715026FE02976CFDA46EAC7C160884905B93E0D8612A8F7DB09A03282099B65` and manifest SHA-256 `9123AC26ED9D7491D747A4272F044E3C7E582DF796F11C1AA818EBEECC5B2D1B`.
- R9 review-parse failure proof: `TestResults/20261107T191100-four-agent-r9-review-failure/` reports 139 passed prerequisite mocks, the expected live result of 0 passed, 1 failed, and 0 skipped, plus 1 passed archive integration case. It retains all 8 Q01 sessions and transcripts, 4 answers, 3 successful review results, 1 review failure, and 9 judgments. The validated 31-file failed archive has ZIP SHA-256 `DFECDAB016F093002CE373D41E7AF8D462E308AF8D8C271B038F9A4A42EE665C` and manifest SHA-256 `03282D5B93DC3F9098CE62D7B54C4ED2631B51617599296E866D6A3280875A75`.
- R9 current-head full gate: `TestResults/20261107T191700-four-agent-r9-final-validate-r2/` reports 40 integration, 211 unit, 211 independent-mock, and 7 native qualification executions, all with 0 failed and 0 skipped. The preceding `191200` attempt is retained as non-acceptance evidence because Cline omitted the required LF byte.
- R9 current-head live binding: `TestResults/20261107T192600-four-agent-r9-final-live/` reports 139 passed prerequisite mocks, 1 passed live integration case, and 1 passed archive integration case, all with 0 failed and 0 skipped. It retains 5 questions, 20 answers, 40 sessions and transcripts, 60 judgments, and minimum accuracy 84. The validated 110-file archive has ZIP SHA-256 `4EFCB50435CF29463E6E474B561C24845D2F2E7B1046555F580DE2C1C29B01CD` and manifest SHA-256 `9C8C2449C10483B1A61421AF85E89FF05024633D71297878A41C2087CA27E21F`.
- R10 hostile review: `docs/receipts/hv/20261107T193400-four-agent-reasoning-r10/` returned DISAGREE at 96 accuracy and 95 completeness with 46 PASS, 5 FAIL, and 0 UNKNOWN. It found overwritten historical statements, six assertion sites lacking direct controls, one missing-session-metadata retention hole, stale TODO evidence, and undocumented deliberate-failure seams and commands.
- R10 remediation focused gate: `TestResults/20261107T200421-four-agent-r10-remediation-mock/` reports 141 passed, 0 failed, and 0 skipped.
- R10 missing-session-metadata proof: `TestResults/20261107T200437-four-agent-r10-missing-session-metadata/` reports 141 passed prerequisite mocks, the expected live result of 0 passed, 1 failed, and 0 skipped, plus 1 passed archive integration case. It retains 4 sessions and transcripts, including 1 synthesized failed Codex session, and 1 answer-failure event. The validated 20-file archive has ZIP SHA-256 `3C7A6276AE54ED61CB4CF24BE019023A88C6D935E550A92F441071DD73EB2E57` and manifest SHA-256 `AEB0ECD618B90E5750E6799897EFC36BF08EF723E48D4D87827AC69B757E3B5F`.
- R10 current-head full gate: `TestResults/20261107T200628-four-agent-r10-final-validate/` reports 40 integration, 213 unit, 213 independent-mock, and 7 native qualification executions, all with 0 failed and 0 skipped.
- R10 current-head live binding: `TestResults/20261107T201715-four-agent-r10-final-live/` reports 141 passed prerequisite mocks, 1 passed live integration case, and 1 passed archive integration case, all with 0 failed and 0 skipped. It retains 5 questions, 20 answers, 40 sessions and transcripts, 60 judgments, and minimum accuracy 83. The validated 110-file archive has ZIP SHA-256 `99561836659E39DDAC39D87409D9E6EE9DE6098EFE8A55317292BF7219DC693B` and manifest SHA-256 `283AAF32A546003167DE329D639A35277A0997B950272EF037AB5113DECB3A9B`.
- An accidental `build.ps1 --help` invocation ran the default `VerifyMocks` target and is retained at `TestResults/20261107T200558/` with 213 passed, 0 failed, and 0 skipped. It is disclosed as unplanned extra evidence and is not used as acceptance evidence.
- R12 hostile review: `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/` returned DISAGREE at 95 accuracy and 94 completeness with 29 PASS, 5 FAIL, and 0 UNKNOWN. Task 1 had no regression. Task 3 cleared AGREE at 98/98. Task 2 failed on 14 reachable assertion sites without direct controls and on untracked test artifacts. Task 4 failed on append-only correction order, stale TODO wording, and two inaccurate R11 claims.
- R12 direct-control remediation focused gate: `TestResults/20261109T045102-four-agent-r12-direct-controls/` reports 155 passed, 0 failed, and 0 skipped.
- Version-control repair: `48bb179409f92693fc8bf47a382aaf3bf930d37d` commits the approved Grok/Cline relay implementation and removes the withdrawn job-service requirements and diagrams. `86402e4e64e3d06183f16a3323401c014e99fc2f` commits the deterministic fixtures, contracts, unit tests, integration tests, plan, requirement projection, and R12 remediation receipts. The R12 raw response remains unredacted locally for review; the public repository copy replaces only the workspace API key and records both hashes in `response.public-manifest.json`.
- Committed-source validation: `TestResults/20261109T073120-four-agent-r12-committed-validate/` reports 40/40 integration, 227/227 unit, and 227/227 independent-mock executions passed with 0 failed and 0 skipped. Native Q02 Cline passed. Native Q01 Grok reached the installed CLI and failed only because the external service returned HTTP 402 `Grok Build usage balance exhausted`; this run is retained as non-acceptance evidence and is not represented as a green full gate. The last complete native gate remains `TestResults/20261107T200628-four-agent-r10-final-validate/` with 7/7 native qualification executions passed, and R12 found no Task 1 regression.
- Remaining gate: commit this status correction, run the final-head deterministic unit and integration lanes, verify all source hashes and retained receipts, and run one independent review only after local readiness is complete. Completion requires OverallVerdict AGREE and every adjudicated task verdict AGREE, each with accuracy and completeness at least 98 and no unresolved applicable FAIL or UNKNOWN. Tasks 2 and 4 are open; Tasks 1 and 3 are completed.

## Test-only deliberate-failure controls

- `FRENEMY_FOUR_AGENT_FORCE_REVIEW_PARSE_FAILURE_AGENT` replaces the named reviewer's successful response text with invalid JSON immediately before parsing. This proves that all settled review sessions and outcomes are retained before rejection. No Nuke target sets this variable.
- `FRENEMY_FOUR_AGENT_FORCE_SESSION_METADATA_FAILURE_AGENT` rejects the named participant promise without attaching `.session` metadata. This proves that the harness synthesizes and archives a failed session, transcript, stderr record, and orchestration failure before rejection. No Nuke target sets this variable.
- The R9 version-probe failure command was:

```powershell
Remove-Item Env:FRENEMY_FOUR_AGENT_FORCE_REVIEW_PARSE_FAILURE_AGENT -ErrorAction SilentlyContinue
.\build.ps1 FourAgentReasoningIntegration --claude-executable 'C:\Users\kingd\AppData\Local\Microsoft\WinGet\Links\claude.exe' --codex-executable 'C:\Windows\System32\where.exe' --grok-executable 'C:\Users\kingd\.grok\bin\grok.exe' --cline-executable 'C:\nvm4w\nodejs\node_modules\cline\node_modules\@cline\cli-windows-x64\bin\cline.exe' --test-run-id '20261107T190900-four-agent-r9-version-failure'
```

- The R9 review-parse failure command was:

```powershell
$env:FRENEMY_FOUR_AGENT_FORCE_REVIEW_PARSE_FAILURE_AGENT='claude'
try {
  .\build.ps1 FourAgentReasoningIntegration --claude-executable 'C:\Users\kingd\AppData\Local\Microsoft\WinGet\Links\claude.exe' --codex-executable 'C:\Users\kingd\AppData\Local\Microsoft\WinGet\Links\codex.exe' --grok-executable 'C:\Users\kingd\.grok\bin\grok.exe' --cline-executable 'C:\nvm4w\nodejs\node_modules\cline\node_modules\@cline\cli-windows-x64\bin\cline.exe' --test-run-id '20261107T191100-four-agent-r9-review-failure'
}
finally {
  Remove-Item Env:FRENEMY_FOUR_AGENT_FORCE_REVIEW_PARSE_FAILURE_AGENT -ErrorAction SilentlyContinue
}
```


- The R10 missing-session-metadata failure command and retained receipt are:

```powershell
$env:FRENEMY_FOUR_AGENT_FORCE_SESSION_METADATA_FAILURE_AGENT='codex'
try {
  .\build.ps1 FourAgentReasoningIntegration --claude-executable 'C:\Users\kingd\AppData\Local\Microsoft\WinGet\Links\claude.exe' --codex-executable 'C:\Users\kingd\AppData\Local\Microsoft\WinGet\Links\codex.exe' --grok-executable 'C:\Users\kingd\.grok\bin\grok.exe' --cline-executable 'C:\nvm4w\nodejs\node_modules\cline\node_modules\@cline\cli-windows-x64\bin\cline.exe' --test-run-id '20261107T200437-four-agent-r10-missing-session-metadata'
}
finally {
  Remove-Item Env:FRENEMY_FOUR_AGENT_FORCE_SESSION_METADATA_FAILURE_AGENT -ErrorAction SilentlyContinue
}
```

The expected live result was 0 passed, 1 failed, and 0 skipped after all four Q01 answer settlements. Archive validation passed. The retained archive contains 4 sessions, 4 transcripts, 4 requests, 4 responses, 1 synthesized failed Codex session, and 1 answer-failure event. Its 20-file ZIP SHA-256 is `3C7A6276AE54ED61CB4CF24BE019023A88C6D935E550A92F441071DD73EB2E57`; manifest SHA-256 is `AEB0ECD618B90E5750E6799897EFC36BF08EF723E48D4D87827AC69B757E3B5F`.
## Approval boundary

Approval authorizes only the files and behaviors named above, including the narrow `tests/native/production-native-qualification.test.mjs` prompt correction mapped to `AC-TEST-FRENEMY-115-04`. It does not authorize running the 40 live agent sessions until the mock gate is green, nor any relay product change discovered while implementing the test. Any such product change returns to the operator as a requirement and plan amendment.
