# Technical Requirements (QBrain.AI)

## TR-FRENEMY-ADAPTER-103

**Claude and Codex adapters** — Hide agent-specific invocation and parsing behind adapters. Claude uses headless streaming JSON, explicit model/effort, permission configuration and session ID. Codex uses codex exec --json, stdin prompts, explicit sandbox and exact session IDs for continuation.
**Covered by:** FR: FR-FRENEMY-101, FR-FRENEMY-102, FR-FRENEMY-105, FR-FRENEMY-106, FR-FRENEMY-108; TEST: TEST-FRENEMY-101, TEST-FRENEMY-102, TEST-FRENEMY-105, TEST-FRENEMY-106, TEST-FRENEMY-108
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-ADAPTER-104

**Grok and Cline adapters** — Grok uses headless streaming JSON, prompt files, explicit model/effort and recorded session IDs. Cline uses cline --acp --auto-approve false with ACP prompts, progress, permissions, cancellation and session loading. Treat these as proposed adapter contracts awaiting implementation validation.
**Covered by:** FR: FR-FRENEMY-101, FR-FRENEMY-102, FR-FRENEMY-103, FR-FRENEMY-104, FR-FRENEMY-105, FR-FRENEMY-106, FR-FRENEMY-108; TEST: TEST-FRENEMY-101, TEST-FRENEMY-102, TEST-FRENEMY-103, TEST-FRENEMY-104, TEST-FRENEMY-105, TEST-FRENEMY-106, TEST-FRENEMY-108
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-API-102

**Common MCP tool contracts** — Expose list_agents, start_read_job, start_write_job, get_job, read_job_events, cancel_job, resume_read_job and resume_write_job. Submission fields include target/prompt/model/effort/provider; caller and workspace come from connection configuration. Legacy ask_claude names return job handles in v2 and require explicit migration documentation.
**Covered by:** FR: FR-FRENEMY-101, FR-FRENEMY-102, FR-FRENEMY-103, FR-FRENEMY-104, FR-FRENEMY-105, FR-FRENEMY-111; TEST: TEST-FRENEMY-101, TEST-FRENEMY-102, TEST-FRENEMY-103, TEST-FRENEMY-104, TEST-FRENEMY-105, TEST-FRENEMY-111
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-ARCH-001

**Dependency-free relay and headless Claude invocation** — Implement the baseline relay in ask-claude-mcp.mjs with no package dependencies and expose ask_claude and ask_claude_write backed by claude -p rather than claude mcp serve.
**Covered by:** FR: FR-FRENEMY-001, FR-FRENEMY-002, FR-FRENEMY-007
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-ARCH-101

**Local service and transport boundaries** — Use Node for the relay under the repository exception, PowerShell for installation/build/operations, and one job service per OS user. Connect stdio MCP servers through a Windows named pipe or Linux Unix-domain socket. Target Windows and Linux; exclude macOS, cross-machine execution and image-helper changes from v2 acceptance.
**Covered by:** FR: FR-FRENEMY-101, FR-FRENEMY-102, FR-FRENEMY-105, FR-FRENEMY-111; TEST: TEST-FRENEMY-101, TEST-FRENEMY-102, TEST-FRENEMY-105, TEST-FRENEMY-111
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-ARCH-117

**Structurizr model and local reproducible rendering** — Keep source in docs/architecture/structurizr. Use native Structurizr levels 1-3 and locally rendered PlantUML SVG image views for level 4. Pin baseline c7338ad39b646e695e7c4b5fbd998d45be914c02, tool versions and hashes; separate baseline/target with stable identifiers, labelled change categories, source and requirement links, deployment and dynamic views. Retain generated site, exports and evidence.
**Covered by:** FR: FR-FRENEMY-113; TEST: TEST-FRENEMY-113
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-AUDIT-110

**Retain local job evidence** — Retain credential-redacted request/response/progress/error streams, cursor retrieval without truncating retained evidence, and parent/caller/workspace/job/attempt/session IDs, CLI versions, model, effort and artifact hashes. Storage and retrieval are local to Frenemy; no agent-specific audit plugin or QBrain product dependency.
**Covered by:** FR: FR-FRENEMY-103, FR-FRENEMY-108, FR-FRENEMY-110; TEST: TEST-FRENEMY-103, TEST-FRENEMY-108, TEST-FRENEMY-110
**Status:** pending
Scope: proposed-v2+

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

## TR-FRENEMY-EXEC-111

**Owned process cancellation** — Cancel only the selected job's process tree and preserve unrelated agent sessions; include cancellation races in release validation.
**Covered by:** FR: FR-FRENEMY-104; TEST: TEST-FRENEMY-104
**Status:** pending
Scope: proposed-v2+

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

## TR-FRENEMY-INSTALL-114

