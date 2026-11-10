# PLAN-FRENEMY-001: Grok and Cline in the existing Frenemy server

Scope authority, 2026-11-05: “Literally, the only thing in scope is supporting grok and cline in the __current frenemy server__.”

Add `ask_grok`, `ask_grok_write`, `ask_cline` and `ask_cline_write` to the existing stdio MCP relay. Each takes the same prompt input, uses the server startup directory, and returns one text answer or error. Use native CLI invocation and access controls. Preserve the existing Claude tools, Codex delegation instructions, concurrency, timeout, output and sanitization behavior.

Scope excludes workstation and workspace configuration, plugin inventories or policy, managed client registration or instructions, new setup or installer work, and new runtime services. Test Windows and Linux on suitable generic test hosts with the native CLIs available. The operator's installed software and settings are outside the validation denominator.

Scope amendment, 2026-11-06: product-owned selection of provider, model, and effort is part of supporting the existing Claude, Grok, and Cline tools. `FR-FRENEMY-116`, `TR-FRENEMY-CONFIG-120`, and `TEST-FRENEMY-116` add caller selectors and a versioned Frenemy JSON configuration with a JSON Schema. This does not bring the operator's workstation settings, agent plugins, authentication material, installers, or any new service into scope.

1. **Phase 1, complete:** Define the [binding](https://github.com/sharpninja/frenemy/blob/main/docs/contracts/grok-cline-support.md), [test cases](https://github.com/sharpninja/frenemy/blob/main/docs/testing/grok-cline-test-design.md), and [current use cases](https://github.com/sharpninja/frenemy/blob/main/docs/requirements/grok-cline-use-cases.md). FR-FRENEMY-114 covers the new tools and native calls. FR-FRENEMY-115 covers compatibility and host validation. TR-FRENEMY-ADAPTER-118 and TEST-FRENEMY-114/115 trace those behaviors.
2. **Phase 2, complete:** Review the [baseline and target C4 model](https://github.com/sharpninja/frenemy/blob/main/docs/architecture/structurizr/support-only/README.md). FR-FRENEMY-113, TR-FRENEMY-ARCH-117 and TEST-FRENEMY-113 cover source accuracy, change traceability and reproducible rendering. Accept architecture before executable TDD.
3. **Phase 3, complete:** The independent mock gate, production-binding suite, selector gates, native qualifications, and final-head Windows gate are green. Product-native Grok Q01 is green on Windows and Linux. Product-native Cline Q02 is green on Windows through the product MCP entry point.
4. **Phase 4, complete:** The planned Windows and Linux `Validate` lanes are green, original reports and TRX are retained, and server usage documentation is current. Windows passed 191 of 191 selected cases. Linux passed 188 of 188 selected cases. Both lanes have 0 failures and 0 skips.

Use PowerShell and Nuke to run executable validation. The operator-directed Phase 1 and Phase 2 completion pass uses implementer self-evaluation, not a new hostile validation. Its acceptance requires AGREE, both scores at least 98%, and zero applicable FAIL or UNKNOWN. The November 5 independent review remains historical architecture evidence. Phase 4 retains independent review of release evidence after implementation unless the operator changes that gate. Any review receives the chat and pinned artifacts and assesses only the current server and these two bindings. Operator workstation setup, plugins and workflow infrastructure have no acceptance criteria in this plan.

Phases 1 through 4 are complete. The release evidence is retained under `docs/receipts/release/`, and the current product and test status is summarized in `docs/testing/validation.md`. Hostile-validation evidence is intentionally excluded from this pull request.

## Phase 3 amendment: configurable execution selectors

Status: completed on 2026-11-06. Requirements and traceability are recorded. The BDPv4 sequence below was executed without expanding the file or product boundary.

### Locked behavior

- Keep the six existing tool names and their read/write distinction.
- Add optional `model` and `effort` inputs to both Claude tools and both Grok tools.
- Add optional `provider`, `model`, and `effort` inputs to both Cline tools.
- Resolve each selector independently in this order: caller value, then that agent's configured default, then omission of the native flag so the CLI retains its native default. Never inherit across agents.
- Map Claude to discrete `--model` and `--effort` argv entries. Claude effort values are `low`, `medium`, `high`, `xhigh`, and `max`.
- Map Grok to discrete `--model` and `--reasoning-effort` argv entries. Grok accepts canonical `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` values plus documented model-specific menu identifiers.
- Map Cline ACP provider and model to child-only `CLINE_PROVIDER` and `CLINE_MODEL` environment values, and effort to a discrete `--thinking` argv entry. Cline effort values are `none`, `low`, `medium`, `high`, and `xhigh`. Never mutate the parent environment.
- Validate types, empty values, effort domains, configuration structure, and unknown properties before launching an agent. Pass nonempty provider and model identifiers to the native CLI for authoritative catalog validation, and surface native rejection without fallback.
- Never construct a shell command from selector values. Never store or accept API keys, OAuth tokens, account identifiers, or other credentials in Frenemy configuration.
- Preserve current behavior when all selectors are omitted, including permission controls, executable discovery, prompt transport, capacity, deadline, output limits, framing, sanitization, and error envelopes.

### Configuration contract

- Add `frenemy.config.json` and `frenemy.config.schema.json` beside `ask-claude-mcp.mjs`.
- Use JSON Schema draft 2020-12 and set `additionalProperties` to `false` for every Frenemy-owned object.
- Use this versioned shape: `version: 1`, then `agents.claude`, `agents.grok`, and `agents.cline`. Claude and Grok expose optional `model` and `effort`; Cline exposes optional `provider`, `model`, and `effort`.
- Ship neutral empty agent objects rather than an operator-specific provider or model. Native qualification supplies `openai-codex`, `gpt-5.6-luna`, and a supported effort through the MCP call.
- Resolve the default file from the relay module directory. Add `--config <absolute-path>` for isolated tests and deployments. A missing default file behaves as empty configuration for upgrade compatibility; a missing explicit file is an error.
- Read and validate configuration once at startup. Malformed JSON, invalid values, unknown fields, unreadable explicit files, and unsupported schema versions fail with credential-free diagnostics before any target process launches.
- Do not change either installer. Existing installers reference the relay in its repository directory, so the adjacent default configuration remains discoverable without installer behavior changes.

### BDPv4 implementation sequence

1. Update the requirement-backed contract and test design with `FR-FRENEMY-116`, `TR-FRENEMY-CONFIG-120`, `TEST-FRENEMY-116`, their acceptance criteria, and the selector precedence above.
2. Extend the independent contract fixture and `RelayContractMockTests` first. Cover all tool schemas, per-agent selector domains, caller/config/native precedence, exact argv ordering, neutral omission, invalid configuration, invalid inputs, cross-agent isolation, native rejection without fallback, and preservation of existing permissions and limits.
3. Add deliberate negative mutations for every assertion. Run only `Frenemy.Relay.UnitTests:RelayContractMockTests` through Nuke `TestGroups`. The correct fixture and every rejection control must be green before product edits.
4. Add the two JSON files and implement configuration loading, validation, selector resolution, tool schema changes, and agent-specific native process-input mapping in `ask-claude-mcp.mjs`. Do not add dependencies, services, installers, plugins, or C# product code.
5. Bind the same cases and assertions through the MCP entry point in `RelayContractIntegrationTests`. Run only `Frenemy.Relay.IntegrationTests:RelayContractIntegrationTests` through Nuke `TestGroups` until green.
6. Extend Q02 to submit `provider: openai-codex`, `model: gpt-5.6-luna`, and `effort: high`. Require observed Cline session identity to match, then retain all existing answer, permission, sentinel, editor, apply-patch, and slash-prompt assertions. Run only `Frenemy.Relay.NativeQualification:NativeProductionQualificationTestsQ02` through Nuke `TestGroups` on Windows and Linux.
7. Update the binding contract, test design, use cases, README usage examples, validation status, C4 target/code views, and requirement navigation only where this amendment changes the current relay.
8. Run the full Phase 3 gate once at the final head. Preserve original JUnit/TRX, host, command, version, hash, and observed provider/model/effort receipts. Completed: the final gate passed and the independent review returned AGREE at 99% accuracy and 99% completeness with zero FAIL and zero UNKNOWN.

### File and compatibility boundary

Expected product files are `ask-claude-mcp.mjs`, `frenemy.config.json`, and `frenemy.config.schema.json`. Expected test files are the existing contract fixture, unit contract test, integration contract test, native qualification test, and their controlled provider fixture. Expected documentation files are the current binding, test design, use cases, plan, README, validation status, and directly affected architecture source. No other product, installer, workstation, plugin, or service file is authorized by this amendment.
