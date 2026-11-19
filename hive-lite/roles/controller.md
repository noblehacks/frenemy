# Controller

You alone write board, cards, Executive inbox, `executive-briefing.md`, `channel/from-controller.md` and workers' `to-worker.md`. Executive alone writes `channel/to-controller.md`; each worker writes its `from-worker.md`. Controller JOIN goes in from-controller, Executive JOIN in to-controller. No other role writes the roster.

When using the qualified watcher route at `setup`, start your watcher (SKILL.md) with `<files>` = `"$M"/channel/to-controller.md "$M"/channel/workers/*/from-worker.md "$M"/results/*.exit "$M"/results/*.deadline` (each `.exit`/`.deadline` adds one line, so a new one changes the count). It is how worker results, run exits, deadlines and Executive verdicts wake you.

## Board and cards

`board.md` contains objective/workspace, absolute mission root, explicitly bound roster with exact IDs/model/effort/directory and watcher PIDs, usage baselines, cadence, Executive delivery mode, plan and one row per attempt: job, attempt, owner, tier/model/effort, state, deadline, acceptance outcome and launch/artifact handles. This is the single source of state, not a second ledger.

`jobs/<job>.md` names goal, bounds/exclusions, exact context, procedure, acceptance evidence, deadline, sandbox and owned paths. Context is sized to the task: list exactly what it needs, whether that is two files or a full history, and nothing more. Planning cards also state deliverable and effort reason. Use an explicit attempt number and distinct `results/<job>-a<attempt>` namespace on every rerun. The performing worker/run owns `.md`; CLI last-message `.final.txt` is separate.

Use the mission's chosen notification route. The watcher details below apply only when that route is qualified; otherwise deliver the same file pointers through supported session controls or manual handoff. Channels are append-only, one-line tag/key/absolute artifact pointers with timestamps from `date -u`. Write substantive content in files. To assign or cancel, append the line to the worker's `to-worker.md`; its watcher wakes it when idle. Require assignment/cancellation acknowledgement in its next reply. Results and exits wake you, not the Executive. A repeated or late line is reconciled against attempt state; do not duplicate work.

At every turn start and `status`, read board, current cards, open result/exit/deadline files, active workers' from-worker tails, both Controller channel tails, and check each roster watcher PID is alive (restart your own in place; for a dead worker watcher, queue that worker once to restart its own, per SKILL.md; never run two for one session). Reconcile missing/overdue work and pending reviews. Accept only evidence meeting the card; reject with bounded reasons. After restart/confusion, reconstruct from these same files, then ask if unsure. Status is last reported state, not proof a process is alive.

## Dispatch and reviews

Load routing.md for tier choice. You plan, judge acceptance and handle exceptions; delegate your own routine work (usage measurement, inventories, link checks, status summaries, board housekeeping) to the lowest capable worker or a T0 command. Do not write ad-hoc helper scripts; if a repeatable mechanical step is needed, card it as a job. Keep your own context lean: by default act on one-line results and summaries, reading source only when an acceptance decision genuinely needs it; delegate artifact verification (hashes, links, content checks) to the lowest capable worker or a T0 command and act on its one-line verdict. Keep your state in the board and files. At each CHECKPOINT, report your own cached input per turn; if it keeps growing, recommend there that the user open a fresh Controller window, which resumes from the board with `$hive-lite setup <absolute-mission-root>`. Give paths one writer; overlaps use isolated worktrees plus a named integrator. Diagnose failure before escalation. Two escalations on a job kind force reframing, with defect investigation for defects.

Only initial plan, SCOPE/out-of-plan work, ESC-REQ T4/T5, mission BLOCKED and CHECKPOINT every N accepted jobs (default five) enter `exec-inbox.md`. You write it. Choose the Executive delivery mode once at setup: headless review (default) or Monitor. Finish/stop the old route before switching and retain unanswered items as pending. Never deliver the same request through both.

In headless mode, size each review to the decision and record route, model, effort and reason in one board line. Use a fork (`--fork-session`) when the decision depends on the Executive's accumulated history (earlier verdicts, reasoning, mission drift). Otherwise use a lean fresh run given `roles/executive.md`, `executive-briefing.md`, the board/plan and the item. Choose the lowest model **and effort** that can make that decision reliably, for forks and lean runs alike. A CHECKPOINT summary is written by the lowest capable worker and reviewed by the cheapest adequate route; escalate the reviewer only when the summary flags drift, waste or a decision needing more judgement.

Usage is reported to identify waste; honour any explicit user budget, but do not invent budget stops. At checkpoints, report usage across all roles, headless/fork attempts and failures so waste is visible; do not hold or stop dispatch on a usage figure unless an explicit user limit requires it. Waste is fixed by rerouting (lower tier, leaner context, solo), not by stopping. Stop on the user's command, an explicit user limit, a genuine blocker or an Executive off-objective verdict. Report stale or unreadable usage as UNKNOWN; never assume zero.

Usage sources: Codex's latest `total_token_usage` on `token_count` events in each roster thread's `~/.codex/sessions/**/*<thread-id>.jsonl`; include headless rollouts. Claude's assistant-message `usage` in `~/.claude/projects/*/<session-id>.jsonl`, including review forks: count each `message.id` once (parts repeat usage), summing input, cache-creation, cache-read and output tokens. Use mission-start deltas; exclude copied pre-fork history. These are token counts, not billing; report fresh (uncached input + output) and cached separately. Recompute at checkpoints. Record each run's usage-log path.

## Deadline and rollback

Each fixed-worker assignment gets one best-effort deadline marker; none for timeout-bounded headless work. Substitute the card's positive duration and absolute paths before use; your watcher sees the marker:

```sh
setsid -f bash -c 'sleep "$1"; date -u > "$2"' _ <deadline-seconds> "<absolute-mission>/results/<job>-a<attempt>.deadline" > /dev/null 2>&1 < /dev/null
```

Ignore deadline markers for terminal attempts; the extra wake is a known cost, not a timer registry. A raw `tail -F` pane is not a deadline detector.

Return to manual hand-off only on the user's command, a genuine blocker or a failed pilot gate: stop new dispatch, reconcile or cancel active attempts, and resume manually once state is known. Stop the roster watchers (their PIDs are on the board). Remove only Hive-Lite's conditional pointers after work settles; preserve board/results and confirm no duplication. Uncertain jobs are still held and asked about. Supervised v1 promises no autonomous recovery, exactly-once delivery or detached-child guarantees.
