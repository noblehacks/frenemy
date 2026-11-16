# Snitch

A local VS Code desktop panel for Claude Code, Codex, agy, Kimi and shell jobs. Included with Frenemy 2.0.0. Works on macOS, Linux and Windows. The reporters need Node.js 18 or newer on PATH; nothing else.

Open **Snitch: Show Jobs** after installation. Frenemy relays automatically report their calls; direct CLI activity requires the hooks described in the bundle's INSTALL.md. The panel alone does not install AI clients or register their hooks. It displays local records under `~/.fleet/jobs` and recorded Codex session events.

Clear all archives rows; it does not cancel work. Active jobs can return on new check-ins. Clear finished is visible when finished or failed jobs are listed. Errors are shown instead of silently ignoring a failed clear. See PRIVACY.md for retained local data.

This release installs locally, with publisher `local`; it is not on the VS Code Marketplace. MIT License; see LICENSE.
