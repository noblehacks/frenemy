/**
 * @file Immutable assertions shared by the Phase 3 mock and production providers.
 * @change 2026-11-06 FR-FRENEMY-114, FR-FRENEMY-115, TEST-FRENEMY-114,
 * TEST-FRENEMY-115: Added R01-R06 and Q01/Q02 contract assertions before product code.
 * @change 2026-11-06 FR-FRENEMY-114, TEST-FRENEMY-114,
 * AC-FRENEMY-114-03: Added explicit Grok Edit and Write permission rules proven
 * necessary by native headless qualification.
 * @change 2026-11-06 FR-FRENEMY-116, TR-FRENEMY-CONFIG-120,
 * TEST-FRENEMY-116, AC-FRENEMY-116-01 through AC-FRENEMY-116-05,
 * AC-TR-FRENEMY-CONFIG-120-01 through AC-TR-FRENEMY-CONFIG-120-04:
 * Added the R07 execution-selector and configuration contract before production code.
 */
import assert from "node:assert/strict";

export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const GROK_CANONICAL_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
export const CLINE_EFFORTS = ["none", "low", "medium", "high", "xhigh"];
export const GROK_EFFORT_PATTERN = "^(?:none|minimal|low|medium|high|xhigh|max|[A-Za-z0-9][A-Za-z0-9._:-]*)$";

const nonemptySelector = (description) => ({ type: "string", minLength: 1, description });
const effortSelector = (values, description) => ({ type: "string", enum: values, description });

const CLAUDE_SCHEMA = (description) => ({
  type: "object",
  properties: {
    prompt: { type: "string", description },
    model: nonemptySelector("Optional Claude model ID. Overrides the configured Claude default."),
    effort: effortSelector(CLAUDE_EFFORTS, "Optional Claude reasoning effort. Overrides the configured Claude default."),
  },
  required: ["prompt"],
  additionalProperties: false,
});

const GROK_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "A complete, self-contained instruction for the selected agent." },
    model: nonemptySelector("Optional Grok model ID. Overrides the configured Grok default."),
    effort: {
      type: "string",
      minLength: 1,
      pattern: GROK_EFFORT_PATTERN,
      description: "Optional Grok reasoning effort or documented model-menu identifier. Overrides the configured Grok default.",
    },
  },
  required: ["prompt"],
  additionalProperties: false,
};

const CLINE_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "A complete, self-contained instruction for the selected agent." },
    provider: nonemptySelector("Optional Cline provider ID. Overrides the configured Cline default."),
    model: nonemptySelector("Optional Cline model ID. Overrides the configured Cline default."),
    effort: effortSelector(CLINE_EFFORTS, "Optional Cline thinking effort. Overrides the configured Cline default."),
  },
  required: ["prompt"],
  additionalProperties: false,
};

/** Exact public tool descriptors required by R01 and R06. */
export const EXPECTED_TOOLS = [
  {
    name: "ask_claude",
    description:
      "Ask Claude Code a question about this repo and return its answer. File-editing tools and the shell are disabled for this call. Use for code review, second opinions, and explanations. Claude sees the repo on disk, so refer to files by path. Send one self-contained instruction. Claude has no memory of your conversation.",
    inputSchema: CLAUDE_SCHEMA("A complete, self-contained instruction for Claude."),
  },
  {
    name: "ask_claude_write",
    description:
      "Ask Claude Code to make changes in this repo (refactors, fixes, new code). Claude MAY edit files. Claude sees the repo on disk, so refer to files by path. Send one self-contained instruction. Claude has no memory of your conversation.",
    inputSchema: CLAUDE_SCHEMA("A complete, self-contained instruction for Claude."),
  },
  { name: "ask_grok", description: "Ask Grok Build a question about the current workspace. File edits are disabled.", inputSchema: GROK_SCHEMA },
  { name: "ask_grok_write", description: "Ask Grok Build to make changes. This call may edit files.", inputSchema: GROK_SCHEMA },
  { name: "ask_cline", description: "Ask Cline CLI a question about the current workspace. File edits are disabled.", inputSchema: CLINE_SCHEMA },
  { name: "ask_cline_write", description: "Ask Cline CLI to make changes. This call may edit files.", inputSchema: CLINE_SCHEMA },
];

const GROK_COMMON = ["--no-auto-update", "--verbatim", "--prompt-file", "<prompt>", "--output-format", "json"];
const GROK_DENY = ["--deny", "Bash", "--deny", "MCPTool", "--deny", "WebFetch", "--deny", "WebSearch", "--disable-web-search"];

