# Technical Requirements (QBrain.AI)

## TR-FRENEMY-ADAPTER-118

**Native CLI adapters in the existing MCP relay** — Implement only the four tool entries, native invocation, prompt/result handling and mode controls in docs/contracts/grok-cline-support.md. FR114/115 and TEST114/115.
**Covered by:** FR: FR-FRENEMY-114, FR-FRENEMY-115; TEST: TEST-FRENEMY-114, TEST-FRENEMY-115
**Status:** completed
Scope: layer-1+

## TR-FRENEMY-ARCH-001

**Dependency-free relay and headless Claude invocation** — Implement the baseline relay in ask-claude-mcp.mjs with no package dependencies and expose ask_claude and ask_claude_write backed by claude -p rather than claude mcp serve.
**Covered by:** FR: FR-FRENEMY-001, FR-FRENEMY-002, FR-FRENEMY-007
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-ARCH-117

**Render source-pinned C4 for the limited integration** — Keep source-pinned baseline and current relay target separate; validate and render the four C4 levels with change traceability. FR113 and TEST113.
**Covered by:** FR: FR-FRENEMY-113; TEST: TEST-FRENEMY-113
**Status:** completed
Scope: layer-1+

## TR-FRENEMY-AUTH-010

**Existing CLI authentication and subscriptions** — Use installed signed-in CLIs and their existing subscription authentication without a separate API-key collection flow. State that delegated activity shares the provider's usage limits rather than implying independent capacity.
**Covered by:** FR: FR-FRENEMY-006
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-CONFIG-005

**Codex MCP registration** — Register the relay with absolute Node and relay paths in ~/.codex/config.toml, set tool_timeout_sec=600 and per-tool ask_claude approval_mode=approve. Do not rely on global approval settings or bypass the sandbox. Document that the relay executes outside Codex's shell sandbox.
**Covered by:** FR: FR-FRENEMY-001, FR-FRENEMY-005
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-CONFIG-120

