/**
 * @file Independent in-memory process, clock, and file providers for the BDPv4 mock gate.
 * @change 2026-11-06 TEST-FRENEMY-114 and TEST-FRENEMY-115: Added correct mocks
 * for R01-R06 and Q01/Q02 without importing production code or expected observations.
 * @change 2026-11-06 FR-FRENEMY-114, TEST-FRENEMY-114,
 * AC-FRENEMY-114-03: Modeled the explicit Grok Edit and Write allow rules that
 * native headless qualification proved are required.
 * @change 2026-11-06 FR-FRENEMY-116, TR-FRENEMY-CONFIG-120,
 * TEST-FRENEMY-116: Added an independent R07 fixture for selector schemas,
 * precedence, configuration validation, agent-specific process inputs, and
 * no-launch failures.
 */

const claudeEfforts = ["low", "medium", "high", "xhigh", "max"];
const grokEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const clineEfforts = ["none", "low", "medium", "high", "xhigh"];
const grokEffortPattern = "^(?:none|minimal|low|medium|high|xhigh|max|[A-Za-z0-9][A-Za-z0-9._:-]*)$";
const selector = (description) => ({ type: "string", minLength: 1, description });
const effort = (values, description) => ({ type: "string", enum: values, description });

const claudeSchema = (description) => ({
  type: "object",
  properties: {
    prompt: { type: "string", description },
    model: selector("Optional Claude model ID. Overrides the configured Claude default."),
    effort: effort(claudeEfforts, "Optional Claude reasoning effort. Overrides the configured Claude default."),
  },
  required: ["prompt"],
  additionalProperties: false,
});

const grokSchema = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "A complete, self-contained instruction for the selected agent." },
    model: selector("Optional Grok model ID. Overrides the configured Grok default."),
    effort: { type: "string", minLength: 1, pattern: grokEffortPattern, description: "Optional Grok reasoning effort or documented model-menu identifier. Overrides the configured Grok default." },
  },
  required: ["prompt"],
  additionalProperties: false,
};

const clineSchema = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "A complete, self-contained instruction for the selected agent." },
    provider: selector("Optional Cline provider ID. Overrides the configured Cline default."),
    model: selector("Optional Cline model ID. Overrides the configured Cline default."),
    effort: effort(clineEfforts, "Optional Cline thinking effort. Overrides the configured Cline default."),
  },
  required: ["prompt"],
  additionalProperties: false,
};

/** Records native process launches without touching the host. */
export class MemoryProcessProvider {
  constructor() { this.launches = []; }
  spawn(command, args, options) { this.launches.push({ command, args: [...args], ...options }); return this.launches.at(-1); }
}

/** Records prompt protection, writes, and cleanup entirely in memory. */
export class MemoryFileProvider {
  constructor() { this.events = []; this.bytes = new Map(); }
  protect(path) { this.events.push("protect"); this.bytes.set(path, null); }
  write(path, text) { this.events.push("write"); this.bytes.set(path, Buffer.from(text, "utf8")); }
  cleanup(path) { this.events.push("cleanup"); this.bytes.delete(path); }
}

/** Records deadline and late-event behavior without wall-clock waits. */
export class FakeClock {
  constructor() { this.kills = 0; this.lateEventsIgnored = true; }
  expire() { this.kills += 1; }
}

/** Simulates executable discovery rules without reading the host filesystem. */
export class MemoryExecutableProvider {
  constructor(context) {
    this.context = context;
    this.pathLookups = 0;
    this.files = new Map([
      [context.grokExecutable, { regular: true, executable: true }],
      [context.clineExecutable, { regular: true, executable: true }],
      ["C:/fixture/bin/grok.cmd", { regular: true, executable: true }],
      ["C:/fixture/bin/not-regular.exe", { regular: false, executable: true }],
      ["/fixture/bin/grok", { regular: true, executable: true }],
      ["/fixture/bin/nonexec", { regular: true, executable: false }],
      ["/fixture/bin/cline", { regular: true, executable: true, shebang: true }],
    ]);
  }

  discover(platform, tool, override, pathMatch) {
    this.pathLookups = 0;
    const validate = (candidate) => {
      const file = this.files.get(candidate);
      if (!file?.regular) return null;
      if (platform === "win32") return candidate.toLowerCase().endsWith(".exe") ? candidate : null;
      if (platform === "linux") return file.executable ? candidate : null;
      return null;
    };
    if (override) return validate(override);
    this.pathLookups += 1;
    return validate(pathMatch);
  }
}

