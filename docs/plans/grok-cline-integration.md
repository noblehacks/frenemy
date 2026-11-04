# Frenemy: Grok Build and Cline CLI integration plan

Proposed: 2026-11-04T12:27:43 (America/Chicago)

Status: Approved by the operator on 2026-11-04. Phase 2 architecture amendment approved for execution. Product implementation and executable TDD remain gated by architecture acceptance.

Extend Frenemy into a shared delegation service for **Claude Code, Codex, Grok Build, and Cline CLI**. This plan incorporates the operator scope correction of 2026-11-04: no product integration with agent-specific audit plugins or QBrain, and no Git/worktree orchestration. Development tracking remains external to the product.

## 1. Scope and public interface

Support all **12 directed agent-to-agent routes** on Windows and Linux. Use Node for the relay under the explicit repository exception; use PowerShell for installation, build orchestration, and operational scripts.

Expose the same MCP tools to each caller:

- `list_agents`: installed versions, supported capabilities, and configuration status.
- `start_read_job` and `start_write_job`: submit work and immediately return a job ID.
- `get_job`: status, final answer, artifacts, execution identity.
- `read_job_events`: retrieve progress and transcript events using a continuation cursor.
- `cancel_job`: cancel a specific job.
- `resume_read_job` and `resume_write_job`: continue a recorded session with a new prompt.

Submission accepts the target agent, prompt, optional model and effort, and optional Cline provider. Workspace and caller identity come from the configured MCP connection.

Retain `ask_claude` and `ask_claude_write` as compatibility names, but route them into the job system. **This is a version-2 behavior change:** they return job handles. Write jobs run in the configured caller workspace, as the baseline write tool does. Update tool descriptions and migration documentation explicitly.

## 2. Shared execution and agent adapters

Use one local job service per OS user, reached through a Windows named pipe or Linux Unix-domain socket. Each agent's stdio MCP server connects to that service. Jobs continue when a caller disconnects.

Keep agent-specific invocation and response parsing behind adapters:

