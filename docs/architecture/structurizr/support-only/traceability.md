# Traceability for the existing server extension

The [current plan](../../../plans/grok-cline-integration.md) governs the target.

- The four new tool entries and dispatch edges extend `TOOLS` and `handle`. FR-FRENEMY-114 AC01, FR-FRENEMY-115 AC01, TR-FRENEMY-ADAPTER-118, TEST-FRENEMY-114/115, R01. UC-SUPPORT-GROK and UC-SUPPORT-CLINE. Phase 3.
- Grok and Cline components invoke the external CLIs in the startup directory. Their result edges use the current error and sanitizer boundary. FR-FRENEMY-114 AC02–AC04, FR-FRENEMY-115 AC02/AC03, TR-FRENEMY-ADAPTER-118, TEST-FRENEMY-114/115, R02–R05. UC-SUPPORT-GROK and UC-SUPPORT-CLINE. Phase 3.
- Grok's temporary prompt and Windows ACL protection belong to the invocation. FR-FRENEMY-114 AC05, TR-FRENEMY-ADAPTER-118, TEST-FRENEMY-114, R03. UC-SUPPORT-GROK. Phase 3.
- Target Windows/Linux deployments and the two call flows trace to FR-FRENEMY-114 AC06, FR-FRENEMY-115 AC04/AC06, TR-FRENEMY-ADAPTER-118, TEST-FRENEMY-114/115, Q01/Q02. UC-SUPPORT-GROK and UC-SUPPORT-CLINE. Phase 3 qualification and Phase 4 release validation.
- Baseline source, all four C4 levels, legends and reproducible rendering trace to FR-FRENEMY-113 AC01–AC06, TR-FRENEMY-ARCH-117, TEST-FRENEMY-113, A01. UC-SUPPORT-ARCHITECTURE. Phase 2.
- Existing Claude invocations, server framing and limits, Codex instructions, installers and image helper are compatibility obligations. FR-FRENEMY-115 AC01/AC03/AC05, TR-FRENEMY-ADAPTER-118, TEST-FRENEMY-115, R01/R05/R06. Phase 3 and Phase 4.

The [case design](../../../testing/grok-cline-test-design.md) defines assertions and execution gates. TR-FRENEMY-INSTALL-119 and UC-SUPPORT-SETUP describe the superseded setup proposal.
