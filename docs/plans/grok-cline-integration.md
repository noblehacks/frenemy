# Frenemy: Grok Build and Cline CLI integration plan

Proposed: 2026-11-04T12:27:43 (America/Chicago)

Status: Proposed, pending operator approval. No implementation changes have been made.

Extend Frenemy into a shared delegation service for **Claude Code, Codex, Grok Build, and Cline CLI**. The plan incorporates all seven decisions made before reboot.

## 1. Scope and public interface

Support all **12 directed agent-to-agent routes** on Windows and Linux. Use Node for the relay under the explicit repository exception; use PowerShell for installation, build orchestration, and operational scripts.

Expose the same MCP tools to each caller:

- `list_agents`: installed versions, supported capabilities, and configuration status.
- `start_read_job` and `start_write_job`: submit work and immediately return a job ID.
- `get_job`: status, final answer, artifacts, execution identity, and audit status.
- `read_job_events`: retrieve progress and transcript events using a continuation cursor.
- `cancel_job`: cancel a specific job.
- `resume_read_job` and `resume_write_job`: continue a recorded session with a new prompt.

Submission accepts the target agent, prompt, optional model and effort, and optional Cline provider. Write submissions also accept a base Git revision. Workspace and caller identity come from the configured MCP connection.

Retain `ask_claude` and `ask_claude_write` as compatibility names, but route them into the job system. **This is a version-2 behavior change:** they return job handles, and writes occur in isolated worktrees. Update tool descriptions and migration documentation explicitly.

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

## 3. Isolation, recovery, and receipts

Read jobs must prevent agent-directed source edits and unrestricted command execution. Enforce permissions using each adapter's supported controls and test their effect. A requested mode that cannot be enforced must fail explicitly. Grok's sandbox flag alone is insufficient evidence of Windows protection. [Grok sandbox documentation](https://docs.x.ai/build/features/sandbox)

Write jobs use worktrees beneath the owning repository:

`<repository>/.worktrees/frenemy/<job-id>`

Use the selected base revision, defaulting to HEAD when the caller's checkout is clean. If it is dirty, require an explicit base revision rather than silently excluding changes. Return the worktree path, base commit, changed-file inventory, and diff. Preserve worktrees until explicitly removed; do not automatically merge or push.

Durability requirements:

- Persist the accepted request before launching the agent. Retried submissions with the same request ID must not launch duplicate jobs.
- Retain complete credential-redacted request, response, progress, and error streams. Paginate retrieval without truncating retained evidence.
- Record parent/caller IDs, workspace, job ID, attempt ID, CLI session ID, versions, model, effort, and artifact hashes.
- Distinguish queued, running, awaiting permission, succeeded, failed, cancelled, and interrupted states.
- After reboot, retain history and mark unfinished execution interrupted. Resume only through an explicit request, using the exact recorded session. Never silently restart write work.
- Cancellation must terminate the owned job's process tree without affecting unrelated agent sessions.

Durable jobs have no fixed wall-clock or total transcript-size cutoff. Hostile reviews follow the existing stall rule: stop only after more than 30 minutes without reviewer output, preserve that attempt, and relaunch as a separate recorded attempt. Progress percentages and ETAs must come from the reviewer rather than being invented by Frenemy.

Integrate audit logging through each agent's supported MCP plugin route and identity. Persist full review findings and verdicts, verify readback, and use supported failsafes when necessary. Report audit delivery separately from execution outcome; infrastructure failure alone must not manufacture a review failure.

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

Execute in four gated phases:

1. **Requirements and contracts:** register the workspace through supported tooling; capture FR/TR/TEST requirements and acceptance criteria for routing, permissions, jobs, recovery, receipts, and installation. Define adapter contracts and test fixtures.
2. **Shared job runtime:** implement MCP operations, scheduling, persistence, event retrieval, cancellation, and recovery.
3. **Agent integration:** implement all four adapters, permission policies, isolated worktrees, session continuation, and MCP audit integration.
4. **Installation and release validation:** implement configuration migration, rollback, documentation, and end-to-end validation on both lab hosts.

For every implementation increment, first write tests and independent mocks covering **100% of its acceptance criteria**. Demonstrate correct responses passing and deliberately incorrect responses being rejected within a green mock suite. Then bind the same cases and assertions to production behavior.

Use Nuke to orchestrate Node tests, PowerShell validation, and integration tests. Retain original test output and validated TRX reports. Run targeted tests after edits and the full applicable suite at each phase exit.

Required acceptance scenarios include:

- All **12 routes x 2 access modes x 2 operating systems**, giving **48 routing/access combinations**.
- Read-only attempts to edit, execute commands, escape through MCP tools, or escalate through continuation.
- Isolated writes, dirty-checkout handling, path traversal, symlinks/junctions, and concurrent submissions.
- Duplicate requests, malformed events, partial output, provider errors, missing credentials, and unsupported model/effort selections.
- Caller disconnect, service restart, reboot recovery, cancellation races, and exact-session continuation.
- Long transcripts, review progress, complete verdict retention, audit retry, and hash-verified readback.
- Fresh installation, repeated installation, upgrade, conflicting configuration, and rollback.

At each phase exit, supply the complete evidence to **Claude Opus 5.5 at high effort**, verifying that identity from runtime receipts. The reviewer reads supplied tests and TRX results without independently building or running tests. Acceptance requires **AGREE, accuracy >=98%, completeness >=98%, and no unresolved applicable FAIL or UNKNOWN findings**.

## 6. Tracking and current state

Implementation remains pending explicit approval. The complete proposal is saved in
QBrain as high-priority `PLAN-FRENEMY-001`, with all implementation tasks pending.
The active repository is `sharpninja/frenemy`, forked from `noblehacks/frenemy`.

The workspace is now registered with QBrain. Proposed requirements remain in the
`proposed-v2` layer: FR-FRENEMY-101 through FR-FRENEMY-112 and their 16 TRs.
Draft use cases 10186 through 10197 map respectively to those 12 FRs. These records
are planning evidence, not approval or proof of implementation. TEST records,
per-phase executable commands, independent fixtures, and complete AC-to-test mapping
must be established before implementation starts.

The shipped baseline remains the two-tool Claude/Codex relay described in
[the architecture overview](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/overview.md). See
[validation status](https://github.com/sharpninja/frenemy/blob/main/docs/testing/validation.md) for the distinction between documented
behaviors, proposed acceptance criteria, and executed tests.