/** Simulates the native-qualification provider before any host CLI is invoked. */
export class MockNativeQualificationProvider {
  constructor(context) { this.context = context; }
  grok() {
    return { provider: "test-side-native", modes: ["read", "write"], readRefused: true, readSentinelUnchanged: true, writeBytes: "grok-write\n", stopReason: "end_turn", marker: this.context.marker, answerIncludesMarker: true, promptProtected: true, cleanup: true };
  }
  cline() {
    return { provider: "test-side-native", modes: ["read", "write"], selectedProvider: "openai-codex", selectedModel: "gpt-5.6-luna", selectedEffort: "high", observedProvider: "openai-codex", observedModel: "gpt-5.6-luna", readRejected: true, readSentinelUnchanged: true, editorBytes: "cline-editor\n", patchBytes: "cline-patch\n", stopReason: "end_turn", marker: this.context.marker, answerIncludesMarker: true, offeredOptionsEchoed: true };
  }
}

/** Supplies independent correct observations to the shared assertions. */
export class MockRelayProvider {
  constructor(context) { this.context = context; }

  tools() {
    const common = "Claude sees the repo on disk, so refer to files by path. Send one self-contained instruction. Claude has no memory of your conversation.";
    return [
      { name: "ask_claude", description: `Ask Claude Code a question about this repo and return its answer. File-editing tools and the shell are disabled for this call. Use for code review, second opinions, and explanations. ${common}`, inputSchema: claudeSchema("A complete, self-contained instruction for Claude.") },
      { name: "ask_claude_write", description: `Ask Claude Code to make changes in this repo (refactors, fixes, new code). Claude MAY edit files. ${common}`, inputSchema: claudeSchema("A complete, self-contained instruction for Claude.") },
      { name: "ask_grok", description: "Ask Grok Build a question about the current workspace. File edits are disabled.", inputSchema: grokSchema },
      { name: "ask_grok_write", description: "Ask Grok Build to make changes. This call may edit files.", inputSchema: grokSchema },
      { name: "ask_cline", description: "Ask Cline CLI a question about the current workspace. File edits are disabled.", inputSchema: clineSchema },
      { name: "ask_cline_write", description: "Ask Cline CLI to make changes. This call may edit files.", inputSchema: clineSchema },
    ];
  }

  grokArgs(write) {
    const common = ["--no-auto-update", "--verbatim", "--prompt-file", "<prompt>", "--output-format", "json"];
    const mode = write
      ? ["--permission-mode", "acceptEdits", "--tools", "read_file,grep,list_dir,Edit,Write", "--allow", "Edit", "--allow", "Write"]
      : ["--permission-mode", "dontAsk", "--tools", "read_file,grep,list_dir", "--deny", "Edit", "--deny", "Write"];
    const denied = ["--deny", "Bash", "--deny", "MCPTool", "--deny", "WebFetch", "--deny", "WebSearch", "--disable-web-search"];
    return [...common, ...mode, ...denied, ...(this.context.platform === "linux" && !write ? ["--sandbox", "read-only"] : [])];
  }

  selectorArgs(agent, values) {
    const flags = agent === "claude"
      ? { model: "--model", effort: "--effort" }
      : agent === "grok"
        ? { model: "--model", effort: "--reasoning-effort" }
        : { effort: "--thinking" };
    return Object.entries(flags).flatMap(([name, flag]) => values[name] === undefined ? [] : [flag, values[name]]);
  }

