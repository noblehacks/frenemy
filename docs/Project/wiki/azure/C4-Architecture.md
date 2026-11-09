# Frenemy C4 architecture

Frenemy's only planned product additions are Grok Build and Cline CLI support in the existing blocking relay. Existing Claude/Codex behavior is preserved. There is no planned shared job service or product integration with QBrain, audit plugins, or Git orchestration.

- [Current C4 workspace](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/support-only/README.md)
- [Current model](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/support-only/workspace.dsl)
- [Baseline source evidence](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/source-evidence.md)
- [Current integration plan](https://github.com/sharpninja/frenemy/blob/main/docs/plans/grok-cline-integration.md)
- [Validation scope](https://github.com/sharpninja/frenemy/blob/main/docs/testing/validation.md)

The baseline is pinned to `c7338ad39b646e695e7c4b5fbd998d45be914c02`. The current model contains only the existing relay plus the approved Grok Build and Cline CLI additions. The withdrawn job-service design is not part of the model or requirements.
