# Optional Hive-Lite coordination

Lightweight, supervised coordination for AI coding agents, with tools for delegating work across providers.

**Hive-Lite** defines how an Executive, Controller and Workers plan assignments, share context and review results. **Frenemy** lets Claude Code, Codex, Antigravity and Kimi call each other for advice or scoped implementation work.

## How the workflow fits together

1. The Controller turns an objective into bounded job cards with clear ownership and acceptance criteria.
2. Workers receive the context and permissions required for their assignments.
3. Results are saved in the mission workspace and reviewed by the Controller.
4. For Frenemy write jobs, changes remain in an isolated workspace until the driver reviews and applies them.

Use a single agent when coordination would add more work than it saves. Choose models and reasoning effort for the task, using providers available to the operator.

## Installation: step by step

The same installer command works in macOS Terminal, a Linux terminal and Windows PowerShell. Administrator access is not required.

### 1. Install the prerequisites

- Install the current LTS release of [Node.js](https://nodejs.org/). The installer requires Node.js 18 or newer.
- For Hive-Lite, install and sign in to **Codex or Claude Code**.
- For Frenemy, install and sign in to at least **two** supported CLIs: Codex, Claude Code, Antigravity or Kimi. They must be available from your terminal.
- VS Code is optional; Frenemy can add its Snitch status panel when VS Code is present.

Check Node.js in a terminal:

```sh
node --version
```

If the command is not found, finish installing Node.js and open a new terminal.

### 2. Download and open this repository

On the repository page, choose **Code → Download ZIP**, then extract the ZIP. Alternatively, use your usual Git client to clone the repository.

Open a terminal in the extracted repository folder. You should see `install-hive-lite.mjs`, `install.mjs` and `hive-lite/` there.

### 3. Run the installer

If Frenemy already works on your machine, install **Hive-Lite only**:

```sh
node install-hive-lite.mjs
```

For a **fresh installation of Hive-Lite and Frenemy together**, run:

```sh
node install-hive-lite.mjs --with-frenemy
```

The installer copies Hive-Lite into Codex and Claude's skill folders, then runs the bundled Frenemy installer to connect the supported apps it finds. It prints installation locations and any backups. You do not need to copy skill files yourself.

If a different Frenemy copy already occupies the default destination, its
installer will refuse to overwrite it. You can keep that working installation
and use the Hive-Lite-only command above. To install this checkout's Frenemy
separately, supply a new absolute destination:

```sh
node install-hive-lite.mjs --with-frenemy --frenemy-prefix "<absolute-new-folder>"
```

Hive-Lite's installer only writes its skill folders; Frenemy's optional setup manages its own app connections, hooks and settings backups. No AI task is launched during installation.

### 4. Open a new AI session

After saving any current work, restart the AI apps used for Frenemy so they load their new connections. Reload VS Code if the installer added Snitch. If Codex shows a hook trust prompt, review it and approve the installed Frenemy hooks to use them.

Open a new Codex or Claude Code session so it discovers the `hive-lite` skill.

### 5. Start your first Hive-Lite task

In **Codex**, enter this in the chat, not in your terminal:

```text
$hive-lite setup
Act as Controller for my current project. My objective is: [describe the job].
Use a local mission directory outside this source repository.
Record the available models and bind only the sessions I select.
```

In **Claude Code**, use the same request starting with `/hive-lite setup` instead.

The Controller sets up the mission and prepares assignments. Give each selected worker the `join` instruction and mission directory supplied by the Controller. Start with a small review or documentation task to check the workflow.

### 6. Check Frenemy, if installed

Ask a connected app to consult another provider, for example:

```text
Use Frenemy to ask Claude for a read-only review of this project's README.
```

Choose a provider available on your account. A returned answer confirms that route works. Account or usage-limit errors come from the provider; installing the tools does not add model access.

For a short Hive-Lite assignment, the Controller can invoke Frenemy directly
with the job's objective, workspace, allowed files and expected result. Save
the returned answer in the mission's results directory and review it before
marking the job accepted. For edits, review and apply Frenemy's isolated change
through its existing conflict check. This is a supervised handoff; installing
the skill does not create an automatic dispatcher.

If a card fixes a model or effort that the selected Frenemy tool cannot pass
explicitly, use a qualified direct CLI route from the routing guide or hold the
assignment. Do not treat a model name written in a prompt as model selection.

The [role instructions](SKILL.md) and [routing guidance](routing.md) explain the workflow in more detail. The optional shell-based watcher needs Linux tools and a compatible Codex CLI; other setups can use supported session controls or file-pointer handoffs.

## Installer options and updates

| Command | What it does |
|---|---|
| `node install-hive-lite.mjs --check` | Validate the skill and preview its destinations without writing files |
| `node install-hive-lite.mjs --check --with-frenemy` | Also validate the bundled Frenemy release; no installation or sign-in check |
| `node install-hive-lite.mjs --target codex` | Install Hive-Lite for Codex only |
| `node install-hive-lite.mjs --target claude` | Install Hive-Lite for Claude only |
| `node install-hive-lite.mjs --replace` | Back up a different existing Hive-Lite copy, then install the new one |
| `node install-hive-lite.mjs --with-frenemy --frenemy-prefix "<absolute-new-folder>"` | Choose a separate Frenemy destination without overwriting an existing release |
| `node install-hive-lite.mjs --help` | Show the available options |

Identical installs are left alone. If a skill copy differs, the installer stops before changing either client unless you use `--replace`. Backups are stored in `hive-lite-backups/` under the relevant client configuration directory, outside skill discovery. The installer prints the exact backup location. A failed replacement restores the previous copy when the destination is still available.

Options can be combined. `--target` controls Hive-Lite only; `--with-frenemy` still connects all supported apps Frenemy discovers. Existing absolute `CODEX_HOME` and `CLAUDE_CONFIG_DIR` settings are respected. Skill destinations that are symbolic links are left unchanged and must be managed by their owner.

To remove Hive-Lite, use `--check` to display its locations, then remove only the installed `hive-lite` folders. To undo an update, restore the printed backup to its original skill location. Frenemy has its own [setup options and removal instructions](../INSTALL.md).

Keep credentials, provider settings, mission results and runtime state outside source control. Each operator chooses the model access and permission settings for their assignments.

## Integration status

This optional skill supplies coordination instructions and installation support. Automatic Hive-Lite-to-Frenemy dispatch, explicit per-call model/effort propagation and actual-model reporting are planned integration work. The existing Frenemy tools can already be invoked directly.

## Development

From the repository root, test the Hive-Lite installer in disposable directories:

```sh
node --test tools/test-hive-lite-install.mjs
```

Frenemy's offline checks use stand-in providers:

```sh
node tools/check-release.mjs --skip-browser
```

These checks do not establish live account access or validate the browser-rendered Snitch panel.

## Licensing

Hive-Lite's skill, installer and installer tests are provided under the
[MIT license](LICENSE). Frenemy retains its existing [license](../LICENSE)
and [third-party notices](../THIRD-PARTY-NOTICES.md).