**Per-agent execution selector configuration** — Add frenemy.config.json and a draft 2020-12 JSON Schema beside the relay. The configuration contains only per-agent defaults: agents.claude.model and effort; agents.grok.model and effort; and agents.cline.provider, model, and effort. The relay reads and validates the configuration at startup, accepts an explicit configuration path for test and deployment isolation, applies caller-over-config-over-native precedence, and maps validated values to each agent's documented native process inputs. The configuration and schema forbid credentials and unknown properties. Claude effort values are low, medium, high, xhigh, or max. Grok accepts its canonical none, minimal, low, medium, high, xhigh, and max values plus documented model-specific menu identifiers. Cline accepts none, low, medium, high, or xhigh.
**Covered by:** FR: FR-FRENEMY-116; TEST: TEST-FRENEMY-116
**Status:** completed
Scope: layer-1+
**Acceptance Criteria:**
- [x] Version-controlled frenemy.config.json and frenemy.config.schema.json reside beside ask-claude-mcp.mjs; the JSON references the schema and contains explicit claude, grok, and cline agent objects without secrets. (evidence: R07 selector/configuration cases passed against independent mocks and the real relay. Final-head Nuke run TestResults/20261106T190100-phase3-final-head-rerun: integration 40, unit 72, independent-mock 72, native qualification 7; 0 failed and 0 skipped. Integration TRX SHA-256 D0A41DCC835C247BFB4ED3CFE231C4DFC506891ABEB069C3F2F3BEB7EC050AC4; unit 51B96925D0A4E5030F89A19968084DF3192275CF6B4400BC562453B4CE0D397C; independent mock 8A358FD982C716A6AA652A4EACCD0D0CD23B117AB58AE71BE7E6233D072F46DA; native B96E0735A703B3BF8804485B591C72FC19E43B618D2B7A13293E8C8319EA7D2B. Independent Claude Opus 4.8 high review returned AGREE, accuracy 99%, completeness 99%, 30 PASS, 0 FAIL, 0 UNKNOWN. Full verdict persisted in MCP turn ClaudeCode-20261107T011320Z-phase3-final-selectors-r1 / req-20261107T011320Z-phase3-final-selectors-r1 with readback SHA-256 058E4A42A112B8A2BE03C0579B7E46E539F0B536E7FA7C5D740867FB9E7E7078.)
- [x] The schema uses draft 2020-12, sets additionalProperties false at every owned object, defines the per-agent fields and effort domains, and requires nonempty selector strings when a selector is present. (evidence: R07 selector/configuration cases passed against independent mocks and the real relay. Final-head Nuke run TestResults/20261106T190100-phase3-final-head-rerun: integration 40, unit 72, independent-mock 72, native qualification 7; 0 failed and 0 skipped. Integration TRX SHA-256 D0A41DCC835C247BFB4ED3CFE231C4DFC506891ABEB069C3F2F3BEB7EC050AC4; unit 51B96925D0A4E5030F89A19968084DF3192275CF6B4400BC562453B4CE0D397C; independent mock 8A358FD982C716A6AA652A4EACCD0D0CD23B117AB58AE71BE7E6233D072F46DA; native B96E0735A703B3BF8804485B591C72FC19E43B618D2B7A13293E8C8319EA7D2B. Independent Claude Opus 4.8 high review returned AGREE, accuracy 99%, completeness 99%, 30 PASS, 0 FAIL, 0 UNKNOWN. Full verdict persisted in MCP turn ClaudeCode-20261107T011320Z-phase3-final-selectors-r1 / req-20261107T011320Z-phase3-final-selectors-r1 with readback SHA-256 058E4A42A112B8A2BE03C0579B7E46E539F0B536E7FA7C5D740867FB9E7E7078.)
- [x] The relay resolves the default config beside its module and supports an explicit absolute config path for isolated tests and deployments. Missing explicit files, malformed JSON, schema-invalid values, and unreadable files fail before target launch with credential-free diagnostics. (evidence: R07 selector/configuration cases passed against independent mocks and the real relay. Final-head Nuke run TestResults/20261106T190100-phase3-final-head-rerun: integration 40, unit 72, independent-mock 72, native qualification 7; 0 failed and 0 skipped. Integration TRX SHA-256 D0A41DCC835C247BFB4ED3CFE231C4DFC506891ABEB069C3F2F3BEB7EC050AC4; unit 51B96925D0A4E5030F89A19968084DF3192275CF6B4400BC562453B4CE0D397C; independent mock 8A358FD982C716A6AA652A4EACCD0D0CD23B117AB58AE71BE7E6233D072F46DA; native B96E0735A703B3BF8804485B591C72FC19E43B618D2B7A13293E8C8319EA7D2B. Independent Claude Opus 4.8 high review returned AGREE, accuracy 99%, completeness 99%, 30 PASS, 0 FAIL, 0 UNKNOWN. Full verdict persisted in MCP turn ClaudeCode-20261107T011320Z-phase3-final-selectors-r1 / req-20261107T011320Z-phase3-final-selectors-r1 with readback SHA-256 058E4A42A112B8A2BE03C0579B7E46E539F0B536E7FA7C5D740867FB9E7E7078.)
- [x] Runtime validation and agent-specific native process-input mapping implement FR-FRENEMY-116 without shell interpolation or mutation of the parent environment, configuration, provider authentication, or agent profile. (evidence: R07 selector/configuration cases passed against independent mocks and the real relay. Final-head Nuke run TestResults/20261106T190100-phase3-final-head-rerun: integration 40, unit 72, independent-mock 72, native qualification 7; 0 failed and 0 skipped. Integration TRX SHA-256 D0A41DCC835C247BFB4ED3CFE231C4DFC506891ABEB069C3F2F3BEB7EC050AC4; unit 51B96925D0A4E5030F89A19968084DF3192275CF6B4400BC562453B4CE0D397C; independent mock 8A358FD982C716A6AA652A4EACCD0D0CD23B117AB58AE71BE7E6233D072F46DA; native B96E0735A703B3BF8804485B591C72FC19E43B618D2B7A13293E8C8319EA7D2B. Independent Claude Opus 4.8 high review returned AGREE, accuracy 99%, completeness 99%, 30 PASS, 0 FAIL, 0 UNKNOWN. Full verdict persisted in MCP turn ClaudeCode-20261107T011320Z-phase3-final-selectors-r1 / req-20261107T011320Z-phase3-final-selectors-r1 with readback SHA-256 058E4A42A112B8A2BE03C0579B7E46E539F0B536E7FA7C5D740867FB9E7E7078.)

## TR-FRENEMY-EXEC-004

**Bounded relay process and prompt transport** — Pass prompts through stdin, terminate stuck Claude calls after 10 minutes, cap output at approximately 2 MB and allow at most four concurrent Claude calls. Each call uses a fresh blocking session without streaming, cancellation or background job handles.
**Covered by:** FR: FR-FRENEMY-001, FR-FRENEMY-002, FR-FRENEMY-007
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-EXEC-006

**Codex delegation invocation contract** — Document codex exec --sandbox read-only --skip-git-repo-check with stdin prompt input; use workspace-write only for requested edits. Supply all needed context because sessions start blank, bound short foreground jobs at 600000 ms, and use background execution with -o answer file for long jobs. The source's Bash heredoc recipe is historical guidance, not authorization to violate the operator's PowerShell rule.
**Covered by:** FR: FR-FRENEMY-003
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-IMAGE-009

