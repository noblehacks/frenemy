# Target contracts and failure boundaries (DESIGN)

These contracts describe approved outcomes and proposed module seams, not implemented APIs. The eight public tool names and two legacy aliases come from the approved plan. Runtime wire schemas must be frozen in Phase 1 before executable Phase 3 TDD. Every field below carries its root job/attempt/workspace identity where applicable.

## MCP and local IPC

`list_agents` reports configured/installed versions and capabilities, including unsupported read enforcement. `start_read_job` and `start_write_job` accept a stable request ID, target, prompt and optional model, effort and Cline provider. The bridge binds caller and workspace from trusted connection configuration, never from prompt text. Legacy `ask_claude` and `ask_claude_write` submit equivalent jobs and return handles: this is an explicit v2 breaking behavior change.

`get_job(jobId)` returns lifecycle, final answer, artifact references, requested and observed identity. `read_job_events(jobId,cursor)` returns ordered events and a next cursor without deleting or truncating retained history. `cancel_job(jobId)` is ownership checked and idempotent. `resume_read_job` and `resume_write_job` create a new attempt with a new prompt for the exact recorded CLI session; they do not silently start a fresh session.

The bridge communicates with one per-user service through a Windows named pipe restricted to the user's SID or a Linux private Unix socket. Reject wrong-user, wrong-workspace, stale-attempt and delegated-recursion requests before launching. No TCP/remote job service is introduced. Caller disconnect leaves the durable job running. IPC requests and responses carry protocol version, request ID, trusted caller/workspace IDs and job/attempt IDs as applicable.

Permission interaction is an adapter-to-client callback, not an additional automatically approved public tool. A pending request carries job ID, attempt ID, permission request ID and proposed action; only an explicitly authorized, matching current decision can continue it. An adapter/client pair without a supported callback path fails the operation explicitly. Read-mode forbidden actions are denied even if a generic client approval is offered; resume cannot elevate read to write. The implementation must prove capability enforcement per platform. No promise is made that existing Grok Windows sandbox flags alone enforce read restrictions.

## Durable records and concurrency

JobRequest: request ID, canonical request hash, trusted caller/parent/workspace IDs, target agent, access mode, prompt, requested model/effort/provider. Commit acceptance before launch. Repeated identical request IDs return the original job; a different payload using that ID is a conflict. A crash after persistence does not authorize an unrecorded duplicate launch.

JobSnapshot: job ID, execution state (`queued`, `running`, `awaiting_permission`, `succeeded`, `failed`, `cancelled`, `interrupted`), attempts, result/artifacts. Attempt: job/attempt IDs, CLI session ID when known, executable/version, requested and observed identity, workspace, timestamps and terminal outcome. Unknown identity remains unknown.

AgentEvent: job/attempt IDs, monotonic per-job sequence, event type, timestamp and credential-redacted payload. EventPage uses a stable cursor tied to job and sequence; an invalid or cross-job cursor is rejected. Persist before exposing an event cursor. Preserve complete request/output/error/progress/verdict streams; pagination is not a retention cap. Disk exhaustion or corrupt persistence fails explicitly and must not report an unpersisted request as accepted. Artifact references include path and content hash.

Four active jobs by default per host in the approved single-user deployment; additional requests queue. One active turn per CLI session. The local service is the sole scheduler for that user's clients. Multiple OS users are separate service/security domains; this architecture does not implement a machine-wide cross-user coordinator. Delegated execution cannot start recursive Frenemy jobs. State transition ownership resolves cancel/completion races once, retains both events, and never kills unrelated processes.

On service restart/reboot, unfinished executions become interrupted and evidence remains queryable. Resume requires explicit authorization and the exact recorded session, workspace and mode. If the session is unavailable, report failure; do not substitute a new session. Writes run in the configured caller workspace. Frenemy performs no Git revision selection, worktree creation, diff collection, merge or push.

## Adapter seams

The planned AgentAdapter interface provides probe/start/resume/cancel/events. Claude uses headless streaming JSON; Codex uses exec JSON with stdin; Grok uses protected prompt files and streaming JSON; Cline uses ACP with auto-approve false. Resolve native executable and argv without an intermediate shell; install capability checks reject unsupported native Windows Cline layouts. External client internals and provider authentication remain outside Frenemy ownership.

The supervisor owns only processes started for an attempt. Adapters normalize permission, progress, identity, errors and session events while retaining complete redacted source streams. Ordinary jobs have no fixed timeout/output cap. For hostile-review jobs, only a greater-than-30-minute output stall permits stopping; retain the old attempt and relaunch as a distinct attempt. Percentage and ETA must originate with the reviewer.


## Installation and phase activation

InstallPlan identifies selected clients, resolved executables/capabilities, managed entries, instruction sections and v1-to-v2 behavior notices. ChangeJournal retains preimages, hashes, owned patches and applied values. Preview performs no writes. Copy and hash originals before mutation. Rollback restores only Frenemy-owned changes when the current value still matches the applied value; preserve unrelated later edits and report same-field conflicts without overwriting. Never delete originals.

Phase 3 supplies runtime seams and tests; adapters and permission enforcement are not advertised as usable until Phase 4 binds and proves them. Phase 5 publishes client registrations only after those capabilities pass. Rollback removes or disables v2 registration before reverting service configuration; retained jobs, evidence and caller files are preserved. Existing macOS Bash installation and image helper remain baseline-only, excluded from integration implementation.
