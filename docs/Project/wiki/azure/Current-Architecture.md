# Current architecture

This page describes the checked-in JavaScript relay. Source anchors refer to functions
and constants in `ask-claude-mcp.mjs`.

## Delegation paths

Codex starts the Node stdio MCP server configured by the installer. The server exposes six
tools: `ask_claude`, `ask_claude_write`, `ask_grok`, `ask_grok_write`, `ask_cline`, and
`ask_cline_write`. Each call starts one native agent turn in the server startup directory and
returns one MCP text response or tool error. There are no durable job IDs, progress streams,
resume operations, or public cancellation tools.

Claude-to-Codex delegation remains separate. `CLAUDE-codex-section.md` supplies instructions
for invoking `codex exec`; the relay does not enforce that direction's flags. The optional
`genimg.sh` wrapper is available on macOS and Linux and remains outside the Grok/Cline
implementation scope.

## Configuration and selectors

`frenemy.config.json` and `frenemy.config.schema.json` define optional, versioned defaults.
Claude and Grok accept `model` and `effort`; Cline accepts `provider`, `model`, and `effort`.
Each field resolves independently from the caller value, then the matching agent default,
then omission so the native CLI retains its own default. Configuration is read once at relay
startup. Unknown properties, invalid versions, malformed JSON, invalid selector values, and
unavailable explicit configuration paths fail closed before an agent is launched.

Claude receives model and effort as discrete native arguments. Grok receives model and
reasoning effort as discrete native arguments. Cline receives provider and model in the child
process environment and effort through `--thinking`; the parent process environment is not
modified. The configuration contract does not accept credentials.

## Execution and permission boundaries

`SERVER_CWD` fixes every child to the relay startup directory. Tool callers cannot choose a
different working directory. Native Grok and Cline executable discovery accepts absolute PATH
entries on Windows and Linux, with optional absolute executable overrides. A missing optional
CLI affects only calls targeting that CLI.

Claude read calls use safe mode, strict MCP configuration, and explicit side-effect tool bans.
Claude write calls use edit acceptance with user-level settings only. On Windows, Claude is
resolved to an absolute native `claude.exe` from PATH rather than launched through a shell.

Grok receives the prompt through a Frenemy-owned temporary file rather than argv. Windows
uses `Protect-GrokPrompt.ps1` to protect the directory and file before the prompt is written;
Linux creates them with restrictive modes. Read calls expose only native read/search tools.
Write calls additionally allow native Edit and Write. Both modes deny shell, MCP, and web
tools, and Frenemy removes its owned temporary directory after the call or reports residue if
cleanup fails.

Cline runs through ACP protocol 1 with native auto-approval disabled. Frenemy validates each
permission request against the documented read/search or edit allow-list, operation kind, and
input shape. Shell, web, delegation, MCP, Delete, Move, malformed, and unknown requests are
rejected. Read mode cannot approve edit tools; write mode adds only the documented edit tools.

All returned text passes through `sanitize`, which removes terminal controls and recognized
private-key blocks. This is best-effort sanitization, not comprehensive credential redaction.

## Limits and protocol handling

- `TIMEOUT_MS`: 600,000 milliseconds for each native turn, then the direct child is killed.
- `MAX_CONCURRENT`: four active Claude, Grok, or Cline calls per relay process. Excess calls
  fail immediately; there is no queue or host-wide scheduler.
- `MAX_OUTPUT_CHARS`: 2,097,152 JavaScript string code units for native output and final answers.
- `MAX_LINE_CHARS`: 8,388,608 string code units for each incoming MCP protocol line.
- MCP notifications receive no reply. `initialize`, `ping`, `tools/list`, and `tools/call` are
  handled; unknown methods receive JSON-RPC error `-32601`.

A relay restart loses active in-memory execution state. The Grok and Cline tools preserve the
existing one-shot blocking lifecycle; they do not add durable transcripts, recovery, session
continuation, or review-output retention.

## Installation and versions

`install.ps1` and `install.sh` retain their existing Claude/Codex setup behavior. They do not
install, authenticate, or configure Grok Build or Cline CLI. Optional Grok and Cline binaries
are discovered from absolute PATH entries or explicit relay arguments. Existing managed
installer entries are skipped rather than upgraded. The optional macOS/Linux image helper is
unchanged.

The MCP initialize response reports server version `1.4.0`; `.version` contains `0.0.1-3`.
This mismatch is documented without changing either product value.

See the completed [Grok and Cline integration plan](https://github.com/sharpninja/frenemy/blob/main/docs/plans/grok-cline-integration.md), the [binding contract](https://github.com/sharpninja/frenemy/blob/main/docs/contracts/grok-cline-support.md), and the [validation status](https://github.com/sharpninja/frenemy/blob/main/docs/testing/validation.md).

## C4 architecture and test-only orchestration

The [Structurizr workspace](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/support-only/README.md)
keeps the source-pinned baseline at `c7338ad39b646e695e7c4b5fbd998d45be914c02`
separate from the implemented Grok/Cline target. It includes context, container, component,
code, deployment, and dynamic views with source evidence and requirement traceability.

`PLAN-FRENEMY-002` adds an opt-in JavaScript integration harness in the test tree. It asks
Claude, Codex, Grok, and Cline the same five questions and archives their boundary-visible
answers and peer judgments. That harness does not add product tools, services, persistence,
permissions, installer behavior, or workstation configuration.
