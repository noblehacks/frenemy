# Frenemy: Claude ↔ Codex

Lets Claude and Codex call each other, so you never copy/paste between them.
Runs on the **Claude and ChatGPT subscriptions**. No API keys.

Created by **Zakariya Syed**:
[YouTube](https://youtube.com/@noblehacksacademy) ·
[LinkedIn](https://www.linkedin.com/in/zakariya-syed/) ·
[X](https://x.com/ZakariyaHacks) ·
[GitHub](https://github.com/noblehacks)

Not affiliated with OpenAI or Anthropic. MIT licensed (see LICENSE).

Both directions in one tiny file, no dependencies. Read-only by default. File edits live in
a separate tool that is never auto approved.

**Prerequisites:** `node` (18 or newer), the `claude` CLI, and the `codex` CLI, all
installed, on `PATH`, and signed in (run `claude` and `codex` once each to log in).

## How to use it

**In the Claude chat**, Claude shells out to `codex exec`:
> "Get Codex to generate a hero image and put it in the page."
> "Have Codex review this diff."

**In the Codex chat**, Codex calls the `ask_claude` tool:
> "Ask Claude to review app.py."
> "Have Claude refactor this file." (uses `ask_claude_write`, see approval note below)

That's it.

## What's actually installed

| Piece | What it does |
|---|---|
| `ask-claude-mcp.mjs` (this folder) | Frenemy itself. Gives Codex two tools: `ask_claude` (read-only) and `ask_claude_write` (may edit files). |
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
(If Windows blocks the script: `powershell -ExecutionPolicy Bypass -File install.ps1`)

No sudo/admin needed. It only writes to config files in your home folder. It checks that
`node`, `claude`, and `codex` are installed, wires up both sides of the relay, and (on
Mac/Linux) offers the optional image script. Safe to run twice. When it finishes, restart Codex.

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
- Claude → Codex: in a Claude chat, say "Have Codex generate a 512×512 blue circle PNG
  into this folder." The image should appear **directly in the project folder**.

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
  of your own customizations: hooks, plugins, MCP servers, CLAUDE.md, skills) and hands it
  an **allowlist** of tools, `--tools "Read,Glob,Grep,Agent"`, so the side-effect tools are
  absent rather than merely denied. They are named in `--disallowedTools` as well, as a
  second lock if the allowlist is ever widened. Edits require the separate,
  unapproved-by-default `ask_claude_write` tool.
  An allowlist rather than a denylist because **`PowerShell` is a separate tool from
  `Bash`**: it is switched on by `CLAUDE_CODE_USE_POWERSHELL_TOOL` or by the Windows
  rollout rather than by your settings, so denying `Bash` alone used to leave a full shell
  available on Windows.
  Subagents stay available and inherit the restriction. Measured through the relay on
  Claude Code 2.1.220: the parent reports `Agent, Glob, Grep, Read`, a spawned
  general-purpose subagent reports the identical set, and a subagent nested below that one
  declaring `Tools: *` reports the same set again. No level has a shell.
- `ask_claude_write` loads only your **user-level** settings (`--setting-sources user`).
  Hooks, plugins, or MCP servers that a cloned repository ships in its project settings are
  ignored, so a random repo can't inject its own automation into the relay.
- A stuck `claude` call is killed after 10 minutes; output is capped at ~2 MB; at most
  4 Claude calls run at once.
- Prompts pass via stdin, not command-line arguments, so they don't show up in process lists.

</details>

<details>
<summary><b>Known limits</b></summary>

- **Codex edits files on its own** when given `--sandbox workspace-write`. Work on a branch.
- **Codex → Claude calls are one-shot and blocking.** Every `ask_claude` or `ask_claude_write`
  call starts a fresh Claude session with no memory, no streaming, and no progress output.
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
