# Crew write safeguards — current contract

All four MCP write tools require `prompt`, an absolute `working_directory`, and `allowed_files` (exact relative file paths). Missing scope is rejected before launching a model. Read-only `ask_*` tools remain for questions and audits.

The guard claims each assigned file, makes a private working copy under `.worker-state/workspaces/`, and records original hashes. It rejects overlapping claims, including a file versus a path below that file. Independent files can be assigned separately. Workers edit their copies; their tool response carries a job receipt. The driver reviews the diff and checks the result before calling `crew_job_apply`. The worker must never apply its own job.

Apply checks every staged source change against the file list, rejects symlinks, and refuses to overwrite an original that changed since assignment. Originals are backed up before replacement. Interrupted application holds the project until `crew_job_recover` can safely restore it. Recovery refuses changed targets and preserves backups. These are cooperative conflict protections, not a security sandbox against processes running as the same user.

If a seat runs out of usage, the driver names it, confirms its old process has stopped, and preserves its partial result. Review/apply useful completed work or call `crew_job_abandon` with `stopped: true`, then give the unfinished work to an available seat in a fresh assignment. Time alone never releases ownership. Do not run both old and replacement workers.

Every relay exposes `crew_job_status`, `crew_job_apply`, `crew_job_abandon`, and `crew_job_recover`. For CLI skills the equivalent is:

```sh
node tools/worker-workspace.mjs prepare --root /absolute/project --agent kimi --files src/example.py
# Run the authorized worker from the printed isolated workspace; pass that scope in its prompt.
node tools/worker-workspace.mjs status --root /absolute/project
# After review and checks:
node tools/worker-workspace.mjs apply --root /absolute/project --job JOB_ID
# For a stopped assignment that will not be applied:
node tools/worker-workspace.mjs abandon --root /absolute/project --job JOB_ID --stopped
```

All wrapper foreground watchdogs default to 570 seconds; relays have a 600-second backstop. A direct wrapper timeout of zero disables its own watchdog. Agy still has a native 24-hour print ceiling in that mode; unbounded background parity is not certified. MCP calls also remain subject to their host deadline. Worker edit authorization does not bypass a CLI's actual command-approval rejection.

Permission bits are checked together with content hashes. Applied jobs with a leftover interrupted marker can reconcile bookkeeping without undoing committed files, even if the owner subsequently edited them. Legacy interrupted recovery uses hashes when original mode metadata is unavailable and journals that limitation.
