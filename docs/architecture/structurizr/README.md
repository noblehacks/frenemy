# Frenemy C4 architecture workspace

Status: Phase 2 implementation in progress. The integration and amendment are approved; architecture acceptance is pending independent review. TDD has not started.

Baseline **c7338ad39b646e695e7c4b5fbd998d45be914c02** is separate from **TARGET v2 DESIGN** throughout the model. The shipped relay and installers are unchanged.

## Browse

- [Interactive Structurizr static site](site/index.html): context, containers, components, code image views, deployment and dynamic navigation.
- [Canonical workspace DSL](workspace.dsl) and [generated workspace JSON](model/workspace.json).
- [Source evidence](source-evidence.md) and [source hash receipts](receipts/source-pins.json).
- [Target interface and data contracts](contracts.md), [architecture decisions](decisions.md), and [change/requirement ledger](traceability.json).
- [Requirement snapshot](receipts/requirements-snapshot.json), [tool pins](tool-pins.json), and [render/validation receipt](receipts/render-validation.json).
- [Approved five-phase plan](../../plans/grok-cline-integration.md).

The static exporter omits documentation and ADR pages. This README is the companion documentation/navigation root; the generated site's view picker links every diagram. Use the site over an approved local HTTP preview or open index.html in your own browser. No publication or external rendering is required.

## View coverage

The 30 required views include two contexts, two container views, eight component views, seven code image views (five local PlantUML source diagrams), five deployments (baseline Windows/Linux/macOS and target Windows/Linux), and six dynamic flows. Passive files/stores have no executable components to invent; their structures and producers/consumers are covered by the code/contract pages.

Baseline owned executables: relay, Windows installer, Mac/Linux installer, optional image helper. The instruction Markdown is data interpreted by external Claude; its flow and symbols are documented with the helper/installer code views. Target owned executables: MCP bridge, per-user job service, PowerShell installer. Runtime components split across runtime and adapter views to limit density. All target modules and contracts are DESIGN, not existing source.

Code images are generated from the five `.puml` files under `code/` and embedded directly as SVG image views. Native Structurizr views also export to `exports/*.puml` and locally rendered `exports/*.svg`; each native view has a separate `-key.svg` legend export. The interactive site includes its diagram legend.

## Changes and traceability

- Gray **Unchanged**: retained responsibility or excluded baseline helper behavior.
- Green **Added**: new target capability/boundary.
- Brown **Modified**: an existing responsibility changes behavior.
- Red **Replaced**: removed from the v2 execution path or superseded, while the immutable baseline remains visible.

These classifications apply to elements and relationships. `baseline.*` and `target.*` are stable namespace identifiers. Logical counterparts: baseline.relay becomes target.bridge plus target.service; baseline launch becomes process supervisor and adapters; baseline settings/repo become target settings/repo; Windows installer is extended; Linux installation responsibility moves from Bash to the PowerShell installer. Existing macOS installer and helper behavior are excluded, not deleted.

`traceability.json` records every model element and relationship, including derived context/container/deployment edges. Each entry identifies originating requirements, relevant UC IDs, FR ACs, planned TEST ACs and responsible delivery phases. Derived edges point to their originating relationship. Requirement-specific test AC IDs are planned coverage, never execution evidence. Architecture-wide coverage uses FR113/TR-ARCH-117/TEST113 in Phase 2. UC10186-10197, except withdrawn UC10192, correspond to FR101-112 except withdrawn FR107; architecture adds no separate user workflow.

## Reproduce locally through PowerShell

1. Obtain the exact Java21 JRE, Structurizr WAR and PlantUML JAR URLs in `tool-pins.json`. The Java and PlantUML pins come from Scoop manifests; the Structurizr pin is the measured official release artifact. Download to ignored `cache/architecture-tools/`; hash-check all artifacts before use. Expand the Java archive under `cache/architecture-tools/java21/`, retaining the archive.
2. Use PowerShell with the PowerShell.MCP text cmdlets available. Parse and run PSScriptAnalyzer at Warning/Error on `Render-Architecture.ps1`. On this host, run the analyzer in a child `pwsh -NoProfile -NonInteractive` through PowerShell.MCP because in-process analysis disrupted its transport.
3. Run `./docs/architecture/structurizr/Render-Architecture.ps1 -WhatIf`, then run it without `-WhatIf`. It verifies JAR hashes, records tool versions, renders local code SVGs, runs `validate`, exports static/JSON/PlantUML, renders native exports with local Smetana layout, checks traceability references and required views, and records command outcomes and artifact hashes.
4. Inspect rendered labels, relationships, legends, baseline/target distinction and site navigation. Automatic XML/DSL checks cannot replace visual inspection.

Tool documentation: [Structurizr validate](https://docs.structurizr.com/validate), [static export](https://docs.structurizr.com/export/static-site), [image views](https://docs.structurizr.com/dsl/cookbook/image-view/). All diagram rendering is local. Generated artifacts are reproducible with retained tool and source pins; timestamps/absolute receipt paths vary by run.

## Acceptance boundary

FR-FRENEMY-113, TR-FRENEMY-ARCH-117 and TEST-FRENEMY-113 cover completeness, source accuracy, change traceability, local reproducibility and the pre-TDD gate. Independent **Claude Opus 5.5 high** must return **AGREE, accuracy >=98%, completeness >=98%, no unresolved applicable FAIL or UNKNOWN**. Full request/response streams and verdict/readback receipts are required. Architecture acceptance does not satisfy production ACs. Phase 3 begins product TDD only after acceptance.
