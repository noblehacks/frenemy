# Frenemy documentation

Frenemy currently delegates between Claude Code and Codex. The current design adds Grok Build and Cline CLI calls to the existing MCP server.

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
- [Phase 1 and Phase 2 self-evaluation](https://github.com/sharpninja/frenemy/blob/main/docs/receipts/self-eval/20261106T113443-phase1-phase2/final.md)
- [Requirement and TODO scope-correction record](https://github.com/sharpninja/frenemy/blob/main/docs/receipts/scope/20261105T134116-server-only-intent.json)
- [Use case scope-correction record](https://github.com/sharpninja/frenemy/blob/main/docs/receipts/scope/20261105T132148-server-only-usecases.json)

`PLAN-FRENEMY-001` is complete. Phase 1 and Phase 2 passed the operator-directed self-evaluation, Phase 3 passed its final implementation gate and independent review, and Phase 4 passed Windows/Linux release validation and independent review. `PLAN-FRENEMY-002` tracks the separate opt-in four-agent reasoning integration test. The [validation status](https://github.com/sharpninja/frenemy/blob/main/docs/testing/validation.md) distinguishes each evidence layer. The requirement and use-case intent files above preserve the scope correction. Earlier plans, diagrams and review receipts are historical.

QBrain's full requirements export includes deferred historical records. For the Grok and Cline integration, use the current plan and its requirement IDs to determine scope. The earlier job-service requirements FR-FRENEMY-101 through FR-FRENEMY-112 are deferred.