/** Returns the exact Grok argument contract for a platform and mode. */
export function expectedGrokArgs(write, platform = "win32") {
  const mode = write
    ? ["--permission-mode", "acceptEdits", "--tools", "read_file,grep,list_dir,Edit,Write", "--allow", "Edit", "--allow", "Write"]
    : ["--permission-mode", "dontAsk", "--tools", "read_file,grep,list_dir", "--deny", "Edit", "--deny", "Write"];
  return [...GROK_COMMON, ...mode, ...GROK_DENY, ...(platform === "linux" && !write ? ["--sandbox", "read-only"] : [])];
}

/** Neutral version-controlled configuration required by TR-FRENEMY-CONFIG-120. */
export const EXPECTED_NEUTRAL_CONFIG = {
  $schema: "./frenemy.config.schema.json",
  version: 1,
  agents: { claude: {}, grok: {}, cline: {} },
};

/** Exact selector argv pairs required by AC-FRENEMY-116-03. */
export function expectedSelectorArgs(agent, selectors) {
  const flags = agent === "claude"
    ? { model: "--model", effort: "--effort" }
    : agent === "grok"
      ? { model: "--model", effort: "--reasoning-effort" }
      : { effort: "--thinking" };
  return Object.entries(flags).flatMap(([name, flag]) => selectors[name] === undefined ? [] : [flag, selectors[name]]);
}

/** Child-only ACP environment selectors required by AC-FRENEMY-116-03. */
export function expectedClineEnvironment(selectors) {
  return {
    CLINE_PROVIDER: selectors.provider,
    CLINE_MODEL: selectors.model,
  };
}

/**
 * Asserts one immutable contract case.
 * @param {string} caseId R01-R07, Q01, or Q02.
 * @param {object} actual Provider observation.
 * @param {object} context Platform and executable expectations.
 * @returns {void}
 * @throws {assert.AssertionError} When an observation violates the contract.
 */
