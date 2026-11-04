# Testing Requirements (QBrain.AI)

## TEST-FRENEMY

### TEST-FRENEMY-101

Prove all acceptance criteria of FR-FRENEMY-101 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-101-01: list_agents reports installed CLI versions, capabilities and configuration status. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-101-02: Each of four agents can call each other agent, covering 12 directed routes on both Windows and Linux. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-101-03: Release validation covers each route in read and write mode on both operating systems, totaling 48 routing/access combinations; macOS and cross-machine execution remain excluded. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-102

Prove all acceptance criteria of FR-FRENEMY-102 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-102-01: start_read_job and start_write_job return a job ID immediately for accepted work. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-102-02: Submission accepts target, prompt, optional model/effort/Cline provider; caller and workspace are obtained from MCP connection configuration. No Git base-revision input is accepted. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-102-03: The accepted request is durably retained before agent launch; retrying its request ID does not launch duplicate jobs. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-102-04: Legacy ask_claude and ask_claude_write return job handles in v2 with explicit migration documentation. Write jobs execute in the configured caller workspace. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-103

Prove all acceptance criteria of FR-FRENEMY-103 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-103-01: get_job returns lifecycle state, final answer when available, artifacts and execution identity. No external audit-delivery status is exposed. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-103-02: read_job_events uses continuation cursors and allows retrieval of the complete retained credential-redacted request/response/progress/error streams without truncating them. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-103-03: Job state distinguishes queued, running, awaiting permission, succeeded, failed, cancelled and interrupted. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-103-04: No total transcript-size or fixed job-duration cutoff discards required evidence or terminates otherwise active jobs. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-104

Prove all acceptance criteria of FR-FRENEMY-104 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-104-01: cancel_job targets the specified job ID and terminates that job's owned process tree. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-104-02: Cancellation leaves unrelated agent sessions running; release validation includes cancellation races. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-105

Prove all acceptance criteria of FR-FRENEMY-105 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-105-01: A caller disconnect does not stop its running job. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-105-02: After reboot job history remains available and unfinished execution is marked interrupted. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-105-03: resume_read_job and resume_write_job accept a new prompt and continue the exact recorded session only after an explicit request. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-105-04: Recovery does not silently restart write jobs or substitute a different CLI session. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-106

Prove all acceptance criteria of FR-FRENEMY-106 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-106-01: Read jobs prevent agent-directed source edits and unrestricted command execution through adapter-supported controls. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-106-02: When an adapter cannot enforce the requested mode, reject it explicitly rather than proceeding under weaker permissions. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-106-03: Permission validation includes direct edits, command execution, MCP-tool escapes and escalation through continuation; Grok's sandbox flag alone does not establish Windows protection. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-108

Prove all acceptance criteria of FR-FRENEMY-108 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-108-01: Reuse existing CLI authentication without collecting credentials or silently changing selected providers or models. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-108-02: Record requested and observed model/effort/provider identity separately; when observed identity is unavailable report unknown. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-108-03: Retain parent/caller IDs, workspace, job ID, attempt ID, CLI session ID, versions, model, effort and artifact hashes. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-108-04: Launch resolved executables with argument arrays and no shell; resolve Cline's native Windows executable instead of a .cmd shim. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-108-05: Validation includes missing credentials, provider errors and unsupported model/effort selections without inventing successful execution evidence. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-109

Prove all acceptance criteria of FR-FRENEMY-109 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-109-01: Default active capacity is four jobs per host; excess submissions queue. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-109-02: At most one turn is active per recorded agent session. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-109-03: Each agent may initiate a job, but a delegated job cannot recursively delegate in the first release. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-110

Prove all acceptance criteria of FR-FRENEMY-110 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-110-01: Retain complete credential-redacted review findings and verdicts in local job events under the job, attempt and executing agent identity. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-110-02: The caller can retrieve retained findings and verdicts through read_job_events without requiring an external audit plugin or service. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-110-03: Reviewer runs are not bounded by fixed time or size; after more than 30 minutes without reviewer output, preserve the stopped attempt and record a relaunch as a separate attempt. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-110-04: Progress percentages and ETAs come from the reviewer rather than being invented by Frenemy. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-110-05: Validation includes long transcripts, complete local verdict retention and paginated retrieval without truncation. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-111

