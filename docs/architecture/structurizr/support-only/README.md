# C4 design for Grok and Cline in the existing relay

The baseline is pinned to `c7338ad39b646e695e7c4b5fbd998d45be914c02`. The target adds two CLI invocations and four MCP tools to the current server.

- [Structurizr workspace](workspace.dsl)
- [Baseline source evidence](../source-evidence.md)
- [Architecture decisions](decisions.md)
- [Change traceability](traceability.md)
- [Current plan](../../../plans/grok-cline-integration.md)
- [Rendered static site](renders/20261105T132045/site/index.html)
- [Validation and rendering receipt](renders/20261105T132045/receipt.json)
- [SVG diagram exports](renders/20261105T132045/exports/)

Separate baseline and target context, container and component views use native Structurizr. The code views embed locally rendered PlantUML SVGs. Deployment views show the existing Windows, Linux and macOS baseline and the planned Windows/Linux relay. Target dynamic views follow the blocking Grok and Cline calls.

Gray indicates unchanged, green added, brown modified, and red replaced. The current target uses the first three categories. Existing installers, configuration, instructions and the image helper are baseline context.

Use the pinned [renderer tools](../tool-pins.json) with `Render-Architecture.ps1`. Analyze the script, run `-WhatIf`, then run it normally. The script writes a fresh static site, SVG exports, validator results and hash receipts.
