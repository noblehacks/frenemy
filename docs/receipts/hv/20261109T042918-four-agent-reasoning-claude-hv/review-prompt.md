# PLAN-FRENEMY-002 hostile re-review through Claude Code

You are the independent hostile reviewer running through normal Claude Code. The operator explicitly selected Claude Code with model `claude-opus-5-5` and `high` reasoning effort.

Before reviewing, execute the complete add-profile workflow. Load the full operator profile, all applicable Global and Workspace MCP memories except `MEMORY-PROCESS-007`, and the workspace marker. State the loaded counts and marker result.

Create your own MCP session and session-log turn for this review when that infrastructure is available. Persist the complete final verdict, read it back, and verify byte or SHA-256 equality. Persistence infrastructure failure must be reported separately and must not change the substantive verdict when the required review evidence is available.

Stay read-only. Do not edit files, run tests, build, launch agents or subagents, change requirements, update the TODO, commit, or push. Existing receipts are evidence only. Independently inspect their content and source. Provide measured local progress updates with percentage and ETA in the retained response stream. Review time and output size are unbounded. Stop only if the response stream has no update for more than 30 minutes.

## Exact scope

The only product feature scope is Grok Build and Cline CLI support in the existing JavaScript Frenemy server. The current plan increment is test-only: the four existing agents answer the five requirement-defined questions at medium effort, each answer is judged by the other three agents and must score at least 50 percent, and the orchestration plus every individual session is retained in a human-review archive.

Do not introduce, require, or review unrelated services, job systems, schedulers, installers, plugins, workstation configuration, authentication changes, or C# tests. The operator's environment and plugins are not product scope. Infrastructure failures are recorded separately and do not become product findings unless they prevent access to evidence required for a named criterion.

Thorough testing, negative controls, evidence validation, clean receipts, and accurate documentation are required within the approved scope. Do not convert testing rigor into a new product requirement.

## Task state and change under review

- Task 1: completed under R3 at 99/99. Review for regression only because `TEST-FRENEMY-117` remains in flux.
- Task 2: open. Fully adjudicate the deterministic independent-mock and negative-control contract.
- Task 3: open. Fully adjudicate the live four-agent binding and human-review archive, including the previously reopened `REG-R8-01` failure-retention class.
- Task 4: open. Fully adjudicate regression evidence, documentation, TODO currency, transparency, and this final hostile-review package.

The substantive change under review is only the remediation of `F-R10-01` through `F-R10-05` and the current-head evidence generated after those repairs. Prior Claude, Grok, and Cline attempts that ended for usage or credit infrastructure reasons before a verdict are not substantive review results. Do not use any partial reasoning stream as independent evidence or as a substitute for your review.

## Required review

1. Recheck every R10 finding `F-R10-01` through `F-R10-05` against the current source, historical receipts, current receipts, authoritative TODO, live requirement readback, and complete unredacted chat.
2. Perform a sibling search within the exact test-only scope. Do not add new product requirements.
3. Build and return the required matrix of every task, its requirements, the requirements in flux, and the changes under review.
4. Check Task 1 for regression only. Fully adjudicate Tasks 2, 3, and 4 separately.
5. Verify unit tests are deterministic, version-controlled, independent of harvested live data, and reproducible whether or not live data exists.
6. Verify each relevant assertion site has a real direct negative control or a technically correct and specific reason why a direct mutation cannot change the asserted result.
7. Verify all four answer settlements are retained when a participant rejection lacks `.session` metadata, including the synthesized failure artifacts.
8. Verify both deliberate-failure seams are test-only, documented, absent from Nuke configuration, and supported by exact reproduction commands and retained evidence.
9. Verify the current full gate and current live archive, including report counts, source hashes, archive member count, answer and judgment counts, and minimum accuracy.
10. Verify the earlier R8 and R9 self-review text was restored and corrections are append-only.
11. Verify the TODO readback is current and that no open task or requirement is prematurely marked complete.
12. Read the complete unredacted chat evidence. The current raw Codex session JSONL is byte-for-byte copied at launch and is authoritative for the latest messages. The earlier formatted Markdown and chunk manifest are navigation aids. Treat the chat as evidence of implementer mistakes and operator corrections. Do not assume an implementer claim is true because it appears in chat.

