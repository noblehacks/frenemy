# Local data and provider boundaries

Frenemy sends assigned prompts/files to installed AI CLIs; those clients communicate with their providers under the user's account and provider terms. Frenemy adds no hosted service, analytics or API credential store. Kimi and agy receive prompts as process arguments, which local processes may inspect; do not treat this as a multi-user isolation boundary.

Snitch reads local job records and Codex session events. Job titles, folder paths, command summaries and output excerpts may be displayed and retained under `~/.fleet`. Clear archives rather than permanently deletes them. Worker copies/backups live under the assigned project's `.worker-state`; CLI logs and wrapper artifacts may also be retained. Do not publish these directories. Anyone with access to the operating-system account can read this material.
