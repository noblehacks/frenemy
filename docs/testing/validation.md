# Validation status

## Existing baseline

The inspected repository has no automated test project, test suite, package manifest,
or Nuke build entrypoint. The README provides manual delegation smoke scenarios.
The documentation refresh inspected source and configuration; it does not establish
that live Claude or Codex calls pass on either platform.

QBrain acceptance criteria extracted from documented or implemented behavior are
specifications, not passing test results. TEST-FRENEMY-101 through TEST-FRENEMY-113, except withdrawn TEST107, define planned coverage; executable product fixtures and TDD remain deferred until architecture acceptance.
McpServer Agent Helper test receipts under `docs/receipts/` concern supporting
infrastructure and do not prove Frenemy routing or permission behavior.

## Planned v2 coverage

High-priority TODO `PLAN-FRENEMY-001` retains the full approved integration plan and its
five-phase architecture-before-TDD gate. It calls for 12 directed routes among Claude Code, Codex, Grok Build,
and Cline CLI, in two access modes on Windows and Linux: 48 combinations.

Each implementation increment must first prove its assertions using independent
correct mocks and deliberately incorrect negative controls inside a passing suite.
Only then may the same cases and assertions bind to production behavior. Nuke will
orchestrate Node tests, PowerShell checks, and integration validation; those targets
are planned and are not present today.

Additional cases cover read-policy escapes, configured-workspace writes,
identity mismatches, duplicate requests, malformed events, cancellation races,
restart/reboot recovery, exact-session continuation, long transcripts, local result retrieval,
and installer migration/rollback. A phase exits only with its complete required
Windows/Linux evidence and the independent review specified in the plan.

No requirement, acceptance criterion, TODO phase, or integration route is marked
complete by this documentation refresh or by exporting the requirements.

## Architecture validation

See [Phase 2 architecture workspace](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/README.md) for the source-pinned model, local renderer, traceability and retained validation receipts. Automated architecture checks do not establish production behavior. The independent architecture review and visual inspection must pass before TDD starts.
