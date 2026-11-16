# Release status

Version: Frenemy 2.0.0 with Snitch 0.1.1. Runs on Node.js alone: no Python, no shell scripts at run time, no WSL.

## What was tested, on which system (16 November 2026)

| System | Status |
|---|---|
| macOS (Intel, Node.js 22.17.0, the author's computer) | Tested. Offline suite: 103 checks passed, 0 failed (`node tools/check-release.mjs --skip-browser`). One-command install and live routes with the real apps: see below. |
| Windows (plain Windows, no WSL), Linux and macOS on GitHub's own machines, each with Node.js 18 and Node.js 22 | Tested, offline suite only. All six machines passed the installer's download check and the whole offline suite (GitHub Actions, 16 November 2026, in the author's private test space; the Windows machine was Windows Server 2025 with Node.js 18.20.8 and 22). The first run failed on Windows and Linux; the faults it found were fixed (see CHANGELOG.md) and the run repeated until all six passed. |
| The real AI apps on Windows or Linux | NOT run. GitHub's machines have no Claude, Codex, agy or Kimi and no sign-ins, so the tests there use stand-in apps. `install.ps1` ran there against stand-in apps only. A real install with the real apps has only been done on the Mac. Test it yourself before relying on it. |

More detail for macOS:

- The offline suite covers the helpers that start each AI app (with stand-in apps), the relays, native hooks, job clearing, recovery, guarded writes, locks, and the one-command install into fresh temporary homes that already hold settings of their own (kept hooks, an older Frenemy's reporters, private file permissions, a failed swap, Ctrl-C, custom settings folders, settings kept through a link, a home folder with a space in its name).
- One-command install with the real apps: `bash install.sh` in an empty throwaway home folder whose path contains a space, with the real Claude, Codex, agy and Kimi commands on PATH. It finished in 3 seconds. Codex listed its three connections, Claude reported "Connected" for its three, agy listed its three as enabled, Kimi's files were written. A second run added nothing twice.
- Live routes through the installed files, real apps: with Claude driving, Codex and agy each read a file and answered correctly; with Codex driving, Claude answered correctly. Kimi returned a provider account error ("Your current subscription does not have access to Kimi Code right now"), so no Kimi route was confirmed. agy and Kimi were not tested as drivers.
- One real work job: Codex built a file in its own copy; the real project did not have the file until the driver applied the job, and had it after.
- Not rerun: the browser drawing test of the Snitch panel. The panel's drawing code is unchanged from the build before version 2; the code that clears rows and records Codex events was moved from Python into the panel and is covered by the archive, activation, clear-command and Codex-feed tests.
- Not checked: an install on a second computer, and the Snitch panel on a fresh device.
- Not repeated for this build: the independent review of the installer by another vendor's model. The earlier review was of the Python installer, which is gone.

License: MIT, the same as version 1. No account credentials or real machine configuration are included. Snitch is not on the VS Code Marketplace; the installer puts it into VS Code directly. This release is not certified for production use; read the table above before relying on it.

Release tooling reference: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
