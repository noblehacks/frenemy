# Functional Requirements (QBrain.AI)

## FR-FRENEMY-001 Read-only Claude delegation

Codex users shall ask Claude to review files or answer prompts through ask_claude and receive the final answer in the calling chat without manual copying.
Scope: layer-1..layer-1
**Acceptance Criteria:**
- [ ] tools/list returns ask_claude with an object schema requiring a string prompt. Source: ask-claude-mcp.mjs:49-66,232-234. (evidence: Source specification only: ask-claude-mcp.mjs:49-66,232-234. Not a test execution receipt; runtime verification pending.)
- [ ] For ask_claude, launch Claude with -p --output-format json, --safe-mode, --strict-mcp-config, and disallow Bash, Edit, Write, NotebookEdit, WebFetch and WebSearch. Source: ask-claude-mcp.mjs:98-114. (evidence: Source specification only: ask-claude-mcp.mjs:98-114. Not a test execution receipt; runtime verification pending.)
- [ ] Run the delegated process in the relay startup directory; caller-supplied arguments cannot choose a different working directory. Source: ask-claude-mcp.mjs:42-43,125-128,245. (evidence: Source specification only: ask-claude-mcp.mjs:42-43,125-128,245. Not a test execution receipt; runtime verification pending.)
- [ ] Pass the prompt on stdin and end stdin after writing it; do not embed prompt text in process arguments. Source: ask-claude-mcp.mjs:98,182-185. (evidence: Source specification only: ask-claude-mcp.mjs:98,182-185. Not a test execution receipt; runtime verification pending.)
- [ ] Return the successful Claude JSON result as one MCP text content item with isError=false; absent result yields empty text. Source: ask-claude-mcp.mjs:165-178,245-246. (evidence: Source specification only: ask-claude-mcp.mjs:165-178,245-246. Not a test execution receipt; runtime verification pending.)
- [ ] Before returning Claude output, remove OSC/CSI terminal sequences and other control characters while preserving newline/tab, and replace matching PEM private-key blocks with the redaction placeholder. This is best-effort redaction, not a guarantee against all secret leakage. Source: ask-claude-mcp.mjs:189-201,246. (evidence: Source specification only: ask-claude-mcp.mjs:189-201,246. Not a test execution receipt; runtime verification pending.)
- [ ] On Windows, resolve claude.exe only from nonempty absolute PATH entries, launch without an intermediate shell, and report a native-installer error if no executable is found. Source: ask-claude-mcp.mjs:21-33,116-128. (evidence: Source specification only: ask-claude-mcp.mjs:21-33,116-128. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-002 Explicit Claude write delegation

Codex users shall request file edits through the separate ask_claude_write tool, which is not auto-approved by the installer and requires interactive approval when used.
Scope: layer-1..layer-1
**Acceptance Criteria:**
- [ ] tools/list exposes ask_claude_write separately from ask_claude and labels it as file-edit capable. Source: ask-claude-mcp.mjs:68-84. (evidence: Source specification only: ask-claude-mcp.mjs:68-84. Not a test execution receipt; runtime verification pending.)
- [ ] A write call invokes Claude with --permission-mode acceptEdits and --setting-sources user; the read-only safe-mode flags are selected only on the read branch. Source: ask-claude-mcp.mjs:98-114. (evidence: Source specification only: ask-claude-mcp.mjs:98-114. Not a test execution receipt; runtime verification pending.)
- [ ] Fresh installation auto-approves ask_claude only and does not add an auto-approval entry for ask_claude_write. Source: install.ps1:147-157; install.sh:109-118; README.md:136-141. (evidence: Source specification only: install.ps1:147-157; install.sh:109-118; README.md:136-141. Not a test execution receipt; runtime verification pending.)
- [ ] Interactive use of ask_claude_write requires the configured caller approval before delegated editing; once launched, the child uses acceptEdits. Verify both boundaries independently. Source: README.md:136-141; ask-claude-mcp.mjs:99-103. (evidence: Source specification only: README.md:136-141; ask-claude-mcp.mjs:99-103. Not a test execution receipt; runtime verification pending.)
- [ ] The write call uses the relay startup working directory and receives the self-contained prompt through stdin. Source: ask-claude-mcp.mjs:42-43,125-128,182-185. (evidence: Source specification only: ask-claude-mcp.mjs:42-43,125-128,182-185. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-003 Claude-to-Codex delegation

Claude shall delegate requested reviews, audits, second opinions and file-writing work to Codex with a self-contained prompt, default to read-only access, use workspace-write only when writes are needed, and relay the answer in chat. This direction is instruction-driven rather than an enforced boundary.
Scope: layer-1..layer-1
**Acceptance Criteria:**
- [ ] For a review/audit/second opinion, Claude instructions select codex exec --sandbox read-only --skip-git-repo-check with the prompt delivered through stdin. Source: CLAUDE-codex-section.md:7-21. (evidence: Source specification only: CLAUDE-codex-section.md:7-21. Not a test execution receipt; runtime verification pending.)
- [ ] For a requested file-writing task, the instructions permit workspace-write; they do not claim enforcement of those flags by Frenemy. Source: CLAUDE-codex-section.md:30-34; README.md:175-177. (evidence: Source specification only: CLAUDE-codex-section.md:30-34; README.md:175-177. Not a test execution receipt; runtime verification pending.)
- [ ] The delegated prompt includes all required context because the new Codex invocation does not inherit the caller conversation. Source: CLAUDE-codex-section.md:30. (evidence: Source specification only: CLAUDE-codex-section.md:30. Not a test execution receipt; runtime verification pending.)
- [ ] Short work uses the documented 600000 ms foreground bound; long work runs in background with -o pointing to a retrievable answer file. Source: CLAUDE-codex-section.md:22-29. (evidence: Source specification only: CLAUDE-codex-section.md:22-29. Not a test execution receipt; runtime verification pending.)
- [ ] Claude returns Codex's answer to the calling chat rather than requiring the user to switch panes. Source: CLAUDE-codex-section.md:34. (evidence: Source specification only: CLAUDE-codex-section.md:34. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-004 Optional image generation

When the optional Mac/Linux image helper is installed, Claude users shall request a single image at an absolute output path through genimg.sh. Preserve the user prompt verbatim and pass explicitly requested model and effort. Image generation is supported; video generation is not.
Scope: layer-1..layer-1
**Acceptance Criteria:**
- [ ] Reject invocation without either the image prompt or destination argument. Source: genimg.sh:7-8. (evidence: Source specification only: genimg.sh:7-8. Not a test execution receipt; runtime verification pending.)
- [ ] The caller supplies the user prompt without embellishment. The helper strips < and > before embedding it; text without those characters remains unchanged. Preserve this documented caller/helper distinction in validation. Source: CLAUDE-codex-section.md:45-46; genimg.sh:10-14,48-55. (evidence: Source specification only: CLAUDE-codex-section.md:45-46; genimg.sh:10-14,48-55. Not a test execution receipt; runtime verification pending.)
- [ ] Resolve a relative output destination against the original working directory before entering the temporary work directory. Source: genimg.sh:16-18,24,40. (evidence: Source specification only: genimg.sh:16-18,24,40. Not a test execution receipt; runtime verification pending.)
- [ ] With CODEX_MODEL unset, do not add a model override. With CODEX_EFFORT unset use medium; accept only minimal, low, medium, high, xhigh or ultra, and reject any other effort. Source: genimg.sh:27-37. (evidence: Source specification only: genimg.sh:27-37. Not a test execution receipt; runtime verification pending.)
- [ ] Launch Codex in a temporary directory with workspace-write, skip-git-repo-check and ephemeral; request exactly one image and ./out.png. Source: genimg.sh:20-25,39-62. (evidence: Source specification only: genimg.sh:20-25,39-62. Not a test execution receipt; runtime verification pending.)
- [ ] If ./out.png is missing or empty, report that Codex did not produce an image and return failure. Source: genimg.sh:65. (evidence: Source specification only: genimg.sh:65. Not a test execution receipt; runtime verification pending.)
- [ ] On success create the destination parent if necessary, deliver out.png and print the final path. The current helper uses mv and cleanup; this describes source behavior, not authorization to violate the operator's retain-original rule. Source: genimg.sh:24-25,65-68. (evidence: Source specification only: genimg.sh:24-25,65-68. Not a test execution receipt; runtime verification pending.)
- [ ] The optional helper supports images, not video; source documentation identifies the image-generation model as gpt-image-2. Source: README.md:193-197. (evidence: Source specification only: README.md:193-197. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-005 Install and configure the two-agent relay

Provide Windows PowerShell and Mac/Linux shell installers that check prerequisites, configure Codex-to-Claude and Claude-to-Codex delegation without administrator privileges, and avoid duplicate installation. Document permanent installation location, Codex restart, manual setup, smoke checks and manual upgrade procedure; repeated installation skips existing configuration rather than upgrading it.
Scope: layer-1..layer-1
**Acceptance Criteria:**
- [ ] If node, claude or codex is missing, fail installation with an actionable prerequisite message; if required relay/instruction files are missing, fail as an incomplete checkout. Source: install.ps1:39-49,99-106; install.sh:38-41,70-71. (evidence: Source specification only: install.ps1:39-49,99-106; install.sh:38-41,70-71. Not a test execution receipt; runtime verification pending.)
- [ ] Windows installation rejects configurations without native claude.exe in an absolute PATH directory; a .cmd shim alone is insufficient. Source: install.ps1:51-66. (evidence: Source specification only: install.ps1:51-66. Not a test execution receipt; runtime verification pending.)
- [ ] For a fresh installation write the absolute Node path, absolute relay path, tool_timeout_sec=600 and ask_claude approval_mode=approve in user Codex configuration. Source: install.ps1:69-73,107-157; install.sh:42-47,73-78,109-118. (evidence: Source specification only: install.ps1:69-73,107-157; install.sh:42-47,73-78,109-118. Not a test execution receipt; runtime verification pending.)
- [ ] Append the Codex instruction section only when its heading is absent; an existing section remains unchanged on repeat installation. Source: install.ps1:161-173; install.sh:122-132. (evidence: Source specification only: install.ps1:161-173; install.sh:122-132. Not a test execution receipt; runtime verification pending.)
- [ ] When the relay registration already exists, leave it unchanged; warn if its ask_claude approval setting is missing rather than silently rewriting the block. Source: install.ps1:130-145; install.sh:96-107. (evidence: Source specification only: install.ps1:130-145; install.sh:96-107. Not a test execution receipt; runtime verification pending.)
- [ ] For Node major below 18 emit the documented warning; for parsed Codex version 0.x with minor below 140 emit the version warning. These checks warn rather than stop, despite documentation referring to tested Codex 0.144+. Source: install.ps1:75-97; install.sh:50-68. (evidence: Source specification only: install.ps1:75-97; install.sh:50-68. Not a test execution receipt; runtime verification pending.)
- [ ] Warn about a top-level pinned Codex model without automatically removing the user's setting. Source: install.ps1:115-128; install.sh:85-94. (evidence: Source specification only: install.ps1:115-128; install.sh:85-94. Not a test execution receipt; runtime verification pending.)
- [ ] Write Windows appended configuration/instructions in UTF-8 without BOM and use forward slashes for TOML paths. Source: install.ps1:20-25,69-73,107. (evidence: Source specification only: install.ps1:20-25,69-73,107. Not a test execution receipt; runtime verification pending.)
- [ ] On Mac/Linux reject installation/Node paths with control characters, require an absolute resolved Node path, and escape quotes/backslashes when writing TOML. Source: install.sh:27-47,73-78. (evidence: Source specification only: install.sh:27-47,73-78. Not a test execution receipt; runtime verification pending.)
- [ ] Mac/Linux optional image installation defaults to no, copies and marks the helper executable when accepted, and skips an already installed helper. Windows does not offer it. Source: install.sh:134-149; install.ps1:15-16. (evidence: Source specification only: install.sh:134-149; install.ps1:15-16. Not a test execution receipt; runtime verification pending.)
- [ ] Document that the checkout must remain at its installed path and Codex must restart to load configuration; document manual upgrade because repeated installation skips existing blocks. Source: README.md:57-61,184-187; install.ps1:175-179. (evidence: Source specification only: README.md:57-61,184-187; install.ps1:175-179. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-006 Reuse signed-in CLI subscriptions

Delegate using the already installed, authenticated Claude and Codex CLIs and the user's existing subscriptions without requiring separate provider API keys. Document that delegated usage consumes shared subscription limits.
Scope: layer-1..layer-1
**Acceptance Criteria:**
- [ ] The documented prerequisites require installed Claude and Codex CLIs signed into the user's accounts; the relay delegates through those CLIs without a separate provider API-key parameter. Source: README.md:3-4,17-18; ask-claude-mcp.mjs:57-82,98-128. (evidence: Source specification only: README.md:3-4,17-18; ask-claude-mcp.mjs:57-82,98-128. Not a test execution receipt; runtime verification pending.)
- [ ] Installer completion instructs users who are not signed in to run each CLI and log in; it must not claim that command availability proves authentication. Source: install.ps1:179; install.sh:155. (evidence: Source specification only: install.ps1:179; install.sh:155. Not a test execution receipt; runtime verification pending.)
- [ ] Documentation warns that delegated Codex usage shares subscription rate limits with normal usage. Source: README.md:191-192. (evidence: Source specification only: README.md:191-192. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-007 Bound one-shot Claude relay execution

Each ask_claude or ask_claude_write invocation shall start a fresh, blocking Claude session and return one final answer. Bound stuck execution, retained output and simultaneous calls. The documented baseline provides no streaming progress, background handle, cancellation or conversation continuation.
Scope: layer-1..layer-1
**Acceptance Criteria:**
- [ ] When four Claude calls are already active, reject the next call with a limit error instead of launching or queueing it. Source: ask-claude-mcp.mjs:35-40,87-95. (evidence: Source specification only: ask-claude-mcp.mjs:35-40,87-95. Not a test execution receipt; runtime verification pending.)
- [ ] After 600000 ms without completion, kill the child and return a timeout failure. Source: ask-claude-mcp.mjs:36,145-148. (evidence: Source specification only: ask-claude-mcp.mjs:36,145-148. Not a test execution receipt; runtime verification pending.)
- [ ] When accumulated stdout exceeds 2097152 JavaScript string characters, kill the child and return an output-cap failure; the limit is character-based, not a measured byte count. Source: ask-claude-mcp.mjs:37,150-155. (evidence: Source specification only: ask-claude-mcp.mjs:37,150-155. Not a test execution receipt; runtime verification pending.)
- [ ] Each invocation resolves at most once and releases its concurrency slot and timeout on completion even if multiple terminal events occur. Source: ask-claude-mcp.mjs:134-143. (evidence: Source specification only: ask-claude-mcp.mjs:134-143. Not a test execution receipt; runtime verification pending.)
- [ ] Launch errors return a failure; Claude JSON with is_error=true returns its result or fallback error; unusable JSON returns failure with exit code and available stderr/stdout. Source: ask-claude-mcp.mjs:161-178. (evidence: Source specification only: ask-claude-mcp.mjs:161-178. Not a test execution receipt; runtime verification pending.)
- [ ] A child stdin error does not crash the relay, and calls return one final response without streaming or resumable job handles. Source: ask-claude-mcp.mjs:182-185,245-246; README.md:171-174. (evidence: Source specification only: ask-claude-mcp.mjs:182-185,245-246; README.md:171-174. Not a test execution receipt; runtime verification pending.)
- [ ] An initialize request echoes a supplied protocol version or defaults to 2025-06-18, advertises tools and reports frenemy server information; ping returns an empty result. Source: ask-claude-mcp.mjs:220-229. (evidence: Source specification only: ask-claude-mcp.mjs:220-229. Not a test execution receipt; runtime verification pending.)
- [ ] Notifications without an id and blank input lines receive no reply; unknown methods return JSON-RPC -32601 and unknown tools return isError=true text. Source: ask-claude-mcp.mjs:217-218,236-249,270-271. (evidence: Source specification only: ask-claude-mcp.mjs:217-218,236-249,270-271. Not a test execution receipt; runtime verification pending.)
- [ ] Malformed JSON returns parse error -32700. Input lines exceeding 8388608 characters are discarded with -32700; subsequent valid lines remain processable. Source: ask-claude-mcp.mjs:39,252-284. (evidence: Source specification only: ask-claude-mcp.mjs:39,252-284. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-101 Four-agent discovery and routing

Expose installed versions, capabilities and configuration status through list_agents, and support all 12 directed caller/target routes among Claude Code, Codex, Grok Build and Cline CLI on Windows and Linux.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] list_agents reports installed CLI versions, capabilities and configuration status. Source: docs/plans/grok-cline-integration.md:15. (evidence: Source specification only: docs/plans/grok-cline-integration.md:15. Not a test execution receipt; runtime verification pending.)
- [ ] Each of four agents can call each other agent, covering 12 directed routes on both Windows and Linux. Source: docs/plans/grok-cline-integration.md:11,99. (evidence: Source specification only: docs/plans/grok-cline-integration.md:11,99. Not a test execution receipt; runtime verification pending.)
- [ ] Release validation covers each route in read and write mode on both operating systems, totaling 48 routing/access combinations; macOS and cross-machine execution remain excluded. Source: docs/plans/grok-cline-integration.md:82,99. (evidence: Source specification only: docs/plans/grok-cline-integration.md:82,99. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-102 Submit durable read and write jobs

Expose start_read_job and start_write_job with immediate job IDs; accept target, prompt, optional model/effort and Cline provider, plus optional base Git revision for writes. Derive workspace and caller identity from the configured MCP connection. Persist accepted requests before launch and prevent duplicate launches for retried request IDs. Retain ask_claude and ask_claude_write names with explicitly documented v2 job-handle semantics.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] start_read_job and start_write_job return a job ID immediately for accepted work. Source: docs/plans/grok-cline-integration.md:16. (evidence: Source specification only: docs/plans/grok-cline-integration.md:16. Not a test execution receipt; runtime verification pending.)
- [ ] Submission accepts target, prompt, optional model/effort/Cline provider and optional write base revision; caller/workspace are obtained from MCP connection configuration. Source: docs/plans/grok-cline-integration.md:22. (evidence: Source specification only: docs/plans/grok-cline-integration.md:22. Not a test execution receipt; runtime verification pending.)
- [ ] The accepted request is durably retained before agent launch; retrying its request ID does not launch duplicate jobs. Source: docs/plans/grok-cline-integration.md:55. (evidence: Source specification only: docs/plans/grok-cline-integration.md:55. Not a test execution receipt; runtime verification pending.)
- [ ] Legacy ask_claude and ask_claude_write return job handles in v2 and describe the breaking return/write-location change explicitly. Source: docs/plans/grok-cline-integration.md:24. (evidence: Source specification only: docs/plans/grok-cline-integration.md:24. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-103 Retrieve job results and retained events

Expose get_job for status, answer, artifacts, execution identity and audit state, plus cursor-based read_job_events. Retain complete credential-redacted request, response, progress and error streams without a total transcript-size cutoff. Distinguish queued, running, awaiting permission, succeeded, failed, cancelled and interrupted states.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] get_job returns lifecycle state, final answer when available, artifacts, execution identity and audit state. Source: docs/plans/grok-cline-integration.md:17. (evidence: Source specification only: docs/plans/grok-cline-integration.md:17. Not a test execution receipt; runtime verification pending.)
- [ ] read_job_events uses continuation cursors and allows retrieval of the complete retained credential-redacted request/response/progress/error streams without truncating them. Source: docs/plans/grok-cline-integration.md:18,56. (evidence: Source specification only: docs/plans/grok-cline-integration.md:18,56. Not a test execution receipt; runtime verification pending.)
- [ ] Job state distinguishes queued, running, awaiting permission, succeeded, failed, cancelled and interrupted. Source: docs/plans/grok-cline-integration.md:58. (evidence: Source specification only: docs/plans/grok-cline-integration.md:58. Not a test execution receipt; runtime verification pending.)
- [ ] No total transcript-size or fixed job-duration cutoff discards required evidence or terminates otherwise active jobs. Source: docs/plans/grok-cline-integration.md:62. (evidence: Source specification only: docs/plans/grok-cline-integration.md:62. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-104 Cancel an owned job

Expose cancel_job to cancel a selected job and terminate its owned process tree without affecting unrelated agent sessions.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] cancel_job targets the specified job ID and terminates that job's owned process tree. Source: docs/plans/grok-cline-integration.md:19,60. (evidence: Source specification only: docs/plans/grok-cline-integration.md:19,60. Not a test execution receipt; runtime verification pending.)
- [ ] Cancellation leaves unrelated agent sessions running; release validation includes cancellation races. Source: docs/plans/grok-cline-integration.md:60,103. (evidence: Source specification only: docs/plans/grok-cline-integration.md:60,103. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-105 Recover and explicitly resume sessions

Continue jobs when the caller disconnects. After reboot retain history and mark unfinished execution interrupted. Expose separate resume_read_job and resume_write_job with a new prompt and exact recorded session; never silently restart write work.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] A caller disconnect does not stop its running job. Source: docs/plans/grok-cline-integration.md:28. (evidence: Source specification only: docs/plans/grok-cline-integration.md:28. Not a test execution receipt; runtime verification pending.)
- [ ] After reboot job history remains available and unfinished execution is marked interrupted. Source: docs/plans/grok-cline-integration.md:59. (evidence: Source specification only: docs/plans/grok-cline-integration.md:59. Not a test execution receipt; runtime verification pending.)
- [ ] resume_read_job and resume_write_job accept a new prompt and continue the exact recorded session only after an explicit request. Source: docs/plans/grok-cline-integration.md:20,59. (evidence: Source specification only: docs/plans/grok-cline-integration.md:20,59. Not a test execution receipt; runtime verification pending.)
- [ ] Recovery does not silently restart write jobs or substitute a different CLI session. Source: docs/plans/grok-cline-integration.md:59,103. (evidence: Source specification only: docs/plans/grok-cline-integration.md:59,103. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-106 Enforce read-job permissions

Prevent agent-directed source edits and unrestricted command execution in read jobs, enforce each adapter's supported permission controls, and fail explicitly when a requested mode cannot be enforced. Do not treat Grok's sandbox flag alone as evidence of Windows protection.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] Read jobs prevent agent-directed source edits and unrestricted command execution through adapter-supported controls. Source: docs/plans/grok-cline-integration.md:45. (evidence: Source specification only: docs/plans/grok-cline-integration.md:45. Not a test execution receipt; runtime verification pending.)
- [ ] When an adapter cannot enforce the requested mode, reject it explicitly rather than proceeding under weaker permissions. Source: docs/plans/grok-cline-integration.md:45. (evidence: Source specification only: docs/plans/grok-cline-integration.md:45. Not a test execution receipt; runtime verification pending.)
- [ ] Permission validation includes direct edits, command execution, MCP-tool escapes and escalation through continuation; Grok's sandbox flag alone does not establish Windows protection. Source: docs/plans/grok-cline-integration.md:45,100. (evidence: Source specification only: docs/plans/grok-cline-integration.md:45,100. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-107 Isolate write jobs in repository worktrees

Run writes in an isolated worktree under the owning repository. Default to HEAD only with a clean caller checkout; otherwise require an explicit base revision. Return worktree path, base commit, changed-file inventory and diff. Preserve worktrees until explicitly removed and do not automatically merge or push.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] Every write job uses <repository>/.worktrees/frenemy/<job-id> beneath its owning repository. Source: docs/plans/grok-cline-integration.md:47-49. (evidence: Source specification only: docs/plans/grok-cline-integration.md:47-49. Not a test execution receipt; runtime verification pending.)
- [ ] Use the requested base revision; default to HEAD only for a clean checkout and require an explicit base for a dirty checkout. Source: docs/plans/grok-cline-integration.md:51. (evidence: Source specification only: docs/plans/grok-cline-integration.md:51. Not a test execution receipt; runtime verification pending.)
- [ ] Return the worktree path, base commit, changed-file inventory and diff. Source: docs/plans/grok-cline-integration.md:51. (evidence: Source specification only: docs/plans/grok-cline-integration.md:51. Not a test execution receipt; runtime verification pending.)
- [ ] Retain worktrees until explicitly removed and perform no automatic merge or push. Source: docs/plans/grok-cline-integration.md:51. (evidence: Source specification only: docs/plans/grok-cline-integration.md:51. Not a test execution receipt; runtime verification pending.)
- [ ] Validation covers path traversal, symlink/junction escape and concurrent write submissions in addition to clean/dirty checkout behavior. Source: docs/plans/grok-cline-integration.md:101. (evidence: Source specification only: docs/plans/grok-cline-integration.md:101. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-108 Preserve authentication and execution identity

Reuse existing CLI authentication without collecting credentials or silently changing providers or models. Distinguish requested and observed execution identity and leave missing evidence unknown; retain attribution and artifact hashes.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] Reuse existing CLI authentication without collecting credentials or silently changing selected providers or models. Source: docs/plans/grok-cline-integration.md:39. (evidence: Source specification only: docs/plans/grok-cline-integration.md:39. Not a test execution receipt; runtime verification pending.)
- [ ] Record requested and observed model/effort/provider identity separately; when observed identity is unavailable report unknown. Source: docs/plans/grok-cline-integration.md:39. (evidence: Source specification only: docs/plans/grok-cline-integration.md:39. Not a test execution receipt; runtime verification pending.)
- [ ] Retain parent/caller IDs, workspace, job ID, attempt ID, CLI session ID, versions, model, effort and artifact hashes. Source: docs/plans/grok-cline-integration.md:57. (evidence: Source specification only: docs/plans/grok-cline-integration.md:57. Not a test execution receipt; runtime verification pending.)
- [ ] Launch resolved executables with argument arrays and no shell; resolve Cline's native Windows executable instead of a .cmd shim. Source: docs/plans/grok-cline-integration.md:37. (evidence: Source specification only: docs/plans/grok-cline-integration.md:37. Not a test execution receipt; runtime verification pending.)
- [ ] Validation includes missing credentials, provider errors and unsupported model/effort selections without inventing successful execution evidence. Source: docs/plans/grok-cline-integration.md:39,102. (evidence: Source specification only: docs/plans/grok-cline-integration.md:39,102. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-109 Schedule bounded concurrency without recursive delegation

Default to four active jobs per host, queue additional jobs, and permit one active turn per recorded agent session. Every agent may initiate delegation, but delegated jobs cannot recursively delegate in this release.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] Default active capacity is four jobs per host; excess submissions queue. Source: docs/plans/grok-cline-integration.md:41. (evidence: Source specification only: docs/plans/grok-cline-integration.md:41. Not a test execution receipt; runtime verification pending.)
- [ ] At most one turn is active per recorded agent session. Source: docs/plans/grok-cline-integration.md:41. (evidence: Source specification only: docs/plans/grok-cline-integration.md:41. Not a test execution receipt; runtime verification pending.)
- [ ] Each agent may initiate a job, but a delegated job cannot recursively delegate in the first release. Source: docs/plans/grok-cline-integration.md:41. (evidence: Source specification only: docs/plans/grok-cline-integration.md:41. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-110 Retain auditable review evidence

Use each agent's supported MCP plugin and identity to persist complete review findings and verdicts, verify readback and use supported failsafes. Report audit delivery separately from job outcome. Preserve review attempts, accept reviewer-reported progress/ETA, and apply the documented stall-and-relaunch rule without general job duration limits.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] Persist complete review findings and verdicts through the executing agent's supported MCP plugin and real identity, then verify readback. Source: docs/plans/grok-cline-integration.md:64. (evidence: Source specification only: docs/plans/grok-cline-integration.md:64. Not a test execution receipt; runtime verification pending.)
- [ ] On audit delivery failure retain evidence via supported failsafes and expose delivery status separately from execution outcome; infrastructure failure alone does not manufacture review failure. Source: docs/plans/grok-cline-integration.md:64. (evidence: Source specification only: docs/plans/grok-cline-integration.md:64. Not a test execution receipt; runtime verification pending.)
- [ ] Reviewer runs are not bounded by fixed time or size; after more than 30 minutes without reviewer output, preserve the stopped attempt and record a relaunch as a separate attempt. Source: docs/plans/grok-cline-integration.md:62. (evidence: Source specification only: docs/plans/grok-cline-integration.md:62. Not a test execution receipt; runtime verification pending.)
- [ ] Progress percentages and ETAs come from the reviewer rather than being invented by Frenemy. Source: docs/plans/grok-cline-integration.md:62. (evidence: Source specification only: docs/plans/grok-cline-integration.md:62. Not a test execution receipt; runtime verification pending.)
- [ ] Validation includes long transcripts, full verdict retention, audit retry and hash-verified readback. Source: docs/plans/grok-cline-integration.md:104. (evidence: Source specification only: docs/plans/grok-cline-integration.md:104. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-111 Install and migrate selected agent clients safely

Register the shared MCP interface for selected clients and require only their CLIs. Preview changes, preserve unrelated configuration and original backups, avoid automatic approval of write/resume-write/escalation tools, remain repeatable without duplicates, and support rollback preserving later unrelated edits. Replace delegation instructions and document v2 behavior changes and recovery.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] Install only selected clients and require only their installed CLIs, checking versions and capabilities. Source: docs/plans/grok-cline-integration.md:68,72. (evidence: Source specification only: docs/plans/grok-cline-integration.md:68,72. Not a test execution receipt; runtime verification pending.)
- [ ] -WhatIf previews configuration changes without applying them. Source: docs/plans/grok-cline-integration.md:73. (evidence: Source specification only: docs/plans/grok-cline-integration.md:73. Not a test execution receipt; runtime verification pending.)
- [ ] Before modification copy and hash-verify configuration backups and retain originals. Source: docs/plans/grok-cline-integration.md:74. (evidence: Source specification only: docs/plans/grok-cline-integration.md:74. Not a test execution receipt; runtime verification pending.)
- [ ] Preserve unrelated settings and change only Frenemy-managed entries. Source: docs/plans/grok-cline-integration.md:75. (evidence: Source specification only: docs/plans/grok-cline-integration.md:75. Not a test execution receipt; runtime verification pending.)
- [ ] Do not automatically approve write, resume-write or permission-escalation tools. Source: docs/plans/grok-cline-integration.md:76. (evidence: Source specification only: docs/plans/grok-cline-integration.md:76. Not a test execution receipt; runtime verification pending.)
- [ ] Repeated installation creates no duplicate registrations or instruction sections. Source: docs/plans/grok-cline-integration.md:77. (evidence: Source specification only: docs/plans/grok-cline-integration.md:77. Not a test execution receipt; runtime verification pending.)
- [ ] Rollback restores managed changes without overwriting later unrelated edits. Source: docs/plans/grok-cline-integration.md:78. (evidence: Source specification only: docs/plans/grok-cline-integration.md:78. Not a test execution receipt; runtime verification pending.)
- [ ] Provide common job-interface instructions and explicit v2 migration/recovery documentation; validate fresh install, repeat, upgrade, conflicts and rollback. Source: docs/plans/grok-cline-integration.md:80,105. (evidence: Source specification only: docs/plans/grok-cline-integration.md:80,105. Not a test execution receipt; runtime verification pending.)

## FR-FRENEMY-112 Validate the proposed release through gated delivery

Deliver requirements/contracts, job runtime, agent integration and installation/release validation in four gated phases. Cover 100% of increment AC with independent green mocks and negative controls before implementation, then bind the same cases to production. Validate both hosts and all documented routing, isolation, fault, recovery, audit and installation scenarios. Require the specified independent review at each phase exit.
Scope: proposed-v2+
**Acceptance Criteria:**
- [ ] Before implementation of an increment, independent mocks and negative controls demonstrate that tests cover 100% of its AC and reject deliberately wrong responses within a passing suite. Source: docs/plans/grok-cline-integration.md:93. (evidence: Source specification only: docs/plans/grok-cline-integration.md:93. Not a test execution receipt; runtime verification pending.)
- [ ] Bind the same test cases/assertions to production behavior after the green mock gate. Source: docs/plans/grok-cline-integration.md:93. (evidence: Source specification only: docs/plans/grok-cline-integration.md:93. Not a test execution receipt; runtime verification pending.)
- [ ] Use Nuke for Node tests, PowerShell validation and integration tests; retain original output and validated TRX reports. Source: docs/plans/grok-cline-integration.md:95. (evidence: Source specification only: docs/plans/grok-cline-integration.md:95. Not a test execution receipt; runtime verification pending.)
- [ ] Run targeted tests after edits and the full applicable suite at each of the four phase exits on the required lab hosts. Source: docs/plans/grok-cline-integration.md:86-95. (evidence: Source specification only: docs/plans/grok-cline-integration.md:86-95. Not a test execution receipt; runtime verification pending.)
- [ ] Release evidence covers all scenarios listed by the plan, including malformed events, partial output, duplicate requests, failure cases, recovery, permissions, artifacts, audit and installation. Source: docs/plans/grok-cline-integration.md:97-105. (evidence: Source specification only: docs/plans/grok-cline-integration.md:97-105. Not a test execution receipt; runtime verification pending.)
- [ ] At each phase exit verify Claude Opus 5.5 high identity and supply the complete evidence and TRX; reviewer does not independently build or run tests. Source: docs/plans/grok-cline-integration.md:107. (evidence: Source specification only: docs/plans/grok-cline-integration.md:107. Not a test execution receipt; runtime verification pending.)
- [ ] Phase acceptance requires AGREE, accuracy >=98%, completeness >=98%, and no unresolved applicable FAIL or UNKNOWN. Source: docs/plans/grok-cline-integration.md:107. (evidence: Source specification only: docs/plans/grok-cline-integration.md:107. Not a test execution receipt; runtime verification pending.)

## FR-MCP-TRIAGE-002 FR-MCP-TRIAGE-002

Placeholder requirement backfilled for TODO link FR-MCP-TRIAGE-002.
Scope: layer-1+