**Single-image helper contract** — Invoke ~/.claude/scripts/genimg.sh with the verbatim image prompt and absolute destination. Use a temporary Codex working folder and deliver the generated image to the requested destination. The legacy source describes moving the image; operator retain-original rules remain controlling for actual operations. Pass explicit CODEX_MODEL and CODEX_EFFORT; otherwise use account default model and medium effort. Images use gpt-image-2; video is unsupported.
**Covered by:** FR: FR-FRENEMY-004
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-INSTALL-007

**Baseline prerequisite and configuration setup** — Check Node 18+, installed and authenticated Claude/Codex CLIs, and native claude.exe on Windows. Configure both relay directions in user-home settings without admin privileges; append CLAUDE-codex-section.md to ~/.claude/CLAUDE.md. Mac/Linux may offer the optional image helper. Keep install path permanent and restart Codex after installation.
**Covered by:** FR: FR-FRENEMY-005, FR-FRENEMY-006
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-INSTALL-008

**Repeat-run and manual upgrade semantics** — A repeated baseline install skips existing relay and instruction blocks without duplicating them; it does not upgrade them. Document manual removal of the old managed blocks followed by reinstallation. This is captured baseline documentation, not an instruction to delete current user files.
**Covered by:** FR: FR-FRENEMY-005
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-ORCH-121

**Four-agent reasoning integration harness** — Implement the four-agent reasoning test as an opt-in Nuke integration target that drives the current Frenemy server and the existing Codex CLI path, validates structured peer judgments, and retains complete review artifacts.
**Covered by:** FR: FR-FRENEMY-117; TEST: TEST-FRENEMY-117
**Status:** pending
Scope: layer-1+
**Acceptance Criteria:**
- [ ] A dedicated opt-in Nuke target runs the integration test from the Frenemy workspace. No raw Node test command is an operator-facing validation path.
- [ ] For every question, the harness starts one answer session per agent and one peer-review session per agent. Each peer-review session scores the other three answers, yielding 40 attributable agent sessions, 20 answers, and 60 peer judgments without automatic retry or hidden substitution.
- [ ] Every invocation passes medium effort through the target-supported interface and records the requested effort plus observable target identity. Claude, Grok, and Cline use the existing Frenemy read-only tools; Codex uses codex exec in read-only mode with model_reasoning_effort set to medium.
- [ ] Peer-review output is validated against a schema containing questionId, subjectAgent, reviewerAgent, integer accuracy from 0 through 100, rationale, and rubric findings. Missing, duplicate, self-authored, malformed, or out-of-range judgments fail the run.
- [ ] The artifact root retains manifest.json, questions.json, orchestration.jsonl, summary.json, the TRX result, and one content-complete JSONL transcript for every answer and review session under sessions/<agent>/<question>/<role>. The final ZIP and every retained file have SHA-256 receipts.
- [ ] A failed or interrupted run still finalizes an archive with every artifact obtained before failure and an explicit failure record. The test never converts a missing agent, missing judgment, score below 50, timeout, malformed response, or incomplete archive into success.

## TR-FRENEMY-PROTOCOL-011

**Line-delimited MCP protocol and error handling** — Implement line-delimited JSON-RPC input/output with initialize, ping, tools/list and tools/call. Ignore notifications and blank lines; return -32601 for unknown methods, MCP isError for unknown tools, and -32700 for malformed or overlong lines. Limit lines to 8388608 JavaScript characters, discard an oversized line through its newline, and allow subsequent lines to be processed.
**Covered by:** FR: FR-FRENEMY-007
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-SEC-002

**Fixed workspace and safe read mode** — Run Claude in the MCP server startup working directory; callers cannot override it. For ask_claude use --safe-mode and disable file-editing, shell, web-fetch and web-search tools; subagents inherit these bans. Claude file permissions govern readable paths.
**Covered by:** FR: FR-FRENEMY-001
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-SEC-003

**Write-mode user settings and approval separation** — For ask_claude_write load only user settings with --setting-sources user, ignoring repository hooks, plugins and MCP configuration. Do not auto-approve this tool. Safe mode blocks read-call recursion, but write-call recursion remains a documented baseline limitation.
**Covered by:** FR: FR-FRENEMY-002
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-SEC-012

**Sanitize returned relay text** — Before returning Claude result text to Codex, remove OSC/CSI terminal escape sequences and other prohibited control characters while preserving newline/tab, and redact matching PEM private-key blocks. Treat redaction as best effort rather than a guarantee against every form of secret leakage.
**Covered by:** FR: FR-FRENEMY-001
**Status:** pending
Scope: layer-1..layer-1

## TR-MCP-TRIAGE-004

**TR-MCP-TRIAGE-004** — Placeholder requirement backfilled for TODO link TR-MCP-TRIAGE-004.
**Status:** pending
Scope: layer-1+
