# Frenemy C4 architecture

The baseline is pinned to c7338ad39b646e695e7c4b5fbd998d45be914c02. The target adds Grok Build and Cline CLI to Frenemy's delegation interface. Architecture acceptance remains pending; product TDD has not started.

The corrected scope excludes product audit-plugin/QBrain integration and Git/worktree orchestration. Write jobs use the configured caller workspace. Requirement tracking is an external development process.

- [Architecture workspace and reproduction instructions](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/README.md)
- [C4 model source](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/workspace.dsl)
- [Contracts](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/contracts.md)
- [Architecture decisions](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/decisions.md)
- [Baseline source evidence](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/source-evidence.md)
- [Approved integration plan](https://github.com/sharpninja/frenemy/blob/main/docs/plans/grok-cline-integration.md)

The workspace includes C4 context, container, component and code views; Windows/Linux deployment views; and submission, execution, permissions, cancellation, recovery and installer rollback flows. Follow the workspace README to browse the generated site locally. Links refer to the version-controlled paths and become available remotely when the changes are pushed.
