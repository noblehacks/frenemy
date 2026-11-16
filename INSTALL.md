# Install on macOS, Linux, or Windows

## What you need

- macOS, Linux or Windows, with Node.js 18 or newer. Nothing else: no Python, no WSL.
- At least two of these, installed, on your PATH and signed in: Claude Code (`claude`), Codex (`codex`), Antigravity (`agy`), Kimi Code (`kimi`). Frenemy connects the ones it finds; you do not need all four.
- VS Code, only if you want the Snitch panel. Without it everything else is installed and the installer says the panel was skipped.

## Install: one command

Download `Frenemy-2.0.0.zip` from the [latest release](https://github.com/noblehacks/frenemy/releases/latest) (the attached file, not the "Source code" ones), unpack it, open a terminal in its folder, and run:

Mac or Linux:

```sh
bash install.sh
```

Windows (PowerShell):

```powershell
.\install.ps1
```

If Windows blocks the script, run `powershell -ExecutionPolicy Bypass -File install.ps1`. On any system `node install.mjs` does the same thing; the two files above only check that Node.js is there first.

That one command:

1. Copies Frenemy to `.local/share/frenemy/2.0.0` in your home folder.
2. Puts the Snitch panel into VS Code (`.vscode/extensions/local.snitch-0.1.1` in your home folder; for VS Code's remote mode, `.vscode-server/extensions/`).
3. Connects every AI app it finds to the others, so each one can ask the rest.
4. Adds each app's Snitch reporter, so the panel can show what it is doing.

Then restart the AI apps you have open and reload VS Code. Codex asks once, on its own screen, to trust the new hooks; say yes. Open the panel with **Snitch: Show Jobs**.

It is safe to run again, for example after you install another AI app. Nothing is copied over an existing install and nothing is added twice.

## What it changes, and how to undo it

Before the installer changes a settings file it saves a copy beside it, named `<file>.before-frenemy-<date-time>`, and prints the name. It only adds or refreshes Frenemy's own entries. A server of your own that happens to be called `claude`, `codex`, `agy` or `kimi` is left alone and the installer says so. Every changed file is read back and checked before it is kept. A settings file the installer cannot read with certainty is left exactly as it is, and the installer says which one.

All paths below are inside your home folder.

| App | Connections to the others | Snitch reporter |
|---|---|---|
| Claude | `claude mcp add-json -s user` (the app's own command), then read back from `.claude.json` | `.claude/settings.json` |
| Codex | `codex mcp add` (the app's own command), then read back from `.codex/config.toml` | `.codex/hooks.json` |
| agy | `.gemini/config/mcp_config.json` | `.gemini/config/hooks.json` |
| Kimi | `.kimi-code/mcp.json` | `.kimi-code/config.toml` |

If connecting one app fails or is interrupted half-way, the installer puts that app's settings back as they were and says which app; the others stay connected. If a file cannot be put back, it says so and names the `.before-frenemy-` copy to restore by hand. If you use `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, the installer works in those folders.

To undo: put the `.before-frenemy-` copies back. If you have no copy, remove only what points into the Frenemy folder (`.local/share/frenemy/2.0.0`): a server named `claude`, `codex`, `agy` or `kimi` whose arguments (`args`) hold a file in that folder (`claude mcp remove -s user <name>`, `codex mcp remove <name>`), and the hook lines that run a file in that folder. A server of your own with one of those names does not point there; leave it. Then move the Frenemy folder and the Snitch folder to the Trash or Recycle Bin. `.fleet` in your home folder holds local job history; keep it or remove it separately. Do not move the installed folder while it is in use: the apps' settings point at it.

## Options

```sh
node install.mjs --check        # only check this download and your Node.js; change nothing
node install.mjs --no-connect   # install, write the entries to config/, change no app settings
node install.mjs --no-snitch    # skip the VS Code panel
node install.mjs --prefix /absolute/new/folder --extension-dir /absolute/new/folder
```

The same options work after `bash install.sh` and `.\install.ps1`.

With `--no-connect`, the entries for each app are written to `config/` inside the installed folder for you to add by hand. If the app commands are not on PATH, set `CLAUDE_BIN`, `CODEX_BIN`, `AGY_BIN`, `KIMI_BIN` or `NODE_BIN` to their full paths first.

If another Snitch is already in VS Code, the installer leaves it alone and says so. Do not keep two Snitch versions active.

## Check that it works

Open Snitch in VS Code and ask one app to consult another, for example in Codex: "ask Claude to review this file". A row should start, finish, and the answer should come back. An app that is not signed in, or whose plan is refused, fails with the provider's own message in its row; that is an account matter, not an install fault.

Terminal snapshot (Mac or Linux; on Windows use the same file under your user folder):

```sh
node "$HOME/.local/share/frenemy/2.0.0/snitch/bin/fleet.mjs" ls
```

## Coming from version 1

Download version 2 into a new folder and run its installer. It finds the connection version 1 gave Codex and points it at version 2. Two things it does not do for you:

- Version 1 added a section headed "Codex is always available" to `~/.claude/CLAUDE.md`. Version 2 does not use it; delete that section by hand.
- If you got version 1 with `git clone`, a `git pull` now replaces its files with version 2's, and the old connection stops working until you run the new installer.

Version 1 is still available under the [v1.0.0 tag](https://github.com/noblehacks/frenemy/tree/v1.0.0).
