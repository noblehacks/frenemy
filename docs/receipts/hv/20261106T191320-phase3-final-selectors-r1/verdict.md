[response-timestamp 2026-11-06 19:21]

Chat hunt confirms mechanical findings: the one material design defect (Cline provider/model via argv) is disclosed-and-corrected, with no post-correction reassertion. The file-level checks the hunt flags as my exposure, I already verified directly in source (`ask-claude-mcp.mjs:640-646`, contract line 34, test-design R04). Native Q02's dependence on operator OAuth state is out-of-scope per mandate and the retained receipts are sufficient. Rendering the verdict.

---

# Independent Hostile Validation: Frenemy Phase 3 Final Head

## 1. Reviewer model and effort
Model `claude-opus-4-8` (Opus 4.8). Effort: high. Read-only; no files edited, no builds, no tests rerun.

## 2. Scope statement
Reviewed only the authorized product change: Grok Build and Cline CLI support in the current JS stdio relay, plus the approved execution-selector amendment. In scope: the four new relay tools, optional provider/model/effort selectors, `frenemy.config.json` + schema, the Windows Grok ACL helper, JS tests, Nuke/PowerShell orchestration, directly related docs, `support-only` C4, and receipts. Out of scope (not used as grounds for any finding): workstation/account state, plugins, client registration, QBrain, job lifecycle, scheduler, durable storage, worktrees, installers, C# product/tests, audit delivery. Assessed the current final head, not superseded designs.

## 3. Requirement-by-requirement matrix

| ID | Disposition | Evidence |
|---|---|---|
| FR-FRENEMY-113 (arch source accuracy/trace) | PASS | `docs/architecture/structurizr/support-only/code/target-relay.puml`; render receipt `renders/20261106T184320/receipt.json` (validate/export/render all exit 0) |
| FR-FRENEMY-114 (new tools + native calls) | PASS | `ask-claude-mcp.mjs:294-331,500-586,640-774`; integration R01-R05 + native Q01/Q02 (`tests/integration/relay.contract.test.mjs`, `tests/native/production-native-qualification.test.mjs`) |
| FR-FRENEMY-115 (compatibility/host validation) | PASS | R06 asserts unchanged `install.ps1/install.sh/CLAUDE-codex-section.md/genimg.sh`; Claude argv pinned (`relay-contract.mjs:270-278`) |
| FR-FRENEMY-116 (execution selectors) | PASS | R07 proven on real relay: caller>config>native precedence, 34 invalid selectors reject with 0 discovery/0 spawn (`relay.contract.test.mjs:441-622`) |
| TR-FRENEMY-ARCH-117 (reproducible render) | PASS | receipt.json pinned PlantUML 1.2026.9 / Structurizr 2026.09.19 / JDK 21.0.13, all commands exit 0, file hashes recorded |
| TR-FRENEMY-ADAPTER-118 (native binding) | PASS | Grok argv R03 (`ask-claude-mcp.mjs:500-511`), Cline ACP R04 (`:640-763`); `shell:false` on every spawn |
| TR-FRENEMY-CONFIG-120 (config + schema) | PASS | `frenemy.config.json`, `frenemy.config.schema.json` (draft 2020-12, `additionalProperties:false`), 7 invalid-config cases reject pre-launch (`relay.contract.test.mjs:530-548`) |
| TEST-FRENEMY-113 (A01) | PASS | render receipt + C4 target views scoped to relay/ACL/helper/deployment; no job/plugin/QBrain elements |
| TEST-FRENEMY-114 | PASS | integration + native TRX green; `tests/native/*` drive real product + real CLIs |
| TEST-FRENEMY-115 | PASS | R06 compatibility + Q01/Q02 host qualification green |
| TEST-FRENEMY-116 | PASS | independent mock gate (`mock-relay-provider.mjs`) + production binding R07; counts and hashes verified |

Final-head counts verified in-TRX: integration 40, unit 72, independent-mock 72, native 7; all `failed=0 … notExecuted=0`. All five `validation.md` SHA-256 values match the on-disk artifacts byte-for-byte.

## 4. Fixed task list (Phase 3 amendment BDPv4 sequence)

| # | Task | State | Disposition | Score |
|---|---|---|---|---|
| 1 | Update contract/test-design with FR-116/TR-120/TEST-116 + precedence | Done | PASS | 100% |
| 2 | Extend contract fixture + mock tests first (schemas, domains, precedence, argv, isolation, invalid config/input, native rejection) | Done | PASS | 100% |
| 3 | Negative mutations; green mock gate before product edits | Done | PASS (72 independent-mock) | 100% |
| 4 | Add two JSON files + implement config load/validate, selector resolution, schema changes, agent-specific process-input mapping | Done | PASS | 100% |
| 5 | Bind cases through MCP entry in integration tests | Done | PASS (40) | 100% |
| 6 | Extend Q02 with openai-codex/gpt-5.6-luna/high; require observed identity match | Done | PASS (4 sessions observed) | 100% |
| 7 | Update contract, test design, use cases, README, validation, C4, nav | Done | PASS | 99% |
| 8 | Run full Phase 3 gate at final head; retain TRX/host/hash/identity receipts | Done | PASS | 100% |