export function assertContractCase(caseId, actual, context) {
  switch (caseId) {
    case "R01":
      assert.deepStrictEqual(actual.tools, EXPECTED_TOOLS);
      assert.deepStrictEqual(actual.dispatch, [
        ["ask_grok", "grok", false], ["ask_grok_write", "grok", true],
        ["ask_cline", "cline", false], ["ask_cline_write", "cline", true],
      ]);
      assert.equal(actual.invalidPrompts.length, 16);
      for (const item of actual.invalidPrompts) {
        assert.equal(item.error, `${item.tool}: invalid prompt`);
        assert.equal(item.spawnCount, 0);
      }
      break;
    case "R02":
      assert.deepStrictEqual(actual.grok, { command: context.grokExecutable, cwd: context.cwd, shell: false, args: expectedGrokArgs(false, context.platform) });
      assert.deepStrictEqual(actual.cline, { command: context.clineExecutable, cwd: context.cwd, shell: false, args: ["--acp", "--auto-approve", "false", "--cwd", context.cwd] });
      assert.equal(actual.overrideWins, true);
      assert.deepStrictEqual(actual.missingErrors, ["ask_grok: executable unavailable", "ask_cline: executable unavailable"]);
      assert.deepStrictEqual(actual.unsupportedPreflight, { error: "ask_grok: unsupported platform", discoveries: 0, spawns: 0, promptPreparations: 0 });
      assert.deepStrictEqual(actual.discovery, [
        ["win-valid-override", context.grokExecutable, 0, true],
        ["win-invalid-extension", null, 0, false],
        ["win-invalid-regular-file", null, 0, false],
        ["linux-valid-override", "/fixture/bin/grok", 0, true],
        ["linux-nonexecutable", null, 0, false],
        ["linux-shebang", "/fixture/bin/cline", 0, true],
        ["win-path", context.grokExecutable, 1, true],
        ["linux-path", "/fixture/bin/cline", 1, true],
      ]);
      assert.equal(actual.claudeStillCallable, true);
      break;
    case "R03":
      assert.deepStrictEqual(actual.readArgs, expectedGrokArgs(false, context.platform));
      assert.deepStrictEqual(actual.writeArgs, expectedGrokArgs(true, context.platform));
      assert.deepStrictEqual(actual.prompt, { text: context.prompt, utf8: true, bom: false, inArgv: false, protectedBeforeWrite: true, order: ["protect", "write", "spawn", "cleanup"] });
      assert.deepStrictEqual(actual.results, {
        end_turn: [true, "answer"], refusal: [true, "refused"], native_error: [false, "native failure"],
        nonzero: [false, "native failure"], invalid_json: [false, "invalid output"], unknown_stop: [false, "invalid output"],
        empty_text: [false, "invalid output"], max_tokens: [false, "incomplete output"],
        max_turn_requests: [false, "incomplete output"], cancelled: [false, "incomplete output"],
      });
      assert.deepStrictEqual(actual.blockedBeforeLaunch, {
        protectionFailure: { writes: 0, spawns: 0 },
        missingPowerShell: { writes: 0, spawns: 0 },
      });
      assert.deepStrictEqual(actual.cleanup, { success: true, caughtFailure: true, residueReported: true, residuePath: "C:/fixture/tmp/frenemy-owned" });
      break;
    case "R04":
      assert.deepStrictEqual(actual.args, ["--acp", "--auto-approve", "false", "--cwd", context.cwd]);
      assert.deepStrictEqual(actual.initialize, { protocolVersion: 1, clientCapabilities: {} });
      assert.deepStrictEqual(actual.newSession, { cwd: context.cwd, mcpServers: [] });
      assert.deepStrictEqual(actual.prompt, { sessionId: "session-1", prompt: [{ type: "text", text: context.prompt }] });
      assert.deepStrictEqual(actual.answerChunks, ["one", " two", " three"]);
      assert.deepStrictEqual(actual.allowed, ["Read", "Glob", "Grep", "read_files", "search_codebase", "Edit", "Write", "editor", "apply_patch"]);
      assert.deepStrictEqual(actual.denied, ["Bash", "run_commands", "WebFetch", "fetch_web_content", "WebSearch", "web_search", "Agent", "spawn_agent", "MCPTool", "Delete", "Move", "unknown"]);
      assert.deepStrictEqual(actual.options, { allow: "allow-once-id", reject: "reject-once-id", missingRequired: "cancel" });
      assert.deepStrictEqual(actual.permissionForms, {
        readAllowed: ["Read:object", "Glob:object", "Grep:object", "read_files:string", "read_files:array", "read_files:object", "search_codebase:string", "search_codebase:array", "search_codebase:object"],
        writeAllowed: ["Edit:object", "Write:object", "editor:null-old-text", "editor:string-old-text", "editor:integer-line", "editor:string-line", "apply_patch:string", "apply_patch:object"],
        denied: ["read-edit", "read-apply_patch", "shell", "web", "delegation", "mcp", "delete", "move", "unknown", "null-input", "wrong-kind", "wrong-session", "malformed", "missing-reject-option", "missing-allow-option"],
        exactOfferedIds: true,
      });
      assert.deepStrictEqual(actual.messageFiltering, { orderedAnswer: "one two three", ignoredThoughts: 1, ignoredTools: 1, ignoredOtherSessions: 1 });
      assert.deepStrictEqual(actual.terminal, { stopReason: "end_turn", answer: "one two three", replies: 1, closes: 1, releases: 1 });
      assert.deepStrictEqual(actual.failures, ["initialize-error", "new-session-error", "authRequired", "prompt-error", "mismatched-id", "empty-answer", "unknown-stop", "max_tokens", "max_turn_requests", "refusal", "cancelled"]);
      assert.equal(actual.methodNotFound, -32601);
      break;
    case "R05":
      assert.deepStrictEqual(actual.capacity, { limit: 4, mixedActive: 4, fifthRejected: true, fifthSpawns: 0 });
      assert.deepStrictEqual(actual.streams, { stdoutAtLimit: "accepted", stdoutOver: "overflow", stderrAtLimit: "accepted", stderrOver: "overflow", manySmallAcp: "overflow", finalAnswerAtLimit: "accepted", finalAnswerOver: "overflow" });
      assert.deepStrictEqual(actual.lifecycle, { timeoutKills: 1, overflowKills: 1, lateEventsIgnored: true, terminalReplies: 1, slotReleases: 1 });
      assert.deepStrictEqual(actual.errors, ["spawn", "nonzero", "malformed", "timeout", "stdout-overflow", "stderr-overflow"]);
      break;
    case "R07": {
      const claudeSelectors = { model: "caller-claude", effort: "xhigh" };
      const grokSelectors = { model: "config-grok", effort: "medium" };
      const clineSelectors = { provider: "openai-codex", model: "caller-cline", effort: "high" };
      assert.deepStrictEqual(actual.config, {
        defaultPath: context.configPath,
        explicitPath: context.explicitConfigPath,
        missingDefault: "empty",
        readsAtStartup: 1,
        neutral: EXPECTED_NEUTRAL_CONFIG,
      });
      assert.deepStrictEqual(actual.schema, {
        draft: "https://json-schema.org/draft/2020-12/schema",
        strictObjects: ["root", "agents", "claude", "grok", "cline"],
        fields: {
          claude: ["model", "effort"],
          grok: ["model", "effort"],
          cline: ["provider", "model", "effort"],
        },
        efforts: {
          claude: CLAUDE_EFFORTS,
          grokCanonical: GROK_CANONICAL_EFFORTS,
          grokPattern: GROK_EFFORT_PATTERN,
          cline: CLINE_EFFORTS,
        },
        selectorStringsRequireNonempty: true,
      });
      assert.deepStrictEqual(actual.precedence, {
        claude: claudeSelectors,
        grok: grokSelectors,
        cline: clineSelectors,
        nativeDefaults: { claude: {}, grok: {}, cline: {} },
        crossAgentLeak: false,
      });
      assert.deepStrictEqual(actual.argv, {
        claude: ["-p", "--output-format", "json", ...expectedSelectorArgs("claude", claudeSelectors)],
        grok: [...expectedGrokArgs(false, context.platform), ...expectedSelectorArgs("grok", grokSelectors)],
        cline: ["--acp", "--auto-approve", "false", "--cwd", context.cwd, ...expectedSelectorArgs("cline", clineSelectors)],
        shell: false,
      });
      assert.deepStrictEqual(actual.clineEnvironment, expectedClineEnvironment(clineSelectors));
      assert.equal(actual.parentEnvironmentUnchanged, true);
      assert.deepStrictEqual(actual.compatibility, {
        claude: ["-p", "--output-format", "json"],
        grok: expectedGrokArgs(false, context.platform),
        cline: ["--acp", "--auto-approve", "false", "--cwd", context.cwd],
      });
      assert.equal(actual.invalidSelectors.length, 34);
      for (const item of actual.invalidSelectors) {
        assert.equal(item.error, `${item.tool}: invalid ${item.selector}`);
        assert.equal(item.discoveries, 0);
        assert.equal(item.spawns, 0);
      }
      assert.deepStrictEqual(actual.invalidConfigs, [
        ["missing-explicit", "Frenemy config: file unavailable", 0],
        ["unreadable", "Frenemy config: file unreadable", 0],
        ["malformed-json", "Frenemy config: invalid JSON", 0],
        ["unknown-root-property", "Frenemy config: invalid property", 0],
        ["unknown-agent-property", "Frenemy config: invalid property", 0],
        ["invalid-selector", "Frenemy config: invalid selector", 0],
        ["credential-property", "Frenemy config: invalid property", 0],
      ]);
      assert.deepStrictEqual(actual.nativeRejection, {
        error: "ask_cline: native failure",
        fallbacks: 0,
        configMutations: 0,
        profileMutations: 0,
      });
      break;
    }
    case "R06":
      assert.deepStrictEqual(actual.tools, EXPECTED_TOOLS.slice(0, 2));
      assert.deepStrictEqual(actual.readArgs, ["-p", "--output-format", "json", "--safe-mode", "--disallowedTools", "Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "--strict-mcp-config"]);
      assert.deepStrictEqual(actual.writeArgs, ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--setting-sources", "user"]);
      assert.deepStrictEqual(actual.pins, context.pins);
      assert.equal(actual.sanitizerPreserved, true);
      assert.deepStrictEqual(actual.claudeBehavior, { missingPromptCoerced: "", nonstringPromptCoerced: "[object Object]", unknownToolPreserved: true, framingPreserved: true, errorEnvelopePreserved: true });
      assert.deepStrictEqual(actual.unchangedFiles, ["install.ps1", "install.sh", "CLAUDE-codex-section.md", "genimg.sh"]);
      break;
    case "Q01":
      assert.deepStrictEqual(actual, { provider: "test-side-native", modes: ["read", "write"], readRefused: true, readSentinelUnchanged: true, writeBytes: "grok-write\n", stopReason: "end_turn", marker: context.marker, answerIncludesMarker: true, promptProtected: true, cleanup: true });
      break;
    case "Q02":
      assert.deepStrictEqual(actual, { provider: "test-side-native", modes: ["read", "write"], selectedProvider: "openai-codex", selectedModel: "gpt-5.6-luna", selectedEffort: "high", observedProvider: "openai-codex", observedModel: "gpt-5.6-luna", readRejected: true, readSentinelUnchanged: true, editorBytes: "cline-editor\n", patchBytes: "cline-patch\n", stopReason: "end_turn", marker: context.marker, answerIncludesMarker: true, offeredOptionsEchoed: true });
      break;
    default:
      throw new Error(`Unknown contract case: ${caseId}`);
  }
}

/** Deep-clones an observation for negative-control mutation. */
export function cloneObservation(value) {
  return structuredClone(value);
}
