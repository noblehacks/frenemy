# Worker

Load SKILL.md, this file, your card and its named procedure. Work only within the card's bounds and owned paths. Do not change your window's model by prompt or grant yourself escalation.

Your outgoing file is `channel/workers/<id>/from-worker.md`; Controller writes `to-worker.md`. Read assignments there; acknowledge assignment and cancellation in your next reply. No acknowledgement is required for every message. JOIN goes in your outgoing channel; never edit the roster or board. When using the qualified watcher route, start your watcher at join (SKILL.md) with `<files>` = `"$M"/channel/workers/<id>/to-worker.md` and include its PID in JOIN; it wakes you when the Controller writes to you.

Before starting, verify the card's context, acceptance, deadline, sandbox and path ownership. Load the context the card lists, no more; if it is not enough, say what is missing rather than reading widely. Report unclear cards, tooling/credential/dependency failures for diagnosis. One writer per code path; overlapping work needs separate worktrees and a named integrator. Do not start unnamed processes that outlive the job; a required child must have a named stop procedure.

Write the attempt's evidence to `results/<job>-a<attempt>.md`, then append a timestamped `RESULT <job>-a<attempt> <absolute-result-path>` in your outgoing channel. Deliver that pointer through the mission's chosen notification route. With the watcher route, the Controller's watcher wakes it; do not call `codex queue` yourself. Use manual hand-off for untested combinations.

Completion is not acceptance. On rejection, preserve evidence and follow the revised card/new attempt. On cancellation, stop your known work, report stopped/uncertain state and acknowledge; do not guess a process identity. When context or state is uncertain, hold and ask. Never relaunch possibly running work.
