# PLAN-FRENEMY-001: Grok and Cline in the existing Frenemy server

Scope is limited to Grok Build and Cline CLI support in the existing Frenemy server.

Add `ask_grok`, `ask_grok_write`, `ask_cline` and `ask_cline_write` to the existing stdio MCP relay. Each takes the same prompt input, uses the server startup directory, and returns one text answer or error. Use native CLI invocation and access controls. Preserve the existing Claude tools, Codex delegation instructions, concurrency, timeout, output and sanitization behavior.

Scope excludes workstation and workspace configuration, plugin inventories or policy, managed client registration or instructions, new setup or installer work, and new runtime services. Test Windows and Linux on suitable generic test hosts with the native CLIs available.

1. Define the [binding](../contracts/grok-cline-support.md) and [test cases](../testing/grok-cline-test-design.md). FR-FRENEMY-114 covers the new tools and native calls. FR-FRENEMY-115 covers compatibility and host validation. TR-FRENEMY-ADAPTER-118 and TEST-FRENEMY-114/115 trace those behaviors.
2. Review the [baseline and target C4 model](../architecture/structurizr/support-only/README.md). FR-FRENEMY-113, TR-FRENEMY-ARCH-117 and TEST-FRENEMY-113 cover source accuracy, change traceability and reproducible rendering. Accept architecture before executable TDD.
3. Prove the relay assertions with independent mocks and negative controls. Check the selected native interfaces and access controls in the test hosts after the mock gate. Implement the new dispatch entries and native invocations in the current server. Bind the same assertions to production.
4. Run the full planned Windows/Linux relay and compatibility checks, retain original reports and TRX, and update server usage documentation.

Use PowerShell and Nuke to run the validation. Claude Opus 5.5 high independently reviews plan/architecture before TDD and the release evidence after implementation. Acceptance requires AGREE, both scores at least 98%, and zero applicable FAIL or UNKNOWN. Provide the chat and pinned artifacts with the request. The reviewer must assess the current server and these two bindings, using prior verdicts as history. Operator workstation setup, plugins and workflow infrastructure have no acceptance criteria in this review.

The plan and C4 architecture passed independent review on November 5, 2026. Executable TDD, native qualification, implementation and release validation are pending. See the [validation status](../testing/validation.md).