## 5. Findings (ordered by severity)

No blocking findings. Three non-blocking observations:

- **N1 (minor, test-coverage).** In-process parent-environment non-mutation is proven only indirectly: the integration check (`relay.contract.test.mjs:608-610`) compares the *test* process env across a process boundary, and the mock asserts it as a literal. The actual guarantee rests on source inspection (`ask-claude-mcp.mjs:643` `const env = { ...process.env }`, mutating only the copy). Correct, but no in-process assertion directly observes the relay leaving its own `process.env` unmutated. Minimal repair: add a unit assertion that `runClineAcp` does not add `CLINE_PROVIDER`/`CLINE_MODEL` to the relay's own `process.env`.
- **N2 (minor, docs).** `validation.md` labels two distinct green TRX as "72 unit" and "72 independent-mock"; both are `Frenemy.Relay.UnitTests` with identical totals but different SHA-256. Correct and both verified, but the identical count invites conflation. Minimal repair: note in `validation.md` that the independent-mock gate is the `VerifyMocks`/`RelayContractMockTests` subset and the unit lane is `TestUnitRelay`.
- **N3 (minor, robustness).** When a call supplies both an invalid prompt and an invalid selector, the selector error returns first (`handle` resolves selectors at `:840` before the grok/cline prompt guard at `:852`). No contract case pins this ordering. Non-blocking; optionally add a case fixing the precedence.

## 6. Regression analysis against disclosed earlier failures

- **Cline selector mapping (the one material defect).** First recorded wrong as `--provider`/`--model` argv flags, carried into the approved plan, then corrected after reading Cline 3.0.74 source: ACP reads `CLINE_PROVIDER`/`CLINE_MODEL` from the environment and ignores those argv flags; only `--thinking` is forwarded. Current head does not regress: `ask-claude-mcp.mjs:287` maps Cline to `{ effort: "--thinking" }` only; `:644-645` sets the two env vars on a copied child env; the contract (line 34), test-design (R04), C4 `target-relay.puml:29-30`, and the R07 binding all encode the corrected mapping. The live requirement readback cited in the review prompt confirms the store-side correction.
- **Grok explicit Edit/Write allow rules.** Earlier omission disclosed in the fixture change log; current write argv includes `--allow Edit --allow Write` (`ask-claude-mcp.mjs:503`), matched by R03.
- **R07 collector bug (42/1) and the stale test-side Cline qualifier.** Both disclosed, fixed, and re-run green; final head shows 0 failures.
- **Scope drift (job runtime, plugin/QBrain/worktree/installer chains).** Removed; the current `support-only` C4 and `target-relay.puml` contain none of it.
- **QBrain/live UC persistence failures.** Represented honestly: disclosed with the exact store errors, queued to the supported failsafe, never claimed saved without readback; the one "12 UCs rejected" overstatement was self-corrected. QBrain is out of scope and does not affect product correctness.
- **Native Q02 OAuth dependence.** The green depends on operator-workstation authentication, which is out of scope; the retained identity receipt + TRX are sufficient evidence per the mandate and are not grounds for DISAGREE.

No disclosed failure is still regressed or misrepresented in the current artifacts.

## 7. Accuracy and completeness
Accuracy 99%. Completeness 99%. Zero applicable FAIL, zero UNKNOWN; three minor non-blocking observations.

## 8. Final verdict
**AGREE.** The authorized product scope is implemented correctly and is faithfully bound to evidence. Source matches the contract and the corrected Cline mapping; selector precedence, validation-before-launch, no shell interpolation, parent-environment preservation, permission boundaries, error categories, and compatibility are all proven against the real relay. The C4 is accurate, traceability holds, and every cited final-head receipt (counts and SHA-256) verifies against the on-disk artifacts.

`=== VERDICT JSON ===`

`{"verdict":"AGREE","accuracy":99,"completeness":99,"pass":30,"fail":0,"unknown":0,"blocking_findings":[],"nonblocking_findings":["N1: in-process parent-env non-mutation proven by source inspection, not a direct in-process assertion","N2: validation.md labels two distinct 72-case TRX as unit vs independent-mock without noting the VerifyMocks/TestUnitRelay split","N3: prompt+selector both-invalid error ordering is unpinned by any contract case"],"model":"claude-opus-4-8","effort":"high"}`
