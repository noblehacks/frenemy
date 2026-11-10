# Frenemy documentation

Frenemy's current JavaScript relay exposes read and explicit-write delegation to Claude Code, Grok Build, and Cline CLI while retaining the separate Claude-to-Codex instruction path.

- [Setup and current usage](https://github.com/sharpninja/frenemy/blob/main/README.md)
- [Current integration plan](https://github.com/sharpninja/frenemy/blob/main/docs/plans/grok-cline-integration.md)
- [Four-agent reasoning integration test plan](https://github.com/sharpninja/frenemy/blob/main/docs/plans/four-agent-reasoning-integration.md)
- [Native CLI contract](https://github.com/sharpninja/frenemy/blob/main/docs/contracts/grok-cline-support.md)
- [Native CLI validation](https://github.com/sharpninja/frenemy/blob/main/docs/contracts/native-binding-qualification.md)
- [C4 baseline and target](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/support-only/README.md)
- [Current implementation and limits](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/overview.md)
- [Validation status](https://github.com/sharpninja/frenemy/blob/main/docs/testing/validation.md)
- [Grok and Cline test design](https://github.com/sharpninja/frenemy/blob/main/docs/testing/grok-cline-test-design.md)
- [Current Grok and Cline use cases](https://github.com/sharpninja/frenemy/blob/main/docs/requirements/grok-cline-use-cases.md)

`PLAN-FRENEMY-001` is complete. Phase 1 and Phase 2 passed the operator-directed self-evaluation, Phase 3 passed its final implementation gate and independent review, and Phase 4 passed Windows/Linux release validation and independent review. `PLAN-FRENEMY-002` tracks the separate opt-in four-agent reasoning integration test. The [validation status](https://github.com/sharpninja/frenemy/blob/main/docs/testing/validation.md) distinguishes each evidence layer. Earlier plans, diagrams and review receipts are historical.

The current requirements export covers the approved Grok/Cline relay support, its architecture, and the separate test-only integration. The withdrawn job-service requirements `FR-FRENEMY-101` through `FR-FRENEMY-112` are not part of the active scope.
