---
name: hive-lite
description: Coordinate supervised Executive, Controller and Worker sessions with bounded job cards, task-appropriate model routing and reviewed results. Use when explicitly invoked for setup, join, status or planning, or when assigned a hive role. Ordinary solo work does not require this workflow.
---

# Hive-Lite

Supervised coordination across projects and AI providers. Failures must be visible and recoverable under user supervision. When uncertain, hold that job, reconcile and ask; never duplicate possibly running work. Add machinery only for a likely, costly failure supervision cannot catch. User authority and project instructions prevail; the Executive cannot grant user authority.

Choose the lowest model and effort that can complete each task reliably, including coordination work. Give each run the context it needs. Report usage to identify waste; honour explicit user budgets without inventing additional limits.

Intake: use a single agent when it can deliver the objective efficiently. Coordinate multiple agents when separable work or independent scrutiny repays the overhead.

Read only your role: [Controller](roles/controller.md), [Worker](roles/worker.md), or [Executive](roles/executive.md). Controller loads [routing](routing.md) for model decisions; Executive loads it for escalation decisions. Workers additionally load their card and named procedure, not other role files.

## Modes

Interpret `$hive-lite <mode>` in Codex or `/hive-lite <mode>` in Claude; these are instructions, not executable subcommands. Session creation follows the user's request and the capabilities of the installed client.

- `setup`: Controller resumes or creates a mission workspace with `jobs/`, `results/`, `channel/workers/`. Record absolute root, objective, workspace, usage baselines, cadence (default five accepted jobs), roster and Executive delivery mode (headless review default, fork or lean per request; Monitor optional). Choose and test a supported notification route before relying on it. Write `executive-briefing.md` (objective, scope, limits, triggers) so lean Executive reviews need no session history. Bind existing sessions only by explicit join, pasted ID or user-selected indexed candidate. Sessions with sensitive operational access require explicit scope. For each role, record expected and observed exact model/effort, session ID, cwd, observation time and source. Flag differences and record a Controller-approved substitution within delegated routing authority or a user-operated correction; never override the user's fixed settings. Missing evidence or a turn predating a reported settings change leaves the new setting UNKNOWN. Recheck on join, handover or a reported settings change; prompts do not change actual settings. Finish with a wake test of each role.
- `join <role> <absolute-mission-root>`: read your role; append JOIN with session ID, actual model/effort and directory to your own outgoing channel. Codex ID: `CODEX_THREAD_ID`; Claude ID: `CLAUDE_CODE_SESSION_ID`, runtime-test before reliance. If unavailable, request a pasted verified ID; never invent one. Codex roles using the qualified watcher route start their watcher (below) and report its PID in the JOIN line. Controller alone copies roster entries to the board. Worker roles use unique IDs, e.g. `worker-1`.
- `status`: Controller reconciles the board, open-attempt artifacts and all relevant channel tails; report missing results, overdue work, failed notification, pending reviews and usage. No calls to other models.
- `plan`: Controller records bounded jobs, tiers, context and procedures; Executive reviews once before execution.

## Optional Codex watcher

This route requires Linux shell tools, a Codex CLI supporting `codex queue`, and compatible rollout lifecycle events. Verify those capabilities in the installed version before use. If unavailable, use supported session controls or manual file-pointer handoffs; record the chosen route on the board. Standard home-directory locations in the template must be adjusted if the client uses a different configuration root.

For this route, senders only append lines to the target's incoming file; nobody calls `codex queue` for routine messages. Each Codex session runs one watcher over its own incoming files: when they change and its session is idle, it queues itself one wake; changes during a turn are held and delivered as one wake when the turn ends. No model tokens are used until it wakes you. Start it once per session (check the board for an existing PID first), with `<files>` from your role file:

```sh
export M="<absolute-mission>"
setsid -f bash > "$M/channel/watch-$CODEX_THREAD_ID.log" 2>&1 <<'WATCH'
SELF="$CODEX_THREAD_ID"; ROLL=$(ls ~/.codex/sessions/*/*/*/*"$SELF"*.jsonl | tail -1)
echo $$ > "$M/channel/watch-$SELF.pid"
sig() { cat <files> 2>/dev/null | wc -l; }
idle() { [ -f "$ROLL" ] && tail -c 2000000 "$ROLL" | grep -o '"type":"\(task_started\|task_complete\|turn_aborted\)"' | tail -1 | grep -qE 'task_complete|turn_aborted'; }
trap '' HUP; last=0; while true; do cur=$(sig)
  if [ "$cur" != "$last" ] && idle; then
    codex queue --thread "$SELF" --message "WAKE $M: new channel/result entries; read them per hive-lite" && last=$cur
  fi; sleep 15; done
WATCH
sleep 1; echo "WATCHER $CODEX_THREAD_ID pid=$(cat "$M/channel/watch-$CODEX_THREAD_ID.pid")"
```

Workers' `<files>`: `$M/channel/workers/<id>/to-worker.md`. Controller's: see controller.md. `setsid -f` detaches it fully. A tool host may terminate plain background children when a tool call ends; verify watcher survival after launch. Idle means a known `task_complete`/`turn_aborted` as the latest lifecycle event; unknown (no event found, missing log) is not idle, so the wake waits. Starting from zero means a (re)started watcher wakes once for any input already waiting; a redundant wake is reconciled as a no-op. A failed wake stays unconsumed and retries on the next pass. Run a watcher only from its owner session, since `$CODEX_THREAD_ID` is the caller's: to restart a dead worker watcher, the Controller queues that worker once with "restart your Hive-Lite watcher" (bootstrap exception), never starting it from its own shell. For clients without a qualified queue route, use headless review, supported session controls or a tested Monitor.

Qualify each provider and notification combination before relying on it. For manual hand-off, the sender saves the result and writes a short file pointer in its own channel; the user delivers that pointer to the selected session.

Long compute jobs need checkpoints and recoverable progress before launch. Use the project's own investigation and validation procedures where applicable; named procedures retain their lifecycle and repair limits.

## The whole job

Hive-Lite coordinates the entire assigned job. Nothing is scoped out because it is governance, evidence, receipts, independent review, validation or adoption; each is an ordinary task, carded and routed like any other.

- **Independent review:** launch a headless reviewer who did not produce the result, from a different model family when required by the project, using the model and effort the decision needs with a prompt naming exactly what to review and asking for optimisation opportunities; its file is the review.
- **Evidence and receipts:** task outputs (files, hashes, test results) written to the mission's results.
- **Project gates:** requirements to satisfy by producing what they ask for, not reasons to hand work elsewhere.
- **External effects:** complete preparation and review before seeking any still-required user approval for deployment, publication, financial or account changes. Existing user authorisation remains valid.

Keep the workflow opt-in. Qualify each notification and provider route before relying on it. This skill promises supervised recovery, not exactly-once delivery or unattended operation.