**Selective transactional configuration migration** — Check selected clients' CLI versions and capabilities; provide -WhatIf, copy/hash-verified retained backups, preserve unrelated settings, change only managed entries, prevent duplicate registrations/instructions and avoid automatic write/resume-write/escalation approvals. Rollback preserves later unrelated edits; update common delegation and recovery instructions.
**Covered by:** FR: FR-FRENEMY-111; TEST: TEST-FRENEMY-111
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-PROTOCOL-011

**Line-delimited MCP protocol and error handling** — Implement line-delimited JSON-RPC input/output with initialize, ping, tools/list and tools/call. Ignore notifications and blank lines; return -32601 for unknown methods, MCP isError for unknown tools, and -32700 for malformed or overlong lines. Limit lines to 8388608 JavaScript characters, discard an oversized line through its newline, and allow subsequent lines to be processed.
**Covered by:** FR: FR-FRENEMY-007
**Status:** pending
Scope: layer-1..layer-1

## TR-FRENEMY-REVIEW-112

**Unbounded jobs and reviewer stall handling** — Do not impose fixed job wall-clock or transcript-size limits. Stop hostile-review execution only after more than 30 minutes without output, preserve that attempt and relaunch as a separately recorded attempt. Use reviewer-produced progress percentages and ETAs.
**Covered by:** FR: FR-FRENEMY-103, FR-FRENEMY-110; TEST: TEST-FRENEMY-103, TEST-FRENEMY-110
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-REVIEW-116

**Independent phase-exit acceptance** — At each phase exit give complete evidence to Claude Opus 5.5 high, verify identity via runtime receipts, and supply tests/TRX without inviting reviewer builds or test execution. Require AGREE, accuracy and completeness each at least 98%, with no unresolved applicable FAIL or UNKNOWN.
**Covered by:** FR: FR-FRENEMY-112; TEST: TEST-FRENEMY-112
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-SCHED-106

**Queue and recursion limits** — Default to four active jobs per host and queue excess work; serialize active turns per recorded CLI session and prevent delegated jobs from recursively delegating.
**Covered by:** FR: FR-FRENEMY-102, FR-FRENEMY-109; TEST: TEST-FRENEMY-102, TEST-FRENEMY-109
**Status:** pending
Scope: proposed-v2+

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

## TR-FRENEMY-SEC-105

**Executable resolution and identity preservation** — Resolve executables during setup and launch with argument arrays and no intermediate shell. On Windows resolve Cline's native binary instead of a .cmd shim. Reuse CLI auth; never silently substitute provider/model. Record requested and observed identity separately, with unknown for missing evidence.
**Covered by:** FR: FR-FRENEMY-108, FR-FRENEMY-111; TEST: TEST-FRENEMY-108, TEST-FRENEMY-111
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-SEC-107

**Fail-closed read permissions** — Use adapter-supported controls to prevent source edits and unrestricted commands and fail explicitly for unenforceable access modes. Validate permission escalation and MCP-tool escape paths, including continuation; Grok's flag alone does not establish Windows confinement.
**Covered by:** FR: FR-FRENEMY-106; TEST: TEST-FRENEMY-106
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-STORE-109

**Request durability and lifecycle states** — Persist accepted requests before launch and deduplicate retries by request ID. Store the documented job states; on reboot preserve history and label unfinished execution interrupted. Continue disconnected-caller jobs and resume only on explicit request with the exact session; do not silently relaunch writes.
**Covered by:** FR: FR-FRENEMY-102, FR-FRENEMY-103, FR-FRENEMY-105; TEST: TEST-FRENEMY-102, TEST-FRENEMY-103, TEST-FRENEMY-105
**Status:** pending
Scope: proposed-v2+

## TR-FRENEMY-TEST-115

**Contract-first validation and release coverage** — Use five named gated phases, 100% AC coverage through independent green mock suites and deliberate negative controls before implementation, then production-bind the same cases. Nuke orchestrates Node tests, PowerShell validation and integration runs; retain original output and validated TRX. Run targeted tests per edit and full applicable suites at phase exits. Cover 48 route/access/OS combinations and all isolation, duplicate/malformed/error, recovery, cancellation, long-transcript, local evidence and installation scenarios listed by the plan. These are planned tests, not existing tests or extracted test AC. Phase 1 defines requirements/contracts; Phase 2 completes source-pinned C4 architecture and independent acceptance before executable fixtures/TDD. Phases 3-5 implement runtime, adapters and release with independent green mocks then same-assertion production binding. Phase 2 uses architecture validator/render/traceability evidence; product TRX is not fabricated before tests exist.
**Covered by:** FR: FR-FRENEMY-112; TEST: TEST-FRENEMY-112
**Status:** pending
Scope: proposed-v2+

## TR-MCP-TRIAGE-004

**TR-MCP-TRIAGE-004** — Placeholder requirement backfilled for TODO link TR-MCP-TRIAGE-004.
**Status:** pending
Scope: layer-1+

