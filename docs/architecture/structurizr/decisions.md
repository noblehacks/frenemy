# Architecture decisions

All target decisions below describe DESIGN. Acceptance requires the separate Phase 2 review receipt; this document does not mark them implemented.

## ADR-001: separate immutable baseline from target

Use baseline.* and target.* DSL identifiers in one workspace. Pin baseline source to c7338ad39b646e695e7c4b5fbd998d45be914c02. External agent/provider systems are shared context boundaries. The namespace prevents target capabilities being presented as shipped behavior. Same responsibility names (relay/bridge, settings, repo, installers, launch/process) are explicitly compared in the change ledger. Derived higher-level relationships inherit the originating component relationship's change classification.

Consequence: baseline and target diagrams are browsable separately; the target is not a deployment claim. Existing macOS and image-helper code is documented but not rewritten. FR113/TR-ARCH-117/TEST113 govern this documentation phase.

## ADR-002: bridge plus durable per-user service

Replace the connection-owned blocking relay with a thin stdio bridge and independent local job service. Use Windows named pipe/Linux Unix socket restricted to the OS user. Preserve jobs beyond caller disconnect; no remote execution boundary is added. FR102/103/105, TR-ARCH-101/API-102/STORE-109.

Consequence: installation must manage both registration and service lifecycle; protocol version, trusted identity and request idempotency become contracts. Four-active-job scheduling applies to the approved per-user host deployment, not an unimplemented global cross-user service.

## ADR-003: fail-closed adapter permissions and owned processes

Keep launch/parsing specifics in four adapters. The runtime owns process-tree cancellation, explicit executable/argv, policy checks and configured workspace binding. Unsupported permissions or native executable layouts fail explicitly. Read mode never escalates through continuation. External CLI authentication and internal implementation remain external. FR101/104/106/108/109, TR-ADAPTER-103/104, SEC-105/107, EXEC-111, SCHED-106.

Consequence: capability absence may reject a requested route rather than falsely claim safe execution. Phase 4 must prove each selected version/platform; the diagram itself proves none of these controls.

## ADR-004: ordered local job evidence

Persist acceptance before launch, retain complete redacted streams and identify each attempt/event. Recovery marks interruption and requires explicit exact-session continuation. Keep complete job output available through local event retrieval. FR102/103/105/110, TR-STORE-109/AUDIT-110/REVIEW-112.

Consequence: storage failures must surface explicitly. No transcript-size or ordinary job-duration cap remains. An infrastructure failure alone does not manufacture DISAGREE.

## ADR-005: surgical configuration migration and rollback

PowerShell performs selected-client capability discovery, WhatIf, retained copy/hash backups, owned-entry merge and conflict-aware rollback. Preserve unrelated settings and later edits. Remove automatic write/escalation approval. FR111/TR-INSTALL-114/API-102/SEC-105.

Consequence: whole-file overwrite rollback is forbidden; migration must retain its owned-field journal. Existing Linux installer responsibility moves to PowerShell; macOS integration work stays excluded.

## ADR-006: native C4 plus local code image views

Native Structurizr context/container/component/deployment/dynamic views remain canonical. PlantUML renders local SVGs embedded as code-level image views. Tools are pinned by version and SHA256. Static export omits Structurizr documentation/ADRs, so this README and linked Markdown remain the navigation root alongside the exported site. FR113/TR-ARCH-117/TEST113.

Consequence: regeneration requires the pinned local Java/Structurizr/PlantUML artifacts; no diagram is sent to a public rendering service. Rendering/layout verification is an architecture gate, not product TDD or production AC evidence.

## ADR-007: remove excluded product integrations

Operator correction on 2026-11-04 removes agent-specific audit plugins, QBrain delivery and Git/worktree orchestration from Frenemy. Development-time requirement tracking and independent review remain external processes. Write jobs use the configured caller workspace. Local events and CLI-owned authentication remain in scope. Consequence: no audit delivery state, delivery outbox, base-revision input, worktree manager or Git diff contract is part of this release. The prior draft is retained only in the scope-history archive.
