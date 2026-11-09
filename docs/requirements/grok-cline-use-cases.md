# Grok and Cline support use cases

These use cases belong only to the approved extension of the existing Frenemy stdio relay. They do not introduce a job service, scheduler, durable storage, worktree management, plugin management, workstation configuration, or another runtime service.

## UC-SUPPORT-GROK: Ask Grok through Frenemy

- Primary actor: caller using the current Frenemy MCP relay.
- Precondition: the relay is running on Windows or Linux and a compatible Grok Build CLI is available through the binding contract's executable selection.
- Main flow: the caller selects `ask_grok` for read-only work or `ask_grok_write` for explicit file-changing work, optionally supplies model and effort, and receives caller/config/native precedence. The relay validates the inputs, invokes Grok in the server startup directory with the documented native mode controls, and returns one attributable text answer or MCP tool error.
- Failure flow: invalid input, unsupported platform, executable failure, prompt-protection failure, invalid native output, timeout, overflow, or cleanup failure returns one explicit error and releases the shared call slot once.
- Postcondition: a single answer or error is returned. File effects are possible only through the explicit write tool and are verified independently of answer text.
- Traceability: FR-FRENEMY-114, FR-FRENEMY-115, FR-FRENEMY-116, TR-FRENEMY-ADAPTER-118, TR-FRENEMY-CONFIG-120, TEST-FRENEMY-114, TEST-FRENEMY-115, TEST-FRENEMY-116, R01-R05, R07, Q01. Phase 3 implements and qualifies the behavior; Phase 4 validates release evidence.

## UC-SUPPORT-CLINE: Ask Cline through Frenemy

- Primary actor: caller using the current Frenemy MCP relay.
- Precondition: the relay is running on Windows or Linux and a compatible Cline CLI is available through the binding contract's executable selection.
- Main flow: the caller selects `ask_cline` for read-only work or `ask_cline_write` for explicit file-changing work, optionally supplies provider, model, and effort, and receives caller/config/native precedence. The relay validates the inputs, conducts one ACP session in the server startup directory with those resolved selectors, returns exact native permission decisions, and returns one attributable text answer or MCP tool error.
- Failure flow: invalid input, unsupported platform, executable failure, ACP initialization or session error, malformed permission request, incomplete stop, timeout, or overflow returns one explicit error without partial answer text and releases the shared call slot once.
- Postcondition: a single answer or error is returned. File effects are possible only through the explicit write tool and are verified independently of answer text.
- Traceability: FR-FRENEMY-114, FR-FRENEMY-115, FR-FRENEMY-116, TR-FRENEMY-ADAPTER-118, TR-FRENEMY-CONFIG-120, TEST-FRENEMY-114, TEST-FRENEMY-115, TEST-FRENEMY-116, R01, R02, R04, R05, R07, Q02. Phase 3 implements and qualifies the behavior; Phase 4 validates release evidence.

## UC-SUPPORT-ARCHITECTURE: Accept the relay architecture before TDD

- Primary actor: Frenemy maintainer.
- Precondition: the Phase 1 requirements, binding contract, case design, baseline source evidence, and pinned render tooling are available.
- Main flow: the maintainer checks the source-pinned baseline, limited Grok/Cline target, four C4 levels, Windows/Linux target deployments, call sequences, change legend, requirement traceability, rendering receipts, and diagram readability.
- Failure flow: a missing source anchor, unexplained target element, broken trace edge, validation error, unreproducible render, unreadable view, or out-of-scope integration keeps Phase 2 open and prevents executable TDD.
- Postcondition: Phase 2 has an evidence-backed acceptance decision. Architecture acceptance does not establish product behavior or satisfy Phase 3 or Phase 4 criteria.
- Traceability: FR-FRENEMY-113, TR-FRENEMY-ARCH-117, TEST-FRENEMY-113, A01. Phase 2.

## Live-store persistence receipt

The source-controlled IDs above are the canonical architecture aliases. On November 6, 2026, live UC creation first rejected valid FR-FRENEMY-113/114 links as the wrong requirement kind, then failed unlinked creation because a legacy workspace update attempted to write an overlength historical scope value. The three exact create requests are retained through the supported Codex MCP failsafe queue. Per the operator's instruction, this QBrain persistence defect does not block the scoped Frenemy documentation and architecture work. No failed call was reported as saved.
