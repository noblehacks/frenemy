workspace "Frenemy: Grok and Cline support" "Observed baseline c7338ad and scoped DESIGN. Only Grok Build and Cline CLI support is added." {
    !identifiers hierarchical
    model {
        operator = person "Operator" "Uses locally authenticated CLIs and selects explicit read or write delegation." "Unchanged"
        claude = softwareSystem "Claude Code CLI" "External client and delegated CLI; existing native authentication and internals." "Unchanged"
        codex = softwareSystem "Codex CLI" "External client and codex exec destination; existing behavior preserved." "Unchanged"
        grok = softwareSystem "Grok Build CLI" "External CLI newly supported by Frenemy; native internals remain external." "Added"
        cline = softwareSystem "Cline CLI" "External CLI newly supported by Frenemy; ACP is an internal invocation detail." "Added"
        auth = softwareSystem "Native CLI authentication and providers" "CLIs retain their existing credentials; Frenemy selects supported provider, model and effort inputs without owning external authentication." "Unchanged"
        baseline = softwareSystem "Frenemy BASELINE c7338ad" "Observed source at c7338ad39b646e695e7c4b5fbd998d45be914c02." "Baseline" {
            relay = container "Claude relay" "One stdio process per Codex connection; fixed startup cwd." "Node.js / ask-claude-mcp.mjs" "Unchanged" {
                framing = component "Line framing" "stdin data handler, buffer, discarding; 8 Mi character input line guard." "JavaScript" "Unchanged"
                rpc = component "MCP dispatcher" "handle, TOOLS, reply, send; two blocking tool calls." "JavaScript" "Unchanged"
                launch = component "Claude launch and limits" "runClaude, resolveClaudeOnWindowsPath; 4 calls/process, 10 minutes, output cap; direct-child kill." "JavaScript" "Unchanged"
                sanitize = component "Response sanitization" "sanitize strips terminal controls and private-key blocks, best effort." "JavaScript" "Unchanged"
            }
            win = container "Windows installer" "install.ps1 executed by the user; append-only registration, skip existing entries." "PowerShell" "Unchanged" {
                preflight = component "Prerequisite checks" "Node, native claude.exe, Codex; absolute Node path, version warnings." "install.ps1:29-107" "Unchanged"
                config = component "Append configuration" "Append-Utf8; Codex TOML and Claude delegation instructions." "install.ps1:23-25,109-176" "Unchanged"
            }
            unix = container "Mac/Linux installer" "install.sh; existing Bash source only, not a target implementation language." "Bash" "Unchanged" {
                preflight = component "Prerequisite and path checks" "Control-character refusal, Node path/version, Codex warning, TOML escaping." "install.sh:20-78" "Unchanged"
                config = component "Append and optional helper copy" "Codex registration, CLAUDE.md section, optional genimg.sh copy and chmod." "install.sh:80-149" "Unchanged"
            }
            helper = container "Optional image helper" "genimg.sh; existing Mac/Linux behavior, excluded from integration changes." "Bash" "Unchanged" {
                image = component "Image workflow" "Prompt angle-bracket stripping; temp cwd; codex exec; out.png validation and move; EXIT cleanup." "genimg.sh:8-68" "Unchanged"
            }
            settings = container "User configuration" "~/.codex/config.toml; ~/.claude/CLAUDE.md; optional ~/.claude/scripts/genimg.sh." "User-owned files" "Unchanged"
            repo = container "Caller repository" "Relay startup cwd; write calls may edit caller checkout directly." "Filesystem / Git checkout" "Unchanged"
            output = container "Requested image output" "User-selected output path; may be outside the caller repository." "Filesystem" "Unchanged"
        }

        target = softwareSystem "Frenemy TARGET DESIGN" "Existing relay extended only for Grok Build and Cline CLI support." "Design,Modified" {
            relay = container "Blocking agent relay" "Existing ask-claude-mcp.mjs process extended with four calls and validated execution selectors; one answer/error per call, fixed startup cwd." "Node.js" "Modified" {
                framing = component "Line framing" "Existing stdin callback, buffer and discarding behavior retained." "JavaScript" "Unchanged"
                rpc = component "MCP dispatcher" "Existing handle/TOOLS/send/reply plus four Grok/Cline read/write tools whose inputs may include supported selectors." "JavaScript" "Modified"
                selectors = component "Configuration and selector resolution" "Loads and validates the product-owned JSON configuration at startup; resolves caller input over per-agent defaults and rejects invalid values before launch." "JavaScript" "Added"
                launch = component "Claude invocation" "Existing runClaude and Windows resolution, limits and error behavior retained." "JavaScript" "Unchanged"
                grok = component "Grok invocation" "One headless prompt with native read/write flags; map model and effort to native argv; parse JSON answer." "JavaScript" "Added"
                cline = component "Cline invocation" "One ACP prompt with native permission responses; map provider/model into a child-only environment and effort to --thinking without mutating the parent environment." "JavaScript" "Added"
                sanitize = component "Response sanitization" "Existing sanitize; best-effort terminal/private-key cleanup, not comprehensive secret protection." "JavaScript" "Unchanged"
            }
            selectorConfig = container "Frenemy selector configuration" "Product-owned frenemy.config.json and frenemy.config.schema.json define optional defaults for Claude, Grok and Cline. Invalid startup configuration fails closed on tool calls." "JSON / JSON Schema" "Added"
            win = container "Retained Windows installer" "install.ps1 unchanged; legacy Claude/Codex setup." "PowerShell" "Unchanged" {
                preflight = component "Existing prerequisite checks" "install.ps1:29-107 unchanged." "PowerShell" "Unchanged"
                config = component "Existing append configuration" "Append-Utf8 and legacy settings, install.ps1:23-25,109-176." "PowerShell" "Unchanged"
            }
            unix = container "Retained Mac/Linux installer" "install.sh unchanged; legacy setup and optional helper." "Bash existing source" "Unchanged" {
                preflight = component "Existing path checks" "install.sh:20-78 unchanged." "Bash" "Unchanged"
                config = component "Existing append/helper copy" "install.sh:80-149 unchanged." "Bash" "Unchanged"
            }
            settings = container "Existing user configuration" "Legacy relay registration and Claude/Codex instructions." "User-owned files" "Unchanged"
            repo = container "Caller workspace" "Relay startup directory; explicit write calls may edit files." "Filesystem" "Unchanged"
            output = container "Requested image output" "Existing user-selected image output path." "Filesystem" "Unchanged"
            promptTemp = container "Invocation-local Grok prompt" "Exclusive protected temp directory/file, finally cleanup; protected residue after uncatchable crash." "OS temp filesystem DESIGN" "Added"
            acl = container "Windows prompt ACL helper" "Fixed Protect-GrokPrompt.ps1 child invoked by native pwsh.exe before writing prompt bytes; Windows only." "PowerShell7 process DESIGN" "Added" {
                protect = component "Protect prompt directory" "Apply non-inheriting current-user/SYSTEM ACL; return success/error before parent writes prompt." "Protect-GrokPrompt.ps1 DESIGN" "Added"
            }
            helper = container "Optional image helper" "Existing genimg.sh unchanged; changes excluded." "Bash (existing source)" "Unchanged" {
                image = component "Existing image workflow" "Retained source at genimg.sh:8-68; no integration changes." "Bash" "Unchanged"
            }
        }
        operator -> baseline "Uses existing delegation" "Local CLI" "Unchanged"
        operator -> target "Uses existing MCP server" "Local CLI" "Unchanged"
        claude -> auth "Uses existing authentication" "Native CLI" "Unchanged"
        codex -> auth "Uses existing authentication" "Native CLI" "Unchanged"
        grok -> auth "Uses existing authentication" "Native CLI" "Added"
        cline -> auth "Uses existing authentication" "Native CLI" "Added"
        codex -> baseline.relay.framing "Sends MCP request" "stdio JSON-RPC" "Unchanged"
        baseline.relay.framing -> baseline.relay.rpc "Dispatches parsed message" "In-process" "Unchanged"
        baseline.relay.rpc -> baseline.relay.launch "Awaits runClaude result" "In-process" "Unchanged"
        baseline.relay.launch -> claude "Runs prompt; reads JSON result" "stdin/stdout" "Unchanged"
        baseline.relay.launch -> baseline.repo "Uses startup cwd" "Filesystem" "Unchanged"
        baseline.relay.rpc -> baseline.relay.sanitize "Sanitizes result before reply" "In-process" "Unchanged"
        operator -> baseline.win.preflight "Runs Windows installer" "PowerShell" "Unchanged"
        baseline.win.preflight -> baseline.win.config "Checks before append" "In-process" "Unchanged"
        baseline.win.config -> baseline.settings "Appends registration/instructions" "UTF-8" "Unchanged"
        operator -> baseline.unix.preflight "Runs Mac/Linux installer" "Shell" "Unchanged"
        baseline.unix.preflight -> baseline.unix.config "Checks before append" "In-process" "Unchanged"
        baseline.unix.config -> baseline.settings "Appends configuration and optional helper" "Filesystem" "Unchanged"
        baseline.settings -> codex "Registers relay" "TOML" "Unchanged"
        baseline.settings -> claude "Supplies instructions" "CLAUDE.md" "Unchanged"
        claudeToCodex = claude -> codex "Delegates using existing instructions" "codex exec" "Unchanged"
        claude -> baseline.helper.image "Uses optional helper" "genimg.sh" "Unchanged"
        baseline.helper.image -> codex "Requests out.png" "codex exec" "Unchanged"
        baseline.helper.image -> baseline.output "Moves generated output" "Filesystem" "Unchanged"
        codex -> target.relay.framing "Calls blocking tools" "stdio MCP" "Modified"
        target.relay.framing -> target.relay.rpc "Dispatches parsed message" "In-process" "Unchanged"
        target.relay.rpc -> target.relay.selectors "Validates and resolves optional provider/model/effort" "In-process" "Added"
        target.relay.selectors -> target.selectorConfig "Loads startup defaults and validates the owned schema contract" "Filesystem / JSON" "Added"
        target.relay.selectors -> target.relay.launch "Supplies resolved Claude model and effort" "In-process" "Added"
        target.relay.selectors -> target.relay.grok "Supplies resolved Grok model and effort" "In-process" "Added"
        target.relay.selectors -> target.relay.cline "Supplies resolved Cline provider, model and effort" "In-process" "Added"
        target.relay.rpc -> target.relay.launch "Awaits existing Claude result" "In-process" "Unchanged"
        target.relay.rpc -> target.relay.grok "Awaits Grok result" "In-process" "Added"
        target.relay.rpc -> target.relay.cline "Awaits Cline result" "In-process" "Added"
        target.relay.rpc -> target.relay.sanitize "Sanitizes final result" "In-process" "Unchanged"
        target.relay.launch -> claude "Runs existing Claude invocation" "stdin/stdout" "Unchanged"
        target.relay.grok -> grok "Runs one prompt with native mode and selector argv; parses the JSON answer" "Native CLI / stdout" "Added"
        target.relay.cline -> cline "Runs one prompt with child-only CLINE_PROVIDER/CLINE_MODEL, --thinking, and native permission responses" "ACP stdio" "Added"
        target.relay.launch -> target.repo "Uses startup cwd" "Filesystem" "Unchanged"
        target.relay.grok -> target.repo "Uses startup cwd" "Filesystem" "Added"
        target.relay.cline -> target.repo "Uses startup cwd" "Filesystem" "Added"
        operator -> target.win.preflight "Runs retained Windows setup" "PowerShell" "Unchanged"
        target.win.preflight -> target.win.config "Checks before append" "In-process" "Unchanged"
        target.win.config -> target.settings "Appends legacy settings" "UTF-8" "Unchanged"
        operator -> target.unix.preflight "Runs retained Mac/Linux setup" "Shell" "Unchanged"
        target.unix.preflight -> target.unix.config "Checks before append" "In-process" "Unchanged"
        target.unix.config -> target.settings "Appends legacy settings/helper" "Filesystem" "Unchanged"
        target.relay.grok -> target.acl.protect "Protects owned temp directory on Windows before prompt write" "pwsh.exe child / fixed script" "Added"
        target.acl.protect -> target.promptTemp "Sets non-inheriting user/SYSTEM ACL" "Windows filesystem ACL" "Added"
        target.relay.grok -> target.promptTemp "Creates, writes and finally removes owned prompt; Linux mode 0700/0600" "Filesystem" "Added"
        grok -> target.promptTemp "Reads prompt file argument" "Filesystem" "Added"
        target.settings -> claude "Supplies existing instructions" "CLAUDE.md" "Unchanged"
        target.settings -> codex "Retains existing registration" "TOML" "Unchanged"
        claude -> target.helper.image "Uses unchanged optional helper" "genimg.sh" "Unchanged"
        target.helper.image -> codex "Uses existing image invocation" "codex exec" "Unchanged"
        target.helper.image -> target.output "Moves generated output" "Filesystem" "Unchanged"
deploymentEnvironment "baseline-Windows" {
deploymentNode "Windows user environment" "Local CLI processes and caller workspace" "Windows" {
containerInstance baseline.relay
containerInstance baseline.settings
containerInstance baseline.repo
containerInstance baseline.win
softwareSystemInstance claude
softwareSystemInstance codex
}
}
deploymentEnvironment "baseline-Linux" {
deploymentNode "Linux user environment" "Local CLI processes and caller workspace" "Linux" {
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
deploymentEnvironment "baseline-macOS" {
deploymentNode "macOS user environment" "Local CLI processes and caller workspace" "macOS" {
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
deploymentEnvironment "target-Windows" {
deploymentNode "Windows user environment" "Local CLI processes and caller workspace" "Windows" {
containerInstance target.relay
containerInstance target.selectorConfig
containerInstance target.settings
containerInstance target.repo
containerInstance target.win
containerInstance target.acl
containerInstance target.promptTemp
softwareSystemInstance claude
softwareSystemInstance codex
softwareSystemInstance grok
softwareSystemInstance cline
}
}
deploymentEnvironment "target-Linux" {
deploymentNode "Linux user environment" "Local CLI processes and caller workspace" "Linux" {
containerInstance target.relay
containerInstance target.selectorConfig
containerInstance target.settings
containerInstance target.repo
containerInstance target.unix
containerInstance target.helper
containerInstance target.output
containerInstance target.promptTemp
softwareSystemInstance claude
softwareSystemInstance codex
softwareSystemInstance grok
softwareSystemInstance cline
}
}
    }
    views {
        systemContext baseline "baseline-context" {
include * auth
autoLayout lr
}
        systemContext target "target-context" {
include * auth
autoLayout lr
}
        container baseline "baseline-containers" {
include *
autoLayout lr
}
        container target "target-containers" {
include *
autoLayout lr
}
deployment baseline "baseline-Windows" "baseline-Windows-deployment" {
include *
autoLayout lr
}
deployment baseline "baseline-Linux" "baseline-Linux-deployment" {
include *
autoLayout lr
}
deployment baseline "baseline-macOS" "baseline-macOS-deployment" {
include *
autoLayout lr
}
deployment target "target-Windows" "target-Windows-deployment" {
include *
autoLayout lr
}
deployment target "target-Linux" "target-Linux-deployment" {
include *
autoLayout lr
}
component baseline.relay "baseline-relay-components" {
include *
autoLayout lr
}
component baseline.win "baseline-win-components" {
include *
autoLayout lr
}
component baseline.unix "baseline-unix-components" {
include *
autoLayout lr
}
component baseline.helper "baseline-helper-components" {
include *
autoLayout lr
}
component target.relay "target-relay-components" {
include *
autoLayout lr
}
component target.win "target-win-components" {
include *
autoLayout lr
}
component target.unix "target-unix-components" {
include *
autoLayout lr
}
component target.acl "target-acl-components" {
include *
autoLayout lr
}
image target.acl "target-acl-code" {
image code/target-acl.svg
title "Windows prompt ACL helper: DESIGN"
}
component target.helper "target-helper-components" {
include *
exclude claudeToCodex
autoLayout lr
}
image baseline.relay "baseline-relay-code" {
image code/baseline-relay.svg
title "baseline-relay code: observed baseline or labelled DESIGN"
}
image baseline.win "baseline-win-code" {
image code/baseline-installers.svg
title "baseline-win code: observed baseline or labelled DESIGN"
}
image baseline.unix "baseline-unix-code" {
image code/baseline-installers.svg
title "baseline-unix code: observed baseline or labelled DESIGN"
}
image baseline.helper "baseline-helper-code" {
image code/baseline-helper.svg
title "baseline-helper code: observed baseline or labelled DESIGN"
}
image target.relay "target-relay-code" {
image code/target-relay.svg
title "target-relay code: observed baseline or labelled DESIGN"
}
image target.win "target-win-code" {
image code/baseline-installers.svg
title "Retained Windows installer: unchanged observed code"
}
image target.unix "target-unix-code" {
image code/baseline-installers.svg
title "Retained Mac/Linux installer: unchanged observed code"
}
image target.helper "target-helper-code" {
image code/baseline-helper.svg
title "target-helper code: observed baseline or labelled DESIGN"
}
        dynamic target.relay "target-grok-call" "One blocking read or explicit write invocation with optional model and effort" {
            codex -> target.relay.framing "Submit prompt to selected Grok tool"
            target.relay.framing -> target.relay.rpc "Dispatch"
            target.relay.rpc -> target.relay.selectors "Validate caller selectors and resolve caller over Grok defaults"
            target.relay.selectors -> target.selectorConfig "Read validated startup defaults"
            target.relay.selectors -> target.relay.grok "Supply model and effort"
            target.relay.rpc -> target.relay.grok "Dispatch under the shared relay deadline and capacity"
            target.relay.grok -> target.acl "Windows: protect unique temp directory before prompt bytes"
            target.relay.grok -> target.promptTemp "Exclusive protected UTF-8 prompt write; Linux0700/0600"
            target.relay.grok -> grok "Submit prompt file with qualified native access mode, --model and --reasoning-effort"
            target.relay.grok -> target.promptTemp "Finally cleanup on success and every caught failure"
            target.relay.rpc -> target.relay.sanitize "Clean final answer/error before MCP response"
            autoLayout lr
        }
        dynamic target.relay "target-cline-call" "Internal ACP exchange with optional provider, model and effort" {
            codex -> target.relay.framing "Submit prompt to selected Cline tool"
            target.relay.framing -> target.relay.rpc "Dispatch"
            target.relay.rpc -> target.relay.selectors "Validate caller selectors and resolve caller over Cline defaults"
            target.relay.selectors -> target.selectorConfig "Read validated startup defaults"
            target.relay.selectors -> target.relay.cline "Supply provider, model and effort"
            target.relay.rpc -> target.relay.cline "Dispatch under the shared relay deadline and capacity"
            target.relay.cline -> cline "ACP init/session and prompt with child-only provider/model env and --thinking; translate exact permission options"
            target.relay.cline -> cline "Close native child before final answer/error"
            target.relay.rpc -> target.relay.sanitize "Clean final answer/error before MCP response"
            autoLayout lr
        }
        styles {
            element "Element" {
color #ffffff
background #3b536b
fontSize 22
}
            element "Deployment Node" {
                background #f5f5f5
                color #333333
                stroke #777777
            }
            element "Unchanged" {
background #526477
}
            element "Added" {
background #176b3a
}
            element "Modified" {
background #865a22
}
            element "Replaced" {
background #9c3333
}
            element "Person" {
shape Person
}
            relationship "Relationship" {
color #4d4d4d
fontSize 18
}
            relationship "Added" {
color #176b3a
}
            relationship "Modified" {
color #865a22
}
        }
    }
}
