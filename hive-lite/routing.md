# Routing and bounded launch

Choose models from the providers available to the operator. Use the lowest capable model and effort, with the context the task needs. Record requested and observed settings; a provider name or a prompt claiming a model is not a model selection. Treat capability equivalence across providers as something to verify.

Define the mission's concrete model choices using these capability tiers:

| Tier | Assignment | Selection principle |
|---|---|---|
| T0 | Deterministic checks | Use ordinary tools without a model |
| T1 | Extraction and mechanical work | Lightweight model with sufficient context |
| T2 | Bounded implementation and analysis | Model that reliably handles the task |
| T3 | Coordination and substantive review | Strong reasoning where the decision needs it |
| T4 | Difficult unresolved work | Higher effort after diagnosis and Executive review |
| T5 | A capability gap beyond existing routes | A stronger model for one bounded assignment |

Controller selects within the mission's authorised T1–T3 routes. T4/T5 need evidence that more capability will help and Executive review within delegated authority. Diagnose tools, credentials, dependencies and unclear cards first. Two escalations of the same problem require reframing. Planning and design work should select effort for the deliverable rather than assume the highest setting.

If a model is unavailable, consider a qualified alternative at the same capability level or a narrower task at a lower level. Record substitutions; unavailability alone does not justify a more expensive escalation. Honour explicit budgets and settings; missing usage is UNKNOWN rather than zero.

Privileged work has one named operation owner. Other workers can review saved evidence. Any handover verifies existing process/session handles and authority before transferring ownership; never duplicate authentication or active operations.

## Launch

Each card fixes the workspace, owned paths, deadline, context and permission mode. Use permission flags only as authorised for that assignment. Examples include Claude `--dangerously-skip-permissions`, Codex `--yolo` and the installed provider's equivalent. When using Codex `--yolo`, replace the sandbox option rather than specifying conflicting permission modes. File ownership and result review still apply.

The following templates require Linux, Bash, `setsid` and GNU `timeout`. Resolve placeholders and quote paths before use. On other platforms use a supported runner that captures equivalent result, exit and process information.

```sh
export R="<absolute-mission>/results/<job>-a<attempt>"; mkdir -p "${R%/*}"
setsid -f bash > "$R.log" 2>&1 <<'RUN'
echo $$ > "$R.pid"; rc=0
timeout -k 60 <deadline-seconds> <command> || rc=$?
echo "$rc" > "$R.exit"
RUN
```

| Route | Command template |
|---|---|
| Codex worker | `codex exec -C "<workspace>" -s "<sandbox>" -m "<model>" -c 'model_reasoning_effort="<effort>"' -o "$R.final.txt" "Read <absolute-card>; do only that job; write your result to $R.md."` |
| Executive fork, when history matters | `claude -p --resume "<executive-session-id>" --fork-session --model "<model>" --effort "<effort>" "<short absolute request-file pointer>" > "$R.verdict.txt"` |
| Executive fresh review | `claude -p --model "<model>" --effort "<effort>" "You are the Hive-Lite Executive. Follow <absolute-skill-root>/roles/executive.md. Read <absolute-mission>/executive-briefing.md, <absolute-mission>/board.md and <absolute-request-file>; print one verdict (continue, defer or stop) with a short reason." > "$R.verdict.txt"` |

Record the concrete model and effort on the board. Verify flags against the installed CLI. Add `--add-dir "<absolute-mission>"` to Codex when the mission lies outside its permitted workspace.

After launch, inspect `pg=$(pgrep -P "$(cat "$R.pid")" -x timeout || true)` in a follow-up check; an immediate lookup can race startup. Record the launch PID, verified timeout-child group and artifact paths. Confirm survival after the launching tool call. With the qualified watcher route, the `.exit` marker wakes the Controller; otherwise use the mission's chosen notification route.

While `.exit` is absent, cancel only a verified timeout-child group with `kill -TERM -- "-$pg"`. If identity is uncertain, reconcile it before acting. Jobs must name and account for any children that outlive the main process. Check both exit status and the expected result: `.md` for workers, `.verdict.txt` for Executive reviews. Missing output requires reconciliation before a rerun; never duplicate possibly running work.
