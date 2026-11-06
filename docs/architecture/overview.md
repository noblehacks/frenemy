# Current architecture

This page describes the checked-in relay. The only planned additions are Grok Build and Cline CLI support.
Source anchors refer to functions and constants in `ask-claude-mcp.mjs`.

## Two delegation paths

Codex starts the Node stdio MCP server configured by the installer. The server's
`TOOLS` list contains only `ask_claude` and `ask_claude_write`, each accepting a
`prompt`. `runClaude` starts a fresh `claude -p --output-format json` child for every
call, feeds the prompt through stdin, parses the final JSON result, and returns a
single MCP text response. Calls have no durable job IDs, progress stream, resume
operation, or public cancellation tool.

Claude-to-Codex delegation is separate: `CLAUDE-codex-section.md` supplies instructions
for invoking `codex exec`. The relay does not enforce that direction's command flags.
The optional `genimg.sh` wrapper uses a temporary workspace, requests one image, then
moves the output to the selected path. It is supplied for Mac/Linux and is not part
of the proposed integration's acceptance scope.

## Execution and permission boundaries

`SERVER_CWD` fixes each Claude child's directory to the server's startup directory.
Callers cannot provide a different directory in the tool arguments. On Windows,
`resolveClaudeOnWindowsPath` searches absolute PATH directories for `claude.exe`;
there is no `.cmd` fallback or shell launch.

Read calls pass `--safe-mode`, `--strict-mcp-config`, and disallow Bash, Edit, Write,
NotebookEdit, WebFetch, and WebSearch. This is the policy requested from Claude CLI;
actual enforcement on installed CLI versions needs runtime validation. Write calls
pass `--permission-mode acceptEdits --setting-sources user` and may edit the current
workspace. They do not create isolated Git worktrees. The installer auto-approves
only `ask_claude`; it does not add approval for `ask_claude_write`.

`sanitize` removes terminal controls and recognized private-key blocks before the
answer is returned. It is not comprehensive credential redaction. User-level settings
remain available to write calls, so recursive delegation is not fully prevented.

## Limits and protocol handling

- `TIMEOUT_MS`: 600,000 milliseconds, then kill the direct child.
- `MAX_CONCURRENT`: four active Claude calls per server process. Excess calls fail
  immediately; there is no queue or shared host-wide scheduler.
- `MAX_OUTPUT_CHARS`: 2,097,152 JavaScript string code units for stdout. Stderr is
  appended while below the threshold and can exceed it by the final chunk.
- `MAX_LINE_CHARS`: 8,388,608 string code units for each incoming protocol line.
  Oversized lines are discarded; invalid JSON receives a parse error.
- Notifications receive no reply. `initialize`, `ping`, `tools/list`, and
  `tools/call` are handled; unknown methods receive JSON-RPC error -32601.

A timeout kills the direct child. A relay restart loses active in-memory execution state.
The Grok/Cline integration preserves this blocking lifecycle; it does not add durable
transcripts, recovery, session continuation, or review-output retention.

## Installation and versions

`install.ps1` checks Node, Claude, and Codex and requires a native Claude executable.
It pins the resolved Node path in `~/.codex/config.toml` and appends the delegation
section to `~/.claude/CLAUDE.md`. `install.sh` provides the existing Mac/Linux path
and optional image-helper installation. Existing entries are skipped, not upgraded.
The installers warn about old versions and skip existing managed entries. They are
part of the baseline. The integration extends the existing relay with Grok Build
and Cline CLI calls.

The source currently reports MCP server version `1.4.0`; `.version` is `0.0.1-3`.
The mismatch is documented here without changing either product value.

See [the integration plan](../plans/grok-cline-integration.md) for the proposed Grok/Cline behavior and [validation status](../testing/validation.md) for the accepted design and pending product tests.

## Source-pinned C4 baseline and target design

The approved Phase 2 amendment adds a [Structurizr workspace](structurizr/support-only/README.md) with baseline c7338ad39b646e695e7c4b5fbd998d45be914c02, separate target design, four C4 levels, deployment/dynamic views, source evidence and requirement traceability. This overview still describes the shipped source. Architecture validation precedes executable product TDD.



## Planned Grok and Cline calls

The [binding contract](../contracts/grok-cline-support.md#scope-of-native-controls)
describes how the existing relay invokes each CLI and selects its native read
or explicit write mode.
