# C4 design for Grok and Cline in the existing relay

The baseline is pinned to `c7338ad39b646e695e7c4b5fbd998d45be914c02`. The target adds two CLI invocations and four MCP tools to the current server. Those tools accept only their supported provider, model and effort selectors, with optional defaults in the product-owned JSON configuration and schema.

- [Structurizr workspace](workspace.dsl)
- [Baseline source evidence](../source-evidence.md)
- [Architecture decisions](decisions.md)
- [Change traceability](traceability.md)
- [Current use cases](../../../requirements/grok-cline-use-cases.md)
- [Current plan](../../../plans/grok-cline-integration.md)
- [Rendered static site](renders/20261109T072434/site/index.html)
- [Validation and rendering receipt](renders/20261109T072434/receipt.json)
- [Visual inspection](visual-inspection.md)
- [Phase 1 and Phase 2 self-evaluation](../../../receipts/self-eval/20261106T113443-phase1-phase2/final.md)

Separate baseline and target context, container and component views use native Structurizr. The code views embed locally rendered PlantUML SVGs. Deployment views show the existing Windows, Linux and macOS baseline and the target Windows/Linux relay, including the product-owned selector configuration beside the relay. Target dynamic views follow selector resolution and the blocking Grok and Cline calls.

Gray indicates unchanged, green added, brown modified, and red replaced. The current target uses the first three categories. Existing installers, configuration, instructions and the image helper are baseline context. No withdrawn setup, job-service, scheduler, durable-storage, worktree, QBrain, plugin-management, or audit-delivery design is part of this workspace or its render.

Use the pinned [renderer tools](../tool-pins.json) with `Render-Architecture.ps1`. Analyze the script, run `-WhatIf`, then run it normally. The script writes a fresh static site, SVG exports, validator results and hash receipts.