  collect(caseId) {
    const { cwd, grokExecutable, clineExecutable, prompt, marker, pins } = this.context;
    switch (caseId) {
      case "R01": {
        const invalidPrompts = [];
        for (const tool of ["ask_grok", "ask_grok_write", "ask_cline", "ask_cline_write"])
          for (const input of ["missing", "nonstring", "empty", "whitespace"])
            invalidPrompts.push({ tool, input, error: `${tool}: invalid prompt`, spawnCount: 0 });
        return { tools: this.tools(), dispatch: [["ask_grok", "grok", false], ["ask_grok_write", "grok", true], ["ask_cline", "cline", false], ["ask_cline_write", "cline", true]], invalidPrompts };
      }
      case "R02": {
        const processProvider = new MemoryProcessProvider();
        const executables = new MemoryExecutableProvider(this.context);
        const grok = processProvider.spawn(grokExecutable, this.grokArgs(false), { cwd, shell: false });
        const cline = processProvider.spawn(clineExecutable, ["--acp", "--auto-approve", "false", "--cwd", cwd], { cwd, shell: false });
        const discoveryCase = (id, platform, tool, override, pathMatch) => {
          const selected = executables.discover(platform, tool, override, pathMatch);
          return [id, selected, executables.pathLookups, selected !== null];
        };
        const discovery = [
          discoveryCase("win-valid-override", "win32", "grok", grokExecutable, "C:/different/grok.exe"),
          discoveryCase("win-invalid-extension", "win32", "grok", "C:/fixture/bin/grok.cmd", grokExecutable),
          discoveryCase("win-invalid-regular-file", "win32", "grok", "C:/fixture/bin/not-regular.exe", grokExecutable),
          discoveryCase("linux-valid-override", "linux", "grok", "/fixture/bin/grok", "/different/grok"),
          discoveryCase("linux-nonexecutable", "linux", "grok", "/fixture/bin/nonexec", "/fixture/bin/grok"),
          discoveryCase("linux-shebang", "linux", "cline", "/fixture/bin/cline", "/different/cline"),
          discoveryCase("win-path", "win32", "grok", null, grokExecutable),
          discoveryCase("linux-path", "linux", "cline", null, "/fixture/bin/cline"),
        ];
        return { grok, cline, overrideWins: true, missingErrors: ["ask_grok: executable unavailable", "ask_cline: executable unavailable"], unsupportedPreflight: { error: "ask_grok: unsupported platform", discoveries: 0, spawns: 0, promptPreparations: 0 }, discovery, claudeStillCallable: true };
      }
      case "R03": {
        const files = new MemoryFileProvider();
        files.protect("prompt"); files.write("prompt", prompt); files.events.push("spawn"); files.cleanup("prompt");
        return { readArgs: this.grokArgs(false), writeArgs: this.grokArgs(true), prompt: { text: prompt, utf8: true, bom: false, inArgv: false, protectedBeforeWrite: true, order: files.events }, results: { end_turn: [true, "answer"], refusal: [true, "refused"], native_error: [false, "native failure"], nonzero: [false, "native failure"], invalid_json: [false, "invalid output"], unknown_stop: [false, "invalid output"], empty_text: [false, "invalid output"], max_tokens: [false, "incomplete output"], max_turn_requests: [false, "incomplete output"], cancelled: [false, "incomplete output"] }, blockedBeforeLaunch: { protectionFailure: { writes: 0, spawns: 0 }, missingPowerShell: { writes: 0, spawns: 0 } }, cleanup: { success: true, caughtFailure: true, residueReported: true, residuePath: "C:/fixture/tmp/frenemy-owned" } };
      }
      case "R04":
        return { args: ["--acp", "--auto-approve", "false", "--cwd", cwd], initialize: { protocolVersion: 1, clientCapabilities: {} }, newSession: { cwd, mcpServers: [] }, prompt: { sessionId: "session-1", prompt: [{ type: "text", text: prompt }] }, answerChunks: ["one", " two", " three"], allowed: ["Read", "Glob", "Grep", "read_files", "search_codebase", "Edit", "Write", "editor", "apply_patch"], denied: ["Bash", "run_commands", "WebFetch", "fetch_web_content", "WebSearch", "web_search", "Agent", "spawn_agent", "MCPTool", "Delete", "Move", "unknown"], options: { allow: "allow-once-id", reject: "reject-once-id", missingRequired: "cancel" }, permissionForms: { readAllowed: ["Read:object", "Glob:object", "Grep:object", "read_files:string", "read_files:array", "read_files:object", "search_codebase:string", "search_codebase:array", "search_codebase:object"], writeAllowed: ["Edit:object", "Write:object", "editor:null-old-text", "editor:string-old-text", "editor:integer-line", "editor:string-line", "apply_patch:string", "apply_patch:object"], denied: ["read-edit", "read-apply_patch", "shell", "web", "delegation", "mcp", "delete", "move", "unknown", "null-input", "wrong-kind", "wrong-session", "malformed", "missing-reject-option", "missing-allow-option"], exactOfferedIds: true }, messageFiltering: { orderedAnswer: "one two three", ignoredThoughts: 1, ignoredTools: 1, ignoredOtherSessions: 1 }, terminal: { stopReason: "end_turn", answer: "one two three", replies: 1, closes: 1, releases: 1 }, failures: ["initialize-error", "new-session-error", "authRequired", "prompt-error", "mismatched-id", "empty-answer", "unknown-stop", "max_tokens", "max_turn_requests", "refusal", "cancelled"], methodNotFound: -32601 };
      case "R05": {
        const clock = new FakeClock(); clock.expire();
        return { capacity: { limit: 4, mixedActive: 4, fifthRejected: true, fifthSpawns: 0 }, streams: { stdoutAtLimit: "accepted", stdoutOver: "overflow", stderrAtLimit: "accepted", stderrOver: "overflow", manySmallAcp: "overflow", finalAnswerAtLimit: "accepted", finalAnswerOver: "overflow" }, lifecycle: { timeoutKills: clock.kills, overflowKills: 1, lateEventsIgnored: clock.lateEventsIgnored, terminalReplies: 1, slotReleases: 1 }, errors: ["spawn", "nonzero", "malformed", "timeout", "stdout-overflow", "stderr-overflow"] };
      }
      case "R07": {
        const claudeSelectors = { model: "caller-claude", effort: "xhigh" };
        const grokSelectors = { model: "config-grok", effort: "medium" };
        const clineSelectors = { provider: "openai-codex", model: "caller-cline", effort: "high" };
        const invalidSelectors = [];
        const addInvalid = (tool, selectorName, variants) => {
          for (const input of variants)
            invalidSelectors.push({ tool, selector: selectorName, input, error: `${tool}: invalid ${selectorName}`, discoveries: 0, spawns: 0 });
        };
        for (const tool of ["ask_claude", "ask_claude_write"]) {
          addInvalid(tool, "model", ["nonstring", "empty"]);
          addInvalid(tool, "effort", ["nonstring", "empty", "unsupported"]);
        }
        for (const tool of ["ask_grok", "ask_grok_write"]) {
          addInvalid(tool, "model", ["nonstring", "empty"]);
          addInvalid(tool, "effort", ["nonstring", "empty", "unsupported"]);
        }
        for (const tool of ["ask_cline", "ask_cline_write"]) {
          addInvalid(tool, "provider", ["nonstring", "empty"]);
          addInvalid(tool, "model", ["nonstring", "empty"]);
          addInvalid(tool, "effort", ["nonstring", "empty", "unsupported"]);
        }
        return {
          config: {
            defaultPath: this.context.configPath,
            explicitPath: this.context.explicitConfigPath,
            missingDefault: "empty",
            readsAtStartup: 1,
            neutral: { $schema: "./frenemy.config.schema.json", version: 1, agents: { claude: {}, grok: {}, cline: {} } },
          },
          schema: {
            draft: "https://json-schema.org/draft/2020-12/schema",
            strictObjects: ["root", "agents", "claude", "grok", "cline"],
            fields: { claude: ["model", "effort"], grok: ["model", "effort"], cline: ["provider", "model", "effort"] },
            efforts: { claude: claudeEfforts, grokCanonical: grokEfforts, grokPattern: grokEffortPattern, cline: clineEfforts },
            selectorStringsRequireNonempty: true,
          },
          precedence: {
            claude: claudeSelectors,
            grok: grokSelectors,
            cline: clineSelectors,
            nativeDefaults: { claude: {}, grok: {}, cline: {} },
            crossAgentLeak: false,
          },
          argv: {
            claude: ["-p", "--output-format", "json", ...this.selectorArgs("claude", claudeSelectors)],
            grok: [...this.grokArgs(false), ...this.selectorArgs("grok", grokSelectors)],
            cline: ["--acp", "--auto-approve", "false", "--cwd", cwd, ...this.selectorArgs("cline", clineSelectors)],
            shell: false,
          },
          clineEnvironment: {
            CLINE_PROVIDER: clineSelectors.provider,
            CLINE_MODEL: clineSelectors.model,
          },
          parentEnvironmentUnchanged: true,
          compatibility: {
            claude: ["-p", "--output-format", "json"],
            grok: this.grokArgs(false),
            cline: ["--acp", "--auto-approve", "false", "--cwd", cwd],
          },
          invalidSelectors,
          invalidConfigs: [
            ["missing-explicit", "Frenemy config: file unavailable", 0],
            ["unreadable", "Frenemy config: file unreadable", 0],
            ["malformed-json", "Frenemy config: invalid JSON", 0],
            ["unknown-root-property", "Frenemy config: invalid property", 0],
            ["unknown-agent-property", "Frenemy config: invalid property", 0],
            ["invalid-selector", "Frenemy config: invalid selector", 0],
            ["credential-property", "Frenemy config: invalid property", 0],
          ],
          nativeRejection: { error: "ask_cline: native failure", fallbacks: 0, configMutations: 0, profileMutations: 0 },
        };
      }
      case "R06":
        return { tools: this.tools().slice(0, 2), readArgs: ["-p", "--output-format", "json", "--safe-mode", "--disallowedTools", "Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "--strict-mcp-config"], writeArgs: ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--setting-sources", "user"], pins, sanitizerPreserved: true, claudeBehavior: { missingPromptCoerced: "", nonstringPromptCoerced: "[object Object]", unknownToolPreserved: true, framingPreserved: true, errorEnvelopePreserved: true }, unchangedFiles: ["install.ps1", "install.sh", "CLAUDE-codex-section.md", "genimg.sh"] };
      case "Q01":
        return new MockNativeQualificationProvider(this.context).grok();
      case "Q02":
        return new MockNativeQualificationProvider(this.context).cline();
      default:
        throw new Error(`Unknown mock case: ${caseId}`);
    }
  }
}