Prove all acceptance criteria of FR-FRENEMY-111 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-111-01: Install only selected clients and require only their installed CLIs, checking versions and capabilities. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-111-02: -WhatIf previews configuration changes without applying them. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-111-03: Before modification copy and hash-verify configuration backups and retain originals. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-111-04: Preserve unrelated settings and change only Frenemy-managed entries. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-111-05: Do not automatically approve write, resume-write or permission-escalation tools. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-111-06: Repeated installation creates no duplicate registrations or instruction sections. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-111-07: Rollback restores managed changes without overwriting later unrelated edits. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-111-08: Provide common job-interface instructions and explicit v2 migration/recovery documentation; validate fresh install, repeat, upgrade, conflicts and rollback. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-112

Prove all acceptance criteria of FR-FRENEMY-112 through independent correct mocks and negative controls before production edits, then bind the same cases and assertions to production and retain Windows/Linux phase-exit evidence. Five phases: requirements/contracts, accepted architecture before executable TDD, runtime, adapters, installation/release. Architecture phase validates documents and rendering before product fixtures exist.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-112-01: Before implementation of an increment, independent mocks and negative controls demonstrate that tests cover 100% of its AC and reject deliberately wrong responses within a passing suite. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-112-02: Bind the same test cases/assertions to production behavior after the green mock gate. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-112-03: Use Nuke for Node tests, PowerShell validation and integration tests; retain original output and validated TRX reports. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-112-04: Run targeted checks after edits and the full applicable gate at each of five phase exits. Phase 1 establishes contracts; Phase 2 validates and independently accepts C4 architecture before executable TDD. Phases 3-5 require product suites on the required lab hosts. Source: approved Phase 2 amendment. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-112-05: Release evidence covers the current plan scenarios, including malformed events, partial output, duplicate requests, errors, recovery, permissions, local artifacts and installation. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-112-06: At every phase exit verify Claude Opus 5.5 high identity and supply complete applicable evidence, including all existing unit and in-scope integration TRX. Phase 2 supplies architecture validation/render/traceability receipts; no product test suite exists yet. Reviewer never independently builds or runs tests. (evidence: Planned test contract. No mock, production, host or review pass claimed.)
- [ ] Verify AC-FRENEMY-112-07: Phase acceptance requires AGREE, accuracy >=98%, completeness >=98%, and no unresolved applicable FAIL or UNKNOWN. (evidence: Planned test contract. No mock, production, host or review pass claimed.)

### TEST-FRENEMY-113

Validate DSL and local renders, check owned component/C4 coverage, pinned source facts, complete per-change FR/TR/UC/AC/TEST/phase mapping, all required flows and Windows/Linux deployments, rendering readability and navigation. Supply evidence to Claude Opus 5.5 high for independent >=98/98 AGREE with no applicable FAIL/UNKNOWN before TDD.

**Acceptance Criteria:**
- [ ] Verify AC-FRENEMY-113-01: A source-pinned baseline at c7338ad39b646e695e7c4b5fbd998d45be914c02 covers every Frenemy-owned executable/module and installer at C4 context, container, component and code levels; external CLI internals are outside ownership.
- [ ] Verify AC-FRENEMY-113-02: A separately labelled target model covers the approved runtime, adapters, local storage, permissions, configured workspace execution and installation, with change categories and requirement traceability. Excluded external audit integrations and Git/worktree orchestration are absent.
- [ ] Verify AC-FRENEMY-113-03: Windows/Linux deployment and submission, execution, permission, cancellation, recovery/resume and installer rollback dynamic views exist and agree with static relationships and public contracts.
- [ ] Verify AC-FRENEMY-113-04: Every planned element and relationship change maps to FR/TR, relevant UC, AC, TEST and implementation phase; architecture decisions include consequences and exclusions.
- [ ] Verify AC-FRENEMY-113-05: Pinned local Structurizr and PlantUML tooling validates DSL, renders C4 code-level SVG image views and produces a browsable static site and diagram exports with version/hash receipts and readable navigable views.
- [ ] Verify AC-FRENEMY-113-06: Before TDD begins, independent verified Claude Opus 5.5 high review returns AGREE with accuracy/completeness at least 98 and no applicable unresolved FAIL/UNKNOWN; full paired streams and durable verdict readback are retained. Architecture approval does not satisfy production behavior AC.
