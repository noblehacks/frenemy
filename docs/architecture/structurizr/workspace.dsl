workspace "Frenemy architecture" "Baseline c7338ad and approved v2 design. Target views are not implemented behavior." {
    !identifiers hierarchical
    model {
        operator = person "Operator" "Owns repositories, permissions and agent subscriptions." "Unchanged"
        claude = softwareSystem "Claude Code CLI" "External agent client and delegated process; internals not owned." "Unchanged"
        codex = softwareSystem "Codex CLI" "External agent client and delegated process; internals not owned." "Unchanged"
        grok = softwareSystem "Grok Build CLI" "External client and delegated process; capability checked at installation." "Added"
        cline = softwareSystem "Cline CLI" "External client and ACP delegated process; native Windows executable required." "Added"
        auth = softwareSystem "CLI authentication and providers" "Existing CLI credential stores and upstream providers. Frenemy never collects credentials." "Unchanged"
        baseline = softwareSystem "Frenemy BASELINE c7338ad" "Observed source at c7338ad39b646e695e7c4b5fbd998d45be914c02." "Baseline" {
            relay = container "Claude relay" "One stdio process per Codex connection; fixed startup cwd." "Node.js / ask-claude-mcp.mjs" "Replaced" {
                framing = component "Line framing" "stdin data handler, buffer, discarding; 8 Mi character input line guard." "JavaScript" "Modified"
                rpc = component "MCP dispatcher" "handle, TOOLS, reply, send; two blocking tool calls." "JavaScript" "Modified"
                launch = component "Claude launch and limits" "runClaude, resolveClaudeOnWindowsPath; 4 calls/process, 10 minutes, output cap; direct-child kill." "JavaScript" "Replaced"
                sanitize = component "Response sanitization" "sanitize strips terminal controls and private-key blocks, best effort." "JavaScript" "Modified"
            }
            win = container "Windows installer" "install.ps1 executed by the user; append-only registration, skip existing entries." "PowerShell" "Modified" {
                preflight = component "Prerequisite checks" "Node, native claude.exe, Codex; absolute Node path, version warnings." "install.ps1:29-107" "Modified"
                config = component "Append configuration" "Append-Utf8; Codex TOML and Claude delegation instructions." "install.ps1:23-25,109-176" "Modified"
            }
            unix = container "Mac/Linux installer" "install.sh; existing Bash source only, not a target implementation language." "Bash" "Replaced" {
                preflight = component "Prerequisite and path checks" "Control-character refusal, Node path/version, Codex warning, TOML escaping." "install.sh:20-78" "Modified"
                config = component "Append and optional helper copy" "Codex registration, CLAUDE.md section, optional genimg.sh copy and chmod." "install.sh:80-153" "Modified"
            }
            helper = container "Optional image helper" "genimg.sh; existing Mac/Linux behavior, excluded from integration changes." "Bash" "Unchanged" {
                image = component "Image workflow" "Prompt angle-bracket stripping; temp cwd; codex exec; out.png validation and move; EXIT cleanup." "genimg.sh:8-68" "Unchanged"
            }
            settings = container "User configuration" "~/.codex/config.toml; ~/.claude/CLAUDE.md; optional ~/.claude/scripts/genimg.sh." "User-owned files" "Modified"
            repo = container "Caller repository" "Relay startup cwd; write calls may edit caller checkout directly." "Filesystem / Git checkout" "Modified"
            output = container "Requested image output" "User-selected output path; may be outside the caller repository." "Filesystem" "Unchanged"
        }
        target = softwareSystem "Frenemy TARGET v2 DESIGN" "Approved design; implementation phases 3-5 remain gated by architecture acceptance." "Added" {
            bridge = container "MCP client bridge" "One stdio process per caller; disconnect does not own job lifetime." "Node.js DESIGN" "Modified" {
                rpc = component "MCP tool facade" "list_agents, start/read/write, get_job, read_job_events, cancel, resume; legacy aliases return handles." "mcp-tools.mjs DESIGN" "Modified"
                ipc = component "Local IPC client" "Trusted configured caller/workspace binding; no caller-supplied identity override." "ipc-client.mjs DESIGN" "Added"
            }
            service = container "Per-user job service" "Single owner of durable jobs and processes; 4 active jobs by default, excess queued." "Node.js DESIGN" "Added" {
                api = component "Job API and discovery" "Validates contracts, versions, capabilities, idempotency and workspace ownership." "job-api.mjs DESIGN" "Added"
                scheduler = component "Scheduler" "Four active jobs per host; one active turn/session; reject delegated recursion." "scheduler.mjs DESIGN" "Added"
                store = component "Durable repository" "Persist accepted requests before launch; ordered events, attempts, artifacts." "job-store.mjs DESIGN" "Added"
                policy = component "Permission enforcement" "Read/write policy and capability checks; fail closed; explicit permission decisions bound to job/attempt." "permissions.mjs DESIGN" "Added"
                process = component "Owned process supervisor" "Resolved executable and argv without shell; cancellation affects owned tree only." "process-supervisor.mjs DESIGN" "Added"
                claude = component "Claude adapter" "Headless streaming JSON, permissions, exact recorded session; requested/observed identity." "adapters/claude.mjs DESIGN" "Modified"
                codex = component "Codex adapter" "exec JSON, stdin prompts, explicit sandbox and exact-session continuation." "adapters/codex.mjs DESIGN" "Added"
                grok = component "Grok adapter" "Headless stream, protected prompt file, model/effort/session; Windows permission capability must be proven." "adapters/grok.mjs DESIGN" "Added"
                cline = component "Cline ACP adapter" "ACP prompts/events/permission/cancel/load; --auto-approve false; native Windows executable." "adapters/cline.mjs DESIGN" "Added"
                events = component "Event and result retrieval" "Credential redaction before persistence; monotonic cursors; complete retained streams and artifacts." "events.mjs DESIGN" "Modified"
                recovery = component "Recovery and resume" "Interrupted history after restart; explicit exact-session continuation; no silent write replay." "recovery.mjs DESIGN" "Added"
            }
            installer = container "Selected-client installer" "Windows/Linux PowerShell; capability discovery, preview, copy/verify backups, surgical merge and rollback." "install.ps1 DESIGN" "Modified" {
                discovery = component "Executable and capability probe" "Selected clients only; record absolute executable, version, model/provider capability." "Install-Discovery.psm1 DESIGN" "Modified"
                merge = component "Configuration transaction" "WhatIf preview, managed-entry patch, idempotent registration and instructions; no auto-approved writes." "Install-Configuration.psm1 DESIGN" "Modified"
                rollback = component "Rollback journal" "Copy/hash originals; restore only owned changes; report conflicts and preserve later unrelated edits." "Install-Rollback.psm1 DESIGN" "Added"
            }
            jobs = container "Durable job data" "Per-user private storage: requests, states, attempts, complete redacted events, artifacts." "Local durable storage DESIGN" "Added"
            settings = container "Client configuration and backups" "Only Frenemy-owned entries in selected client config; retained preimages/hashes and change journal." "User-owned files DESIGN" "Modified"
            repo = container "Caller workspace" "Configured execution directory; write jobs edit caller files directly." "Filesystem" "Modified"
        }
        operator -> claude "Uses and authorizes" "CLI" "Unchanged"
        operator -> codex "Uses and authorizes" "CLI" "Unchanged"
        operator -> grok "Uses and authorizes" "CLI" "Added"
        operator -> cline "Uses and authorizes" "CLI" "Added"
        claude -> auth "Uses existing authentication" "Provider protocol" "Unchanged"
        codex -> auth "Uses existing authentication" "Provider protocol" "Unchanged"
        grok -> auth "Uses existing authentication" "Provider protocol" "Added"
        cline -> auth "Uses selected existing provider" "Provider protocol" "Added"
        codex -> baseline.relay.framing "Calls two tools" "stdio JSON-RPC" "Replaced"
        baseline.relay.framing -> baseline.relay.rpc "Parses requests" "JSON" "Modified"
        baseline.relay.rpc -> baseline.relay.launch "Runs Claude per tool call" "runClaude" "Replaced"
        baseline.relay.launch -> claude "Spawns headless process" "stdin / JSON stdout" "Modified"
        baseline.relay.launch -> baseline.repo "Uses fixed startup cwd" "Filesystem" "Modified"
        baseline.relay.rpc -> baseline.relay.sanitize "Sanitizes result" "sanitize" "Modified"
        operator -> baseline.win.preflight "Runs installer" "PowerShell" "Modified"
        baseline.win.preflight -> baseline.win.config "Checks before append" "In-process" "Modified"
        baseline.win.config -> baseline.settings "Appends configuration" "UTF-8" "Modified"
        operator -> baseline.unix.preflight "Runs Mac/Linux installer" "Shell" "Replaced"
        baseline.unix.preflight -> baseline.unix.config "Checks before append" "In-process" "Modified"
        baseline.unix.config -> baseline.settings "Appends and optionally copies helper" "Filesystem" "Modified"
        baseline.settings -> codex "Configures Node relay and read tool approval" "TOML" "Modified"
        baseline.settings -> claude "Supplies delegation instructions" "CLAUDE.md" "Modified"
        claude -> codex "Delegates per instructions" "codex exec" "Replaced"
        claude -> baseline.helper.image "Uses optional installed script" "genimg.sh" "Unchanged"
        baseline.helper.image -> codex "Requests out.png in temporary workspace" "codex exec workspace-write" "Unchanged"
        baseline.helper.image -> baseline.output "Moves generated image to requested destination" "Filesystem" "Unchanged"
        claude -> target.bridge.rpc "Submits and queries authorized jobs" "stdio MCP" "Added"
        codex -> target.bridge.rpc "Submits and queries authorized jobs" "stdio MCP" "Modified"
        grok -> target.bridge.rpc "Submits and queries authorized jobs" "stdio MCP" "Added"
        cline -> target.bridge.rpc "Submits and queries authorized jobs" "stdio MCP" "Added"
        target.bridge.rpc -> target.bridge.ipc "Binds connection identity and validates tool schema" "In-process" "Added"
        target.bridge.ipc -> target.service.api "Sends commands and queries" "Named pipe / Unix socket" "Added"
        target.service.api -> target.service.store "Commits accepted request or returns existing idempotent result" "Durable transaction" "Added"
        target.service.api -> target.service.scheduler "Queues accepted job" "Job ID" "Added"
        target.service.api -> target.service.events "Retrieves status and cursor pages" "Job ID / cursor" "Added"
        target.service.api -> target.service.recovery "Requests explicit resume" "Recorded session ID" "Added"
        target.service.api -> target.service.process "Requests owned cancellation" "Job ID / attempt ID" "Added"
        target.service.scheduler -> target.service.policy "Checks access mode and permission capability" "Job contract" "Added"
        target.service.policy -> target.service.store "Records decision or awaiting_permission" "Job / attempt / permission ID" "Added"
        target.service.policy -> target.service.process "Allows enforceable launch or fails closed" "Permission policy" "Added"
        target.service.process -> target.repo "Uses configured workspace for read or authorized write" "Filesystem cwd" "Modified"
        target.service.process -> target.service.claude "Launches adapter contract" "AgentAdapter" "Modified"
        target.service.process -> target.service.codex "Launches adapter contract" "AgentAdapter" "Added"
        target.service.process -> target.service.grok "Launches adapter contract" "AgentAdapter" "Added"
        target.service.process -> target.service.cline "Launches adapter contract" "AgentAdapter" "Added"
        target.service.claude -> claude "Executes or resumes exact session" "Headless stream JSON / stdin" "Modified"
        target.service.codex -> codex "Executes or resumes exact session" "exec JSON / stdin" "Added"
        target.service.grok -> grok "Executes or resumes exact session" "Stream JSON / prompt file" "Added"
        target.service.cline -> cline "Executes or loads exact session" "ACP stdio" "Added"
        target.service.claude -> target.service.events "Normalizes events and identity" "AgentEvent" "Modified"
        target.service.codex -> target.service.events "Normalizes events and identity" "AgentEvent" "Added"
        target.service.grok -> target.service.events "Normalizes events and identity" "AgentEvent" "Added"
        target.service.cline -> target.service.events "Normalizes events and identity" "AgentEvent" "Added"
        target.service.cline -> target.service.policy "Requests explicit permission decision" "ACP permission request" "Added"
        target.service.policy -> target.bridge "Requests authenticated caller permission; unsupported callback fails" "Bound permission callback" "Added"
        target.bridge -> target.service.policy "Returns explicit current decision or denial" "Job / attempt / permission ID" "Added"
        target.service.policy -> target.service.cline "Returns bound allow or deny; read restrictions remain enforced" "ACP permission response" "Added"
        target.service.events -> target.service.store "Appends complete redacted events and result" "Ordered sequence" "Added"
        target.service.store -> target.jobs "Persists state and evidence" "Local storage" "Added"
        target.service.recovery -> target.service.store "Marks unfinished attempts interrupted and reads exact session" "Durable state" "Added"
        target.service.recovery -> target.service.scheduler "Queues explicitly requested continuation only" "New attempt / same session" "Added"
        target.service.process -> target.service.store "Records owned cancellation outcome" "Terminal transition" "Added"
        operator -> target.installer.discovery "Selects clients and previews installation" "PowerShell -WhatIf" "Modified"
        target.installer.discovery -> target.installer.merge "Provides verified capabilities and paths" "InstallPlan" "Modified"
        target.installer.merge -> target.installer.rollback "Copies and verifies preimages before mutation" "Change journal" "Added"
        target.installer.merge -> target.settings "Patches owned entries only" "Client configuration" "Modified"
        target.installer.rollback -> target.settings "Restores owned changes, retains unrelated edits and originals" "Conditional rollback" "Added"
        target.settings -> target.bridge "Configures MCP launches and trusted binding" "Client registration" "Modified"
        deploymentEnvironment "Baseline-Windows" {
            deploymentNode "Windows user account" "Existing deployment at c7338ad; external clients own auth" "Windows" "DeploymentBoundary" {
                containerInstance baseline.relay
                containerInstance baseline.settings
                containerInstance baseline.repo
                containerInstance baseline.win
                softwareSystemInstance claude
                softwareSystemInstance codex
            }
        }
        deploymentEnvironment "Baseline-Linux" {
            deploymentNode "Linux user account" "Existing deployment at c7338ad; external clients own auth" "Linux" "DeploymentBoundary" {
                containerInstance baseline.relay
                containerInstance baseline.settings
                containerInstance baseline.repo
                containerInstance baseline.unix
                containerInstance baseline.helper
                containerInstance baseline.output
                softwareSystemInstance claude
                softwareSystemInstance codex
            }
        }
        deploymentEnvironment "Baseline-macOS" {
            deploymentNode "macOS user account" "Existing deployment at c7338ad; external clients own auth" "macOS" "DeploymentBoundary" {
                containerInstance baseline.relay
                containerInstance baseline.settings
                containerInstance baseline.repo
                containerInstance baseline.unix
                containerInstance baseline.helper
                containerInstance baseline.output
                softwareSystemInstance claude
                softwareSystemInstance codex
            }
        }
        deploymentEnvironment "Target-Windows" {
            deploymentNode "Windows user account DESIGN" "Named pipe restricted to user SID; owned child process tree; no remote execution" "Windows" "DeploymentBoundary" {
                containerInstance target.bridge
                containerInstance target.service
                containerInstance target.installer
                containerInstance target.jobs
                containerInstance target.settings
                containerInstance target.repo
                softwareSystemInstance claude
                softwareSystemInstance codex
                softwareSystemInstance grok
                softwareSystemInstance cline
            }
        }
        deploymentEnvironment "Target-Linux" {
            deploymentNode "Linux user account DESIGN" "Unix-domain socket private to user; owned process group; no remote execution" "Linux" "DeploymentBoundary" {
                containerInstance target.bridge
                containerInstance target.service
                containerInstance target.installer
                containerInstance target.jobs
                containerInstance target.settings
                containerInstance target.repo
                softwareSystemInstance claude
                softwareSystemInstance codex
                softwareSystemInstance grok
                softwareSystemInstance cline
            }
        }
    }
    views {
        properties {
            "plantuml.sequenceDiagram" "true"
        }
        deployment baseline "Baseline-Windows" "baseline-windows-deployment" {
            include *
            autoLayout lr
        }
        deployment baseline "Baseline-Linux" "baseline-linux-deployment" {
            include *
            autoLayout lr
        }
        deployment baseline "Baseline-macOS" "baseline-macos-deployment" {
            include *
            autoLayout lr
        }
        deployment target "Target-Windows" "target-windows-deployment" {
            include *
            exclude relationship.tag==Replaced
            autoLayout lr
        }
        deployment target "Target-Linux" "target-linux-deployment" {
            include *
            exclude relationship.tag==Replaced
            autoLayout lr
        }

        systemContext baseline "baseline-context" {
            include * auth
            autoLayout lr
        }
        container baseline "baseline-containers" {
            include *
            autoLayout lr
        }
        component baseline.relay "baseline-relay" {
            include *
            autoLayout lr
        }
        component baseline.win "baseline-windows-installer" {
            include *
            autoLayout lr
        }
        component baseline.unix "baseline-unix-installer" {
            include *
            autoLayout lr
        }
        component baseline.helper "baseline-image-helper" {
            include *
            autoLayout lr
        }
        systemContext target "target-context" {
            include * auth
            exclude relationship.tag==Replaced
            autoLayout lr
        }
        container target "target-containers" {
            include *
            exclude relationship.tag==Replaced
            autoLayout tb
        }
        component target.bridge "target-bridge" {
            include *
            exclude relationship.tag==Replaced
            autoLayout lr
        }
        component target.service "target-runtime" {
            include target.service.api target.service.scheduler target.service.store target.service.policy target.service.process target.service.events target.service.recovery target.jobs target.repo target.bridge
            exclude relationship.tag==Replaced
            autoLayout tb
        }
        component target.service "target-adapters" {
            include target.service.process target.service.claude target.service.codex target.service.grok target.service.cline target.service.policy target.service.events target.service.store claude codex grok cline target.jobs
            exclude relationship.tag==Replaced
            autoLayout tb
        }
        component target.installer "target-installer" {
            include *
            exclude relationship.tag==Replaced
            autoLayout lr
        }
        image baseline.relay "baseline-code-relay" {
            image code/baseline-relay.svg
            title "BASELINE code: ask-claude-mcp.mjs at c7338ad"
        }
        image baseline.win "baseline-code-installers" {
            image code/baseline-installers.svg
            title "BASELINE code: Windows and Mac/Linux installers"
        }
        image baseline.unix "baseline-code-unix" {
            image code/baseline-installers.svg
            title "BASELINE code: Mac/Linux installation (target macOS excluded)"
        }
        image target.bridge "target-code-bridge" {
            image code/target-runtime.svg
            title "TARGET DESIGN code: MCP facade and IPC client contracts"
        }
        image baseline.helper "baseline-code-helper" {
            image code/baseline-helper.svg
            title "BASELINE code: optional helper and delegation instructions"
        }
        image target.service "target-code-runtime" {
            image code/target-runtime.svg
            title "TARGET DESIGN code: runtime interfaces and data contracts"
        }
        image target.installer "target-code-installation" {
            image code/target-installation.svg
            title "TARGET DESIGN code: installation and rollback contracts"
        }
        dynamic target.service "target-submission" "DESIGN: accepted request must be durable before launch" {
            target.bridge -> target.service.api "Submit bound caller/workspace request"
            target.service.api -> target.service.store "Commit request ID or return existing job; conflicting payload rejected"
            target.service.api -> target.service.scheduler "Queue durable job; return handle without waiting for execution"
            autoLayout lr
        }
        dynamic target.service "target-execution" "DESIGN: policy then owned process in configured workspace and retained events" {
            target.service.scheduler -> target.service.policy "Reserve capacity and session; reject recursion"
            target.service.policy -> target.service.process "Launch only enforceable permission policy"
            target.service.process -> target.service.claude "Representative adapter launch (other adapters use same seam)"
            target.service.claude -> target.service.events "Normalize full output and observed identity"
            target.service.events -> target.service.store "Redact and durably append before cursor exposure"
            autoLayout lr
        }
        dynamic target.service "target-permissions" "DESIGN: no implicit approval or mode escalation" {
            target.service.cline -> target.service.policy "ACP permission request with job/attempt/request identity"
            target.service.policy -> target.service.store "Persist awaiting_permission; reject forbidden read actions"
            target.service.policy -> target.bridge "Request explicit caller decision; missing callback fails"
            target.bridge -> target.service.policy "Return bound current decision; stale or forbidden approval rejected"
            target.service.policy -> target.service.cline "Return ACP allow or deny without elevating read mode"
            autoLayout lr
        }
        dynamic target.service "target-cancellation" "DESIGN: terminal race resolved once, unrelated processes untouched" {
            target.bridge -> target.service.api "cancel_job for owned workspace/job"
            target.service.api -> target.service.process "Cancel queued work or owned active process tree"
            target.service.process -> target.service.store "Persist one terminal outcome and retain output/artifacts"
            autoLayout lr
        }
        dynamic target.service "target-recovery" "DESIGN: restart never silently replays unfinished work" {
            target.service.recovery -> target.service.store "On restart mark unfinished execution interrupted; retain history"
            target.bridge -> target.service.api "Explicit resume_read_job or approved resume_write_job"
            target.service.api -> target.service.recovery "Validate recorded CLI session, workspace and access mode"
            target.service.recovery -> target.service.scheduler "New attempt for exact session; missing session fails explicitly"
            autoLayout lr
        }
        dynamic target.installer "target-installer-rollback" "DESIGN: preview, retained backups, conflict-aware surgical rollback" {
            operator -> target.installer.discovery "Select clients; WhatIf changes nothing"
            target.installer.discovery -> target.installer.merge "Prepare managed-entry changes from capability checks"
            target.installer.merge -> target.installer.rollback "Copy and hash-verify original before patch"
            target.installer.merge -> target.settings "Apply only owned configuration entries"
            target.installer.rollback -> target.settings "On failure or explicit rollback restore owned fields if unchanged; report conflicts"
            autoLayout lr
        }
        styles {
            element "Element" {
                shape RoundedBox
                background #334155
                color #ffffff
                fontSize 24
            }
            element "Person" {
                shape Person
            }
            element "Unchanged" {
                background #475569
            }
            element "Added" {
                background #166534
            }
            element "Modified" {
                background #92400e
            }
            element "Replaced" {
                background #991b1b
            }
            element "DeploymentBoundary" {
                background #ffffff
                color #334155
                stroke #64748b
            }
            relationship "Unchanged" {
                color #475569
            }
            relationship "Added" {
                color #166534
            }
            relationship "Modified" {
                color #92400e
            }
            relationship "Replaced" {
                color #991b1b
                dashed true
            }
        }
    }
}