- **Claude:** headless streaming JSON, explicit model/effort, recorded session ID, and permission configuration.
- **Codex:** `codex exec --json`, stdin prompts, explicit sandbox, and exact session IDs for continuation.
- **Grok Build:** headless streaming JSON, prompt files instead of prompt-bearing command arguments, explicit model/effort, and recorded session IDs.
- **Cline:** `cline --acp --auto-approve false`, using ACP for prompts, progress, permissions, cancellation, and session loading. Its documented ACP interface supplies these controls. [Cline ACP](https://docs.cline.bot/usage/acp)

Resolve executable paths during setup and launch with argument arrays, without an intermediate shell. On Windows, resolve Cline's installed native executable instead of invoking its `.cmd` shim.

Reuse existing CLI authentication. Frenemy must not collect credentials or silently change providers or models. Record requested and observed execution identity separately; missing identity evidence remains unknown.

Default to four active jobs per host, with additional work queued. Permit one active turn per recorded agent session. Every agent can initiate delegation, but delegated jobs cannot recursively delegate in this first release.

## 3. Permissions, recovery, and local job evidence

Read jobs must prevent agent-directed source edits and unrestricted command execution. Enforce permissions using each adapter's supported controls and test their effect. A requested mode that cannot be enforced must fail explicitly. Grok's sandbox flag alone is insufficient evidence of Windows protection. [Grok sandbox documentation](https://docs.x.ai/build/features/sandbox)

Write jobs run in the configured caller workspace. Frenemy does not select Git revisions, create worktrees, collect Git diffs, merge or push. The caller remains responsible for its working files.

Durability requirements:

- Persist the accepted request before launching the agent. Retried submissions with the same request ID must not launch duplicate jobs.
- Retain complete credential-redacted request, response, progress, and error streams. Paginate retrieval without truncating retained evidence.
- Record parent/caller IDs, workspace, job ID, attempt ID, CLI session ID, versions, model, effort, and artifact hashes.
- Distinguish queued, running, awaiting permission, succeeded, failed, cancelled, and interrupted states.
- After reboot, retain history and mark unfinished execution interrupted. Resume only through an explicit request, using the exact recorded session. Never silently restart write work.
- Cancellation must terminate the owned job's process tree without affecting unrelated agent sessions.

Durable jobs have no fixed wall-clock or total transcript-size cutoff. Hostile reviews follow the existing stall rule: stop only after more than 30 minutes without reviewer output, preserve that attempt, and relaunch as a separate recorded attempt. Progress percentages and ETAs must come from the reviewer rather than being invented by Frenemy.


## 4. Installation and migration

Extend the PowerShell installer to register the shared MCP interface with all four clients. Support explicitly selected clients and require only their corresponding installed CLIs.

Installation must:

- Check executable versions and required capabilities.
- Preview configuration changes with `-WhatIf`.
- Copy and hash-verify backups before changing configuration, retaining originals.
- Preserve unrelated settings and update only Frenemy-managed entries.
- Avoid automatic approval of write, resume-write, or permission-escalation tools.
- Be repeatable without duplicate registrations or duplicated instruction sections.
- Provide rollback that restores Frenemy's changes without overwriting later unrelated edits.

Replace the current Claude-only delegation instructions with instructions for the common job interface. Document the version-2 behavior changes and recovery procedure.

The existing image helper remains outside this integration's acceptance scope. macOS and remote execution across machines are also outside this release.

## 5. BDPv4 delivery and acceptance

Execute in five gated phases:

1. **Requirements and contracts:** establish FR/TR/TEST/AC traceability and public contracts. Define test requirements here; defer executable fixtures and TDD until after architecture acceptance.
2. **C4 architecture baseline and planned changes:** create the source-pinned and target workspace described below, validate and independently accept it before TDD.
3. **Shared job runtime:** begin TDD with independent mocks and negative controls, then implement MCP operations, scheduling, persistence, event retrieval, cancellation and recovery; bind the same assertions to production.
4. **Agent integration:** implement four adapters, permissions, workspace-bound execution and continuation through the same TDD process.
5. **Installation and release validation:** configuration migration, rollback, documentation and Windows/Linux validation.

### Phase 2 architecture deliverables and exit gate

Version-control `docs/architecture/structurizr/`. Pin the baseline to **c7338ad39b646e695e7c4b5fbd998d45be914c02** and inspect the relay, both installers, delegation instructions, managed configuration and optional image helper. Cite actual files and symbols; external CLI internals are outside Frenemy ownership.

Model the target shared job service, four adapters, MCP interfaces, scheduler, durable storage, permission enforcement, workspace-bound execution, event retrieval and recovery and installation/rollback. Provide native Structurizr system-context, container and component views. Render code diagrams locally with PlantUML and embed their SVGs as Structurizr image views. Planned code and data contracts must be labeled DESIGN.

Separate baseline and target views with consistent identifiers and a legend for unchanged, added, modified and removed/replaced elements and relationships. Include Windows/Linux deployment views and dynamic submission, execution, permissions, cancellation, recovery/resume and installer-rollback flows. Existing macOS installation and image-helper behavior remain visible in the baseline and excluded from integration implementation.

Every planned change identifies FR/TR, relevant UC, affected component/interface/deployment boundary, AC, planned TEST coverage and responsible implementation phase. Record decisions and consequences. Architecture-specific records are **FR-FRENEMY-113**, **TR-FRENEMY-ARCH-117**, and **TEST-FRENEMY-113**.

Use pinned tools through PowerShell to run Structurizr workspace validation, locally render diagrams, and generate a browsable static site and diagram exports. Retain versions and hashes. Check owned-component C4 coverage, source evidence, change mappings, readability, legends, relationships, navigation and baseline/target distinction. Require the existing **Claude Opus 5.5 high** independent review: **AGREE, accuracy >=98%, completeness >=98%, zero unresolved applicable FAIL or UNKNOWN**. Do not begin TDD before this gate passes. Architecture acceptance never proves implementation correctness or satisfies production ACs.

Documentation validation and architecture rendering are this phase's checks; product mocks and executable product tests belong to phases 3-5.

For every implementation increment, first write tests and independent mocks covering **100% of its acceptance criteria**. Demonstrate correct responses passing and deliberately incorrect responses being rejected within a green mock suite. Then bind the same cases and assertions to production behavior.

Use Nuke to orchestrate Node tests, PowerShell validation, and integration tests. Retain original test output and validated TRX reports. Run targeted tests after edits and the full applicable suite at each phase exit.

Required acceptance scenarios include:

- All **12 routes x 2 access modes x 2 operating systems**, giving **48 routing/access combinations**.
- Read-only attempts to edit, execute commands, escape through MCP tools, or escalate through continuation.
- Writes in the configured workspace, trusted workspace binding, and concurrent submissions.
- Duplicate requests, malformed events, partial output, provider errors, missing credentials, and unsupported model/effort selections.
- Caller disconnect, service restart, reboot recovery, cancellation races, and exact-session continuation.
- Long transcripts, reviewer-reported progress, and complete local verdict retention and retrieval.
- Fresh installation, repeated installation, upgrade, conflicting configuration, and rollback.

At each phase exit, supply the complete evidence to **Claude Opus 5.5 at high effort**, verifying that identity from runtime receipts. The reviewer reads supplied tests and TRX results without independently building or running tests. Acceptance requires **AGREE, accuracy >=98%, completeness >=98%, and no unresolved applicable FAIL or UNKNOWN findings**.

## 6. Tracking and current state

The operator approved PLAN-FRENEMY-001 and its five-phase architecture amendment on 2026-11-04. The high-priority QBrain TODO retains the plan. Product implementation has not started; TDD is gated by Phase 2 architecture acceptance.

The active repository is sharpninja/frenemy, forked from noblehacks/frenemy. The historical `proposed-v2` layer key is retained for FR-FRENEMY-101 through FR-FRENEMY-113 except withdrawn FR-FRENEMY-107, 15 target TRs and TEST-FRENEMY-101 through TEST-FRENEMY-113 except withdrawn TEST-FRENEMY-107. UCs 10186 through 10197 map respectively to FRs 101-112 except withdrawn UC10192/FR107. Removed TR-FRENEMY-GIT-108 and TR-FRENEMY-AUDIT-113 are historical only; retained TR-FRENEMY-AUDIT-110 governs local job evidence, not external delivery. FR113's architecture coverage traces those existing UCs; it introduces no new user workflow. These records and diagrams are specifications, not implementation evidence.

See [architecture workspace](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/README.md), [baseline overview](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/overview.md), and [validation status](https://github.com/sharpninja/frenemy/blob/main/docs/testing/validation.md). The two-tool baseline product remains unchanged.
