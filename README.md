# Frenemy: Claude, Codex, Grok, and Cline

Lets Codex delegate to Claude Code, Grok Build, and Cline CLI while preserving the
existing Claude-to-Codex instructions, so you do not have to copy/paste between them.
It uses each native CLI's existing authentication. The relay does not collect API keys.

This is the [sharpninja fork](https://github.com/sharpninja/frenemy) of
[noblehacks/frenemy](https://github.com/noblehacks/frenemy). The current relay supports
Claude Code, Codex, Grok Build, and Cline CLI. Grok and Cline calls retain the existing blocking relay model and support caller-selected provider, model, and effort where the target accepts them.

See the [documentation index](https://github.com/sharpninja/frenemy/blob/main/docs/README.md), [current architecture](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/overview.md),
[validation status](https://github.com/sharpninja/frenemy/blob/main/docs/testing/validation.md), and [integration plan](https://github.com/sharpninja/frenemy/blob/main/docs/plans/grok-cline-integration.md).
`PLAN-FRENEMY-001` is complete. The separate test-only `PLAN-FRENEMY-002` tracks the
four-agent reasoning integration and awaits its final hostile-validation gate.

Version identifiers currently differ: `.version` contains `0.0.1-3`, while the MCP
initialization response advertises `1.4.0`. The expanded version-2 job-service design is superseded; the active plan adds only Grok/Cline support to the existing relay.

Created by **Zakariya Syed**:
[YouTube](https://youtube.com/@noblehacksacademy) ·
[LinkedIn](https://www.linkedin.com/in/zakariya-syed/) ·
[X](https://x.com/ZakariyaHacks) ·
[GitHub](https://github.com/noblehacks)

Not affiliated with OpenAI or Anthropic. MIT licensed (see LICENSE).

The relay remains dependency-free JavaScript. Read-only delegation is the default. File edits
use separate explicit-write tools that are never auto approved by Frenemy.

**Prerequisites:** `node` (18 or newer), the `claude` CLI, and the `codex` CLI, all
installed, on `PATH`, and signed in (run `claude` and `codex` once each to log in).
The Grok and Cline tools additionally require the native `grok` or `cline` CLI on
the relay process's `PATH` and already authenticated through that CLI.

## How to use it

**In the Claude chat**, Claude shells out to `codex exec`:
> "Get Codex to generate a hero image and put it in the page."
> "Have Codex review this diff."

**In the Codex chat**, Codex calls the `ask_claude` tool:
> "Ask Claude to review app.py."
> "Have Claude refactor this file." (uses `ask_claude_write`, see approval note below)
> "Ask Grok to review this change." (uses `ask_grok`)
> "Have Cline update this module." (uses `ask_cline_write`)

That's it.

## What's actually installed

| Piece | What it does |
|---|---|
| `ask-claude-mcp.mjs` (this folder) | Frenemy itself. Gives Codex read and explicit-write tools for Claude Code, Grok Build, and Cline CLI. |
| `frenemy.config.json` and `frenemy.config.schema.json` | Optional per-agent provider, model, and effort defaults with a versioned schema. They never contain credentials. |
| `Protect-GrokPrompt.ps1` | Windows helper that protects Frenemy's owned Grok prompt file before prompt bytes are written. |
| `install.sh` / `install.ps1` (this folder) | One-command installers (Mac/Linux and Windows). They do the config wiring for you. |
| `codex` CLI (tested with v0.144.1) | `codex exec` is how Claude drives Codex. |
| `codex-plugin-cc` (optional) | OpenAI's official Claude Code plugin: `/codex:review`, `/codex:transfer`, `/codex:rescue`. Not included. Install it via Claude Code's plugin marketplace. |

## Install (one command)

Put this folder somewhere permanent, open a terminal inside it, and run:

**Mac / Linux:**
```bash
bash install.sh
```

**Windows (PowerShell):**
```powershell
.\install.ps1
```
(If Windows blocks the script: `pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ./install.ps1`)

The installers run without administrator access. They check for Node.js, Claude Code and Codex, and warn if Node.js is older than 18 or Codex is older than 0.144. Windows requires a native `claude.exe`. macOS and Linux offer the optional image helper. Existing configuration entries are skipped on reruns. Restart Codex after installation.

**Don't move or delete this folder afterwards.** Codex's config points at it.

<details>
<summary>Manual install (exactly what the script does, if you'd rather do it by hand)</summary>

**1.** Add this to `~/.codex/config.toml` (replace both paths: `which node` prints the first;
the second is wherever you put this folder. Both must be absolute; on Windows use forward
slashes). Both blocks are required; see "The critical config line" below for why:
```toml
[mcp_servers.claude]
command = "/ABSOLUTE/PATH/TO/node"
args = ["/ABSOLUTE/PATH/TO/frenemy/ask-claude-mcp.mjs"]
tool_timeout_sec = 600

[mcp_servers.claude.tools.ask_claude]
approval_mode = "approve"
```

(`tool_timeout_sec = 600` matters: without it Codex gives MCP tools only a short default
timeout, and long Claude answers would get cut off client-side.)

Grok and Cline are discovered from absolute `PATH` entries. To pin either native binary,
append `"--grok-executable", "/ABSOLUTE/PATH/TO/grok"` or
`"--cline-executable", "/ABSOLUTE/PATH/TO/cline"` to the `args` array. Windows pins must
name an existing `.exe`; Linux pins must name an executable regular file. The installers
do not add, authenticate, or configure these optional CLIs.

**2.** Append the contents of `CLAUDE-codex-section.md` (in this folder) to your
`~/.claude/CLAUDE.md`. That's what teaches Claude how to call Codex safely.

**3. (Optional, only if you want image generation; Mac/Linux only)** copy `genimg.sh` to
`~/.claude/scripts/genimg.sh` and make it executable. It's a one-shot wrapper Claude uses
to have Codex generate an image (gpt-image-2) reliably, with correct sandbox flags and quoting
every time. Skip it if you don't care about images; nothing else depends on it.

</details>

## Smoke test: verify it works on your machine

- Codex → Claude: in a Codex chat, say "Ask Claude to review any file in this repo."
  You should get Claude's review relayed back without touching Claude yourself.
- Codex → Grok or Cline, when that native CLI is installed and authenticated: ask the
  selected agent to return a unique marker, then try the separate write tool on a disposable
  file and verify its exact bytes.
- Claude → Codex: in a Claude chat, say "Ask Codex to review a file in this repo." Claude should report Codex's findings. The image helper has a separate setup step on macOS and Linux.

## The fine print (click any line to expand)

<details>
<summary><b>Why a custom file instead of <code>claude mcp serve</code></b></summary>

The obvious approach, `codex mcp add claude -- claude mcp serve`, **is not what you want.**
`claude mcp serve` hands out Claude's *raw tools* (Read, Bash, Agent). There is no
"send this prompt to Claude and get an answer" operation at all, and tools that need
permission can stall waiting for an approval no one is there to give.

`ask-claude-mcp.mjs` sidesteps that by exposing plain tools backed by `claude -p`
(Claude's headless mode). `claude -p` answers a question and exits. It never prompts.
That single change is the whole fix.

</details>

<details>
<summary><b>The critical config line (the installer adds it for you; read this if you install by hand)</b></summary>

(Not a secret or an API key, just one line of config that everything depends on.
The installer adds it for you.)

Headless `codex exec` auto-denies MCP tool calls (`user cancelled MCP tool call`) unless you
set a **per-tool** approval mode. The *global* approval settings (`approval_policy=never`,
`approval_policy={granular=...}`) do **not** work. This trips people up, and the usual
"fix" people reach for is `--dangerously-bypass-approvals-and-sandbox`, which throws away
the sandbox. You don't need it. The real answer is the second block you added in install
step 1:

```toml
[mcp_servers.claude.tools.ask_claude]
approval_mode = "approve"
```

With that line, `codex exec` can call Claude read-only with no extra flags. To be precise
about what that means: Codex's sandbox around *shell commands* stays intact, but the relay
itself runs **outside** that sandbox (that's the whole point: sandboxed commands can't
reach Claude's login). Auto-approving `ask_claude` means you're trusting this one tool to
run outside the wall. It's read-only-enforced and capped, but it's a real trust decision.

**Deliberately not auto-approved:** `ask_claude_write` (the file-editing variant). In an
interactive Codex session you'll get an approval prompt when it's used. That's the point.
Auto-approving a tool that edits files means anything Codex reads (a web page, a README)
could silently trigger edits to your code. Only add an `approval_mode` line for it if you
fully accept that risk.

</details>

<details>
<summary><b>Security: what is locked down</b></summary>

- Claude runs in the MCP server's startup working directory (normally the Codex workspace).
  Tool callers cannot change that directory. (Claude's own file-permission rules are what
  govern which paths it may read.)
- Read-only is **enforced**: `ask_claude` runs Claude in `--safe-mode` (which disables all
  of your own customizations: hooks, plugins, MCP servers, CLAUDE.md, skills) with the
  side-effect tools additionally switched off (`--disallowedTools`: file editing, the shell,
  and web fetch/search), even if your settings would allow them. Subagents stay available
  and inherit the same bans. Edits require the separate, unapproved-by-default
  `ask_claude_write` tool.
- `ask_claude_write` loads only your **user-level** settings (`--setting-sources user`).
  Hooks, plugins, or MCP servers that a cloned repository ships in its project settings are
  ignored, so a random repo can't inject its own automation into the relay.
- A stuck `claude` child is killed after 10 minutes. Stdout is capped at 2,097,152
  JavaScript string code units (not a byte limit); at most 4 calls run at once.
  Extra calls are rejected rather than queued. The implementation kills the direct
  child and does not provide process-tree cancellation.
- Prompts pass via stdin, not command-line arguments, so they don't show up in process lists.
- `ask_grok` and `ask_grok_write` use a protected temporary prompt file because Grok's
  native headless interface requires a filename. The relay keeps prompt bytes out of argv,
  restricts the file before writing, and removes its owned temporary directory afterward.
- Grok read mode exposes only its native read/search tools. Grok write mode explicitly
  permits its native Edit and Write tools. Both deny shell, MCP and web tools.
- Cline runs through ACP protocol 1 with auto-approval disabled. The relay approves only
  the documented read/search tools in read mode and the documented edit tools in write mode;
  shell, web, delegation, MCP, Delete, Move, malformed and unknown requests are rejected.

</details>

<details>
<summary><b>Known limits</b></summary>

- **Codex edits files on its own** when given `--sandbox workspace-write`. Work on a branch.
- **Codex → agent calls are one-shot and blocking.** Every Claude, Grok, or Cline relay
  call starts a fresh native turn with no Frenemy-managed memory, streaming, or progress output.
  There is no background job handle and no cancel; Codex gets one final answer, and a stuck
  call is killed after 10 minutes.
- **Claude → Codex is instruction-driven, not an enforced boundary.** `CLAUDE-codex-section.md`
  teaches Claude which `codex exec` flags to use, but nothing forces them. Frenemy is meant
  for local, single-user use. Review write approvals, and don't treat repository content or
  model output as trusted instructions.
- **Limited recursion guard.** `ask_claude` runs in safe mode, so that Claude doesn't even
  know Codex exists and can't call it back. But `ask_claude_write` loads your user-level
  config (including the CLAUDE.md Codex section), and Claude→Codex→Claude chains through it
  could burn both subscriptions' rate limits. Each hop is bounded by the 10-minute timeout,
  but don't ask them to play ping-pong.
- **Re-running the installer skips, it doesn't upgrade.** If you install a newer version of
  this package, delete the old `[mcp_servers.claude]` block and the old "# Codex is always
  available" section first, then re-run the installer. That also picks up config improvements
  (like the pinned absolute `node` path) that a skipped run leaves behind.
- **Windows requires the native Claude installer** (`claude.exe`). An npm-installed
  `claude.cmd` shim won't launch. That is deliberate: launching through a shell would let a
  malicious repo plant a fake `claude.cmd` in the project folder and hijack the relay.
- **Rate limits are shared.** Codex CLI, the IDE pane, and ChatGPT web all draw from the
  same rolling 5-hour ChatGPT limit. Delegating a lot eats into your normal usage.
- **No video.** Codex generates images (gpt-image-2), not video. Sora isn't reachable this way.
- **Reasoning effort doesn't change the picture much.** Images always come from gpt-image-2;
  the text model only drives the tool. Lower effort saves *its* cost, not the image cost,
  and the image is not guaranteed identical.

</details>

## FAQ (click a question for the answer)

<details>
<summary><b>Claude tells me to run <code>/doctor</code>, or to run <code>claude install</code>. What do I do?</b></summary>

Claude Code is phasing out npm installs. Run `claude install` once to switch to the native
version. Frenemy works with either kind on Mac/Linux; Windows requires the native one.

</details>

<details>
<summary><b>The image script fails on <code>--ephemeral</code>, or Codex tool calls act odd. Why?</b></summary>

Your Codex CLI is too old. Frenemy is tested with Codex 0.144 and newer. Check with
`codex --version`, update with `npm install -g @openai/codex@latest` (or `brew upgrade codex`),
then restart Codex.

</details>

<details>
<summary><b><code>npm install -g</code> fails with permission denied (EACCES). What now?</b></summary>

On many machines npm's global folder is owned by root. Re-run the same command with `sudo`
in front (only for packages you trust; npm install scripts run as root). To never need
sudo again, install Node with a version manager like nvm.

</details>

<details>
<summary><b>Image generation (or any <code>codex exec</code> run) fails with a "model rejected" error, but interactive Codex works fine. Why?</b></summary>

Your `~/.codex/config.toml` pins a `model = "..."` that OpenAI has since retired. Interactive
Codex picks its model in the UI, so it doesn't notice; `codex exec` obeys the stale pin and
fails. Fix: delete the `model = ...` line from `~/.codex/config.toml` and restart Codex. With
no pin, Codex uses its current default model. (The installer warns you if it sees a pin.)

</details>

### Grok and Cline support

The relay exposes `ask_grok`, `ask_grok_write`, `ask_cline` and `ask_cline_write` alongside the existing Claude tools. Each takes one prompt and returns one answer or tool error. The two write tools explicitly select write mode. A missing or unavailable optional CLI affects only calls to that CLI.

Every Claude and Grok tool also accepts optional `model` and `effort` inputs. Every Cline tool accepts optional `provider`, `model`, and `effort` inputs. Caller values override matching defaults in `frenemy.config.json`; if neither is present, Frenemy omits the selector so the native CLI keeps its own default. The adjacent `frenemy.config.schema.json` documents the versioned configuration. These files contain selector defaults only, never credentials or authentication material.

Claude and Grok selectors are passed as discrete native arguments. Cline ACP receives provider and model only in the child process environment and effort through `--thinking`; Frenemy does not modify its parent environment. Invalid or unknown configuration fails closed before an agent is launched. Use `--config <absolute-path>` to select an alternate configuration for an isolated deployment or test. The complete relay was validated through the Nuke `Validate` target on Windows and Linux with Grok 1.0.70 and Cline 3.0.74. See the [integration plan](https://github.com/sharpninja/frenemy/blob/main/docs/plans/grok-cline-integration.md), [binding contract](https://github.com/sharpninja/frenemy/blob/main/docs/contracts/grok-cline-support.md), [Phase 4 release evidence](https://github.com/sharpninja/frenemy/blob/main/docs/receipts/release/20261106T212840-phase4-release/summary.md), and [current validation status](https://github.com/sharpninja/frenemy/blob/main/docs/testing/validation.md).