## Required evidence

- `docs/plans/four-agent-reasoning-integration.md`
- `docs/testing/validation.md`
- `docs/receipts/hv/20261107T193400-four-agent-reasoning-r10/verdict.md`
- `docs/receipts/hv/20261107T193400-four-agent-reasoning-r10/request.jsonl`
- `docs/receipts/hv/20261107T193400-four-agent-reasoning-r10/response.jsonl`
- `docs/receipts/hv/20261107T203051-four-agent-reasoning-r11/pre-hv-self-review.md`
- `docs/receipts/hv/20261107T234831-four-agent-reasoning-grok-hv/pre-hv-readiness.md`
- `docs/receipts/hv/20261107T234831-four-agent-reasoning-grok-hv/requirement-readbacks.json`
- `docs/receipts/hv/20261107T234831-four-agent-reasoning-grok-hv/visible-chat-unredacted-complete.md`
- `docs/receipts/hv/20261107T234831-four-agent-reasoning-grok-hv/visible-chat-chunks/chat-chunks-manifest.json` and every chunk in order
- `docs/receipts/hv/20261108T214204-four-agent-reasoning-cline-hv/infrastructure-interruption-retry1.md`
- `docs/receipts/hv/20261108T214204-four-agent-reasoning-cline-hv/response-retry1.jsonl`, as transparency evidence only, not a verdict
- `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/visible-chat-unredacted-current-session.jsonl`
- `docs/receipts/hv/20261109T042918-four-agent-reasoning-claude-hv/pre-hv-readiness.json`
- `tests/contracts/four-agent-reasoning.mjs`
- `tests/unit/four-agent-reasoning.contract.test.mjs`
- `tests/integration/four-agent-reasoning.integration.test.mjs`
- `tests/integration/four-agent-reasoning.archive.test.mjs`
- `build/Invoke-RelayTests.ps1`
- `TestResults/20261107T200421-four-agent-r10-remediation-mock/`
- `TestResults/20261107T200437-four-agent-r10-missing-session-metadata/`
- `TestResults/20261107T200558/`, disclosed as unplanned extra evidence only
- `TestResults/20261107T200628-four-agent-r10-final-validate/`
- `TestResults/20261107T201715-four-agent-r10-final-live/`
- Live MCP requirements and live `PLAN-FRENEMY-002` TODO state when available

The focused TRX is at `TestResults/20261107T200421-four-agent-r10-remediation-mock/groups/Frenemy.Relay.UnitTests/Frenemy.Relay.UnitTests.trx`.

## Final response contract

Return all of the following:

- `OverallVerdict`: `AGREE` or `DISAGREE`.
- Overall accuracy and completeness percentages.
- PASS, FAIL, and UNKNOWN counts.
- A requirements and acceptance-criteria matrix with evidence citations.
- Task 1 regression result with PASS/FAIL/UNKNOWN counts, plus separate Task 2, Task 3, and Task 4 verdicts with accuracy, completeness, and PASS/FAIL/UNKNOWN counts.
- Disposition of every R10 finding and every sibling found.
- Every applicable FAIL and UNKNOWN with exact file, line, failure scenario, requirement impact, and repair.
- Every regression, or an explicit statement that no regression was found.
- Model, effort, Claude Code session ID, MCP session ID, request ID, turn ID, persistence readback result, and receipt paths.
- A final machine-readable JSON object containing the same result.

AGREE is permitted only when overall and every required task accuracy and completeness are at least 98, all applicable criteria have real dispositions, and unresolved applicable FAIL and UNKNOWN counts are both zero. Passing test counts do not substitute for semantic proof.
