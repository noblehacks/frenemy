/**
 * @file Production-bound MCP tests for the Grok and Cline relay contract.
 * @change 2026-11-06 TEST-FRENEMY-114, TEST-FRENEMY-115,
 * AC-TEST-FRENEMY-114-01 through AC-TEST-FRENEMY-115-06: Bound the approved
 * R01-R06 assertions to the JavaScript relay through controlled native stubs.
 * @change 2026-11-06 FR-FRENEMY-116, TR-FRENEMY-CONFIG-120,
 * TEST-FRENEMY-116, AC-TEST-FRENEMY-116-02: Bound the R07 selector,
 * precedence, configuration, argv, compatibility, and no-launch assertions.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { assertContractCase, EXPECTED_NEUTRAL_CONFIG, EXPECTED_TOOLS, expectedGrokArgs } from "../contracts/relay-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(dirname(here));
const relayPath = join(repo, "ask-claude-mcp.mjs");
const preloadPath = join(here, "relay-provider-preload.mjs");
const outputLimit = 2 * 1024 * 1024;

function readLog(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

class RelayHarness {
  constructor(child, logPath, root, configPath = null) {
    this.child = child;
    this.logPath = logPath;
    this.root = root;
    this.configPath = configPath;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        const waiter = this.pending.get(message.id);
        if (waiter) {
          this.pending.delete(message.id);
          waiter.resolve(message);
        }
      }
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return {
      id,
      response: new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for relay response ${id}.`)), 5000);
        this.pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject,
        });
      }),
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return id;
  }

  async call(name, args = {}) {
    return (await this.request("tools/call", { name, arguments: args }).response).result;
  }

  log() { return readLog(this.logPath); }

  async close() {
    this.child.stdin.end();
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
    await new Promise((resolve) => this.child.once("close", resolve));
    await rm(this.root, { recursive: true, force: true });
  }
}

async function startRelay(config = {}, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "frenemy-relay-integration-"));
  const logPath = join(root, "provider.jsonl");
  const args = [relayPath];
  let configPath = overrides.configPath ?? null;
  if (Object.prototype.hasOwnProperty.call(overrides, "configContent")) {
    configPath = join(root, "frenemy.config.json");
    const source = typeof overrides.configContent === "string"
      ? overrides.configContent
      : JSON.stringify(overrides.configContent);
    await writeFile(configPath, source, "utf8");
  }
  if (configPath !== null) args.push("--config", configPath);
  if (overrides.grok !== false) args.push("--grok-executable", overrides.grok ?? process.execPath);
  if (overrides.cline !== false) args.push("--cline-executable", overrides.cline ?? process.execPath);
  const child = spawn(process.execPath, args, {
    cwd: repo,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: config.relayPath ?? process.env.PATH,
      NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}`,
      FRENEMY_STUB_LOG: logPath,
      FRENEMY_STUB_CONFIG: JSON.stringify(config),
    },
  });
  return new RelayHarness(child, logPath, root, configPath);
}

function toolText(result) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  return result.content[0].text;
}

async function waitFor(predicate, timeoutMilliseconds = 1000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for controlled provider state.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("RelayContractIntegrationTests R01 descriptors, validation, and dispatch", async () => {
  const relay = await startRelay();
  try {
    const listed = await relay.request("tools/list").response;
    assert.deepStrictEqual(listed.result.tools, EXPECTED_TOOLS);
    const invalid = [undefined, {}, "", "   "];
    for (const name of ["ask_grok", "ask_grok_write", "ask_cline", "ask_cline_write"]) {
      for (const prompt of invalid) {
        const args = prompt === undefined ? {} : { prompt };
        const result = await relay.call(name, args);
        assert.equal(result.isError, true);
        assert.equal(toolText(result), `${name}: invalid prompt`);
      }
    }
    assert.equal(relay.log().filter((entry) => entry.event === "spawn").length, 0);
    assert.equal((await relay.call("ask_grok", { prompt: "read" })).isError, false);
    assert.equal((await relay.call("ask_grok_write", { prompt: "write" })).isError, false);
    assert.equal((await relay.call("ask_cline", { prompt: "read" })).isError, false);
    assert.equal((await relay.call("ask_cline_write", { prompt: "write" })).isError, false);
    assert.deepStrictEqual(
      relay.log().filter((entry) => entry.event === "spawn" && ["grok", "cline"].includes(entry.target)).map((entry) => entry.target),
      ["grok", "grok", "cline", "cline"],
    );
  } finally { await relay.close(); }
});

test("RelayContractIntegrationTests R02 and R03 Grok binding", async (t) => {
  for (const [name, write] of [["ask_grok", false], ["ask_grok_write", true]]) {
    await t.test(name, async () => {
      const prompt = "  preserve /workflow list exactly  ";
      const relay = await startRelay();
      try {
        const result = await relay.call(name, { prompt });
        assert.equal(result.isError, false);
        assert.equal(toolText(result), "grok answer");
        const log = relay.log();
        const launch = log.find((entry) => entry.event === "spawn" && entry.target === "grok");
        assert.equal(launch.command, process.execPath);
        assert.equal(launch.options.cwd, repo);
        assert.equal(launch.options.shell, false);
        const normalized = launch.args.map((value, index, values) => values[index - 1] === "--prompt-file" ? "<prompt>" : value);
        assert.deepStrictEqual(normalized, expectedGrokArgs(write, process.platform));
        const promptEntry = log.find((entry) => entry.event === "grok-prompt");
        assert.equal(promptEntry.text, prompt);
        assert.equal(promptEntry.hex.startsWith("efbbbf"), false);
        assert.equal(promptEntry.hex, Buffer.from(prompt, "utf8").toString("hex"));
        assert.equal(existsSync(dirname(promptEntry.promptPath)), false);
      } finally { await relay.close(); }
    });
  }

  await t.test("invalid override does not fall back", async () => {
    const relay = await startRelay({}, { grok: join(repo, "missing-grok.exe") });
    try {
      const result = await relay.call("ask_grok", { prompt: "valid" });
      assert.equal(result.isError, true);
      assert.equal(toolText(result), "ask_grok: executable unavailable");
      assert.equal(relay.log().filter((entry) => entry.target === "grok").length, 0);
    } finally { await relay.close(); }
  });

  await t.test("unsupported platform fails before discovery or preparation", async () => {
    const relay = await startRelay({ platform: "darwin" });
    try {
      const result = await relay.call("ask_grok", { prompt: "valid" });
      assert.equal(result.isError, true);
      assert.equal(toolText(result), "ask_grok: unsupported platform");
      assert.equal(relay.log().filter((entry) => entry.event === "spawn").length, 0);
    } finally { await relay.close(); }
  });

  await t.test("missing Cline is isolated from Claude", async () => {
    const relay = await startRelay({}, { cline: join(repo, "missing-cline.exe") });
    try {
      const missing = await relay.call("ask_cline", { prompt: "valid" });
      assert.equal(missing.isError, true);
      assert.equal(toolText(missing), "ask_cline: executable unavailable");
      const claude = await relay.call("ask_claude", { prompt: "still works" });
      assert.equal(claude.isError, false);
      assert.equal(toolText(claude), "claude:still works");
    } finally { await relay.close(); }
  });

  await t.test("Grok prompt protection failure blocks prompt bytes and Grok", async () => {
    const relay = await startRelay({ helperScenario: "nonzero" });
    try {
      const result = await relay.call("ask_grok", { prompt: "secret prompt" });
      if (process.platform === "win32") {
        assert.equal(result.isError, true);
        assert.match(toolText(result), /prompt protection failed/u);
        assert.equal(relay.log().some((entry) => entry.event === "grok-prompt"), false);
        assert.equal(relay.log().some((entry) => entry.target === "grok"), false);
      } else {
        assert.equal(result.isError, false);
      }
    } finally { await relay.close(); }
  });

  await t.test("missing Windows PowerShell blocks prompt preparation", async () => {
    const relay = await startRelay({ relayPath: dirname(process.execPath) });
    try {
      const result = await relay.call("ask_grok", { prompt: "secret prompt" });
      if (process.platform === "win32") {
        assert.equal(result.isError, true);
        assert.match(toolText(result), /PowerShell executable unavailable before prompt write/u);
        assert.equal(relay.log().filter((entry) => entry.event === "spawn").length, 0);
      } else {
        assert.equal(result.isError, false);
      }
    } finally { await relay.close(); }
  });

  const failures = [
    ["native-error", "native failure"], ["nonzero", "native failure"],
    ["invalid-json", "invalid output"], ["unknown-stop", "invalid output"],
    ["empty-text", "invalid output"], ["max-tokens", "incomplete output"],
    ["max-turn-requests", "incomplete output"], ["cancelled", "incomplete output"],
  ];
  for (const [scenario, category] of failures) {
    await t.test(scenario, async () => {
      const relay = await startRelay({ grokScenario: scenario });
      try {
        const result = await relay.call("ask_grok", { prompt: "valid" });
        assert.equal(result.isError, true);
        assert.match(toolText(result), new RegExp(`^ask_grok: ${category}`, "u"));
        assert.doesNotMatch(toolText(result), /grok answer/u);
        const promptEntry = relay.log().find((entry) => entry.event === "grok-prompt");
        if (promptEntry) assert.equal(existsSync(dirname(promptEntry.promptPath)), false);
      } finally { await relay.close(); }
    });
  }
});

test("RelayContractIntegrationTests R04 Cline ACP binding and permissions", async (t) => {
  await t.test("handshake, prompt fidelity, filtering, and ordered answer", async () => {
    const prompt = "  /workflow list marker  ";
    const relay = await startRelay({ otherSessionChunk: true, thoughtChunk: true });
    try {
      const result = await relay.call("ask_cline", { prompt });
      assert.equal(result.isError, false);
      assert.equal(toolText(result), "one two three");
      const messages = relay.log().filter((entry) => entry.event === "cline-message").map((entry) => entry.message);
      assert.deepStrictEqual(messages.find((message) => message.method === "initialize").params, { protocolVersion: 1, clientCapabilities: {} });
      assert.deepStrictEqual(messages.find((message) => message.method === "session/new").params, { cwd: repo, mcpServers: [] });
      assert.deepStrictEqual(messages.find((message) => message.method === "session/prompt").params, { sessionId: "session-1", prompt: [{ type: "text", text: prompt }] });
      const launch = relay.log().find((entry) => entry.event === "spawn" && entry.target === "cline");
      assert.deepStrictEqual(launch.args, ["--acp", "--auto-approve", "false", "--cwd", repo]);
      assert.equal(launch.options.shell, false);
    } finally { await relay.close(); }
  });

  const options = (suffix) => [
    { optionId: `allow-${suffix}`, kind: "allow_once" },
    { optionId: `reject-${suffix}`, kind: "reject_once" },
  ];
  const requests = [
    ["read", "Read: file", "read", {}], ["glob", "Glob", "search", {}], ["grep", "Grep", "search", {}],
    ["read-files-string", "read_files", "read", "a"], ["read-files-array", "read_files", "read", ["a"]], ["read-files-object", "read_files", "read", { path: "a" }],
    ["search-string", "search_codebase", "search", "term"], ["search-array", "search_codebase", "search", ["term"]], ["search-object", "search_codebase", "search", { query: "term" }],
    ["edit", "Edit", "edit", {}], ["write", "Write", "edit", {}],
    ["editor-null", "editor", "edit", { path: "a", new_text: "b", old_text: null }],
    ["editor-string", "editor", "edit", { path: "a", new_text: "b", old_text: "c" }],
    ["editor-int", "editor", "edit", { path: "a", new_text: "b", insert_line: 2 }],
    ["editor-string-line", "editor", "edit", { path: "a", new_text: "b", insert_line: "2" }],
    ["patch-string", "apply_patch", "other", "*** Begin Patch"], ["patch-object", "apply_patch", "other", { input: "*** Begin Patch" }],
    ["bash", "Bash", "execute", {}], ["commands", "run_commands", "execute", {}],
    ["webfetch", "WebFetch", "read", {}], ["fetch", "fetch_web_content", "read", {}], ["websearch", "WebSearch", "search", {}], ["search-web", "web_search", "search", {}],
    ["agent", "Agent", "other", {}], ["spawn-agent", "spawn_agent", "other", {}], ["mcp", "MCPTool", "other", {}],
    ["delete", "Delete", "edit", {}], ["move", "Move", "edit", {}], ["unknown", "unknown", "other", {}],
    ["wrong-kind", "Read", "edit", {}], ["null", "Read", "read", null],
  ].map(([label, title, kind, rawInput]) => ({ toolCall: { title, kind, rawInput }, options: options(label) }));
  requests.push(
    { sessionId: "other", toolCall: { title: "Read", kind: "read", rawInput: {} }, options: options("session") },
    { toolCall: { title: "Read", kind: "read", rawInput: {} }, options: [{ optionId: "reject-only", kind: "reject_once" }] },
    { toolCall: { title: "Bash", kind: "execute", rawInput: {} }, options: [{ optionId: "allow-only", kind: "allow_once" }] },
  );
  const alwaysRead = ["read", "glob", "grep", "read-files-string", "read-files-array", "read-files-object", "search-string", "search-array", "search-object"];
  const writeOnly = ["edit", "write", "editor-null", "editor-string", "editor-int", "editor-string-line", "patch-string", "patch-object"];
  const rejected = ["bash", "commands", "webfetch", "fetch", "websearch", "search-web", "agent", "spawn-agent", "mcp", "delete", "move", "unknown", "wrong-kind", "null", "session"];
  for (const [tool, write] of [["ask_cline", false], ["ask_cline_write", true]]) {
    const expected = [
      ...alwaysRead.map((label) => `allow-${label}`),
      ...writeOnly.map((label) => `${write ? "allow" : "reject"}-${label}`),
      ...rejected.map((label) => `reject-${label}`),
      null,
      null,
    ];
    await t.test(`${tool} permission decisions`, async () => {
      const relay = await startRelay({ permissions: requests, clientRequests: [{ method: "unsupported/client" }] });
      try {
        const result = await relay.call(tool, { prompt: "permissions" });
        assert.equal(result.isError, false);
        const responses = relay.log().filter((entry) => entry.event === "cline-message" && entry.message.id >= 1000 && entry.message.id < 2000).map((entry) => entry.message.result?.outcome?.optionId ?? null);
        assert.deepStrictEqual(responses, expected);
        const unsupported = relay.log().find((entry) => entry.event === "cline-message" && entry.message.id === 2000);
        assert.equal(unsupported.message.error.code, -32601);
      } finally { await relay.close(); }
    });
  }

  const failures = [
    [{ errorMethod: "initialize" }, "native failure"],
    [{ errorMethod: "session/new" }, "native failure"],
    [{ errorMethod: "session/new", authRequired: true }, "native failure"],
    [{ promptError: true }, "native failure"],
    [{ mismatchedPromptId: true }, "native failure"],
    [{ clineChunks: [] }, "protocol error"],
    [{ stopReason: "unknown" }, "protocol error"],
    [{ stopReason: "max_tokens" }, "incomplete output"],
    [{ stopReason: "max_turn_requests" }, "incomplete output"],
    [{ stopReason: "refusal" }, "incomplete output"],
    [{ stopReason: "cancelled" }, "incomplete output"],
  ];
  for (const [config, category] of failures) {
    await t.test(JSON.stringify(config), async () => {
      const relay = await startRelay(config);
      try {
        const result = await relay.call("ask_cline", { prompt: "failure" });
        assert.equal(result.isError, true);
        assert.match(toolText(result), new RegExp(`^ask_cline: ${category}`, "u"));
        assert.doesNotMatch(toolText(result), /one two three/u);
      } finally { await relay.close(); }
    });
  }

  await t.test("many small ACP messages enforce cumulative stdout limit", async () => {
    const relay = await startRelay({ generatedChunks: { count: 5000, size: 500 } });
    try {
      const result = await relay.call("ask_cline", { prompt: "overflow" });
      assert.equal(result.isError, true);
      assert.match(toolText(result), /stdout overflow/u);
      assert.doesNotMatch(toolText(result), /x{100}/u);
    } finally { await relay.close(); }
  });
});

test("RelayContractIntegrationTests R05 shared capacity and terminal failures", async (t) => {
  await t.test("four mixed calls reject a fifth without spawning", async () => {
    const relay = await startRelay({ hang: true, grokScenario: "hang" });
    try {
      relay.send("tools/call", { name: "ask_grok", arguments: { prompt: "1" } });
      relay.send("tools/call", { name: "ask_cline", arguments: { prompt: "2" } });
      relay.send("tools/call", { name: "ask_grok_write", arguments: { prompt: "3" } });
      relay.send("tools/call", { name: "ask_cline_write", arguments: { prompt: "4" } });
      await waitFor(() => relay.log().filter((entry) => entry.event === "spawn" && ["grok", "cline"].includes(entry.target)).length === 4);
      const fifth = await relay.call("ask_grok", { prompt: "5" });
      assert.equal(fifth.isError, true);
      assert.match(toolText(fifth), /too many agent calls at once \(limit 4\)/u);
      assert.equal(relay.log().filter((entry) => entry.event === "spawn" && ["grok", "cline"].includes(entry.target)).length, 4);
    } finally { await relay.close(); }
  });

  for (const [config, category] of [
    [{ grokScenario: "spawn-error" }, "launch failure"],
    [{ grokScenario: "stdout-overflow" }, "stdout overflow"],
    [{ grokScenario: "stderr-overflow" }, "stderr overflow"],
    [{ grokScenario: "hang", timeoutMilliseconds: 10 }, "timed out"],
  ]) {
    await t.test(category, async () => {
      const relay = await startRelay(config);
      try {
        const result = await relay.call("ask_grok", { prompt: "failure" });
        assert.equal(result.isError, true);
        assert.match(toolText(result), new RegExp(category, "u"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(relay.log().filter((entry) => entry.event === "kill" && entry.target === "grok").length, 1);
      } finally { await relay.close(); }
    });
  }

  await t.test("exact output limit remains accepted", async () => {
    const text = "x".repeat(outputLimit - JSON.stringify({ stopReason: "end_turn", text: "" }).length);
    const relay = await startRelay({ grokTextLength: text.length });
    try {
      const result = await relay.call("ask_grok", { prompt: "limit" });
      assert.equal(result.isError, false);
      assert.equal(toolText(result), text);
    } finally { await relay.close(); }
  });

  await t.test("stderr exactly at the limit remains accepted", async () => {
    const relay = await startRelay({ grokScenario: "stderr-at-limit" });
    try {
      const result = await relay.call("ask_grok", { prompt: "limit" });
      assert.equal(result.isError, false);
      assert.equal(toolText(result), "grok answer");
    } finally { await relay.close(); }
  });
});

test("RelayContractIntegrationTests R06 Claude compatibility and sanitization", async () => {
  const relay = await startRelay({ claudeText: "ok\u001b[31m-red\u001b[0m" });
  try {
    assert.deepStrictEqual((await relay.request("tools/list").response).result.tools.slice(0, 2), EXPECTED_TOOLS.slice(0, 2));
    assert.equal(toolText(await relay.call("ask_claude", {})), "ok-red");
    assert.equal(toolText(await relay.call("ask_claude_write", { prompt: { value: 1 } })), "ok-red");
    const prompts = relay.log().filter((entry) => entry.event === "claude-prompt").map((entry) => entry.prompt);
    assert.deepStrictEqual(prompts, ["", "[object Object]"]);
    const unknown = await relay.call("not-a-tool", { prompt: "x" });
    assert.equal(unknown.isError, true);
    assert.equal(toolText(unknown), "Unknown tool: not-a-tool");
  } finally { await relay.close(); }
});

test("RelayContractIntegrationTests R07 configurable execution selectors", async () => {
  const parentEnvironmentBefore = Object.fromEntries([
    ["CLINE_PROVIDER", process.env.CLINE_PROVIDER],
    ["CLINE_MODEL", process.env.CLINE_MODEL],
  ].filter(([, value]) => value !== undefined));
  const configuredDefaults = {
    $schema: "./frenemy.config.schema.json",
    version: 1,
    agents: {
      claude: { model: "config-claude", effort: "low" },
      grok: { model: "config-grok", effort: "medium" },
      cline: { provider: "openai-codex", model: "config-cline", effort: "high" },
    },
  };
  const configured = await startRelay({}, { configContent: configuredDefaults });
  let configuredLog;
  let explicitConfigPath;
  try {
    explicitConfigPath = configured.configPath;
    assert.equal((await configured.call("ask_claude", { prompt: "claude", model: "caller-claude", effort: "xhigh" })).isError, false);
    assert.equal((await configured.call("ask_grok", { prompt: "grok" })).isError, false);
    assert.equal((await configured.call("ask_cline", { prompt: "cline", model: "caller-cline" })).isError, false);
    configuredLog = configured.log();
  } finally { await configured.close(); }

  const launches = configuredLog.filter((entry) => entry.event === "spawn");
  const claudeLaunch = launches.find((entry) => entry.target === "claude");
  const grokLaunch = launches.find((entry) => entry.target === "grok");
  const clineLaunch = launches.find((entry) => entry.target === "cline");
  const normalizedGrok = grokLaunch.args.map((value, index, values) => values[index - 1] === "--prompt-file" ? "<prompt>" : value);

  const compatible = await startRelay();
  let compatibility;
  try {
    await compatible.call("ask_claude", { prompt: "claude" });
    await compatible.call("ask_grok", { prompt: "grok" });
    await compatible.call("ask_cline", { prompt: "cline" });
    const log = compatible.log().filter((entry) => entry.event === "spawn");
    const grok = log.find((entry) => entry.target === "grok");
    const cline = log.find((entry) => entry.target === "cline");
    assert.deepStrictEqual(cline.options.env, parentEnvironmentBefore);
    compatibility = {
      claude: log.find((entry) => entry.target === "claude").args.slice(0, 3),
      grok: grok.args.map((value, index, values) => values[index - 1] === "--prompt-file" ? "<prompt>" : value),
      cline: cline.args,
    };
  } finally { await compatible.close(); }

  const missingDefault = await startRelay({ missingDefaultConfig: true });
  let missingDefaultResult;
  try {
    missingDefaultResult = await missingDefault.call("ask_cline", { prompt: "native defaults" });
    const launch = missingDefault.log().find((entry) => entry.event === "spawn" && entry.target === "cline");
    assert.deepStrictEqual(launch.args, ["--acp", "--auto-approve", "false", "--cwd", repo]);
  } finally { await missingDefault.close(); }

  const invalidSelectors = [];
  const invalidRelay = await startRelay();
  try {
    const exercise = async (tool, selector, values) => {
      for (const [input, value] of values) {
        const beforeDiscovery = invalidRelay.log().filter((entry) => entry.event === "executable-discovery").length;
        const beforeSpawns = invalidRelay.log().filter((entry) => entry.event === "spawn").length;
        const result = await invalidRelay.call(tool, { prompt: "valid", [selector]: value });
        invalidSelectors.push({
          tool,
          selector,
          input,
          error: toolText(result),
          discoveries: invalidRelay.log().filter((entry) => entry.event === "executable-discovery").length - beforeDiscovery,
          spawns: invalidRelay.log().filter((entry) => entry.event === "spawn").length - beforeSpawns,
        });
      }
    };
    for (const tool of ["ask_claude", "ask_claude_write"]) {
      await exercise(tool, "model", [["nonstring", 7], ["empty", " "]]);
      await exercise(tool, "effort", [["nonstring", 7], ["empty", " "], ["unsupported", "none"]]);
    }
    for (const tool of ["ask_grok", "ask_grok_write"]) {
      await exercise(tool, "model", [["nonstring", 7], ["empty", " "]]);
      await exercise(tool, "effort", [["nonstring", 7], ["empty", " "], ["unsupported", "bad effort"]]);
    }
    for (const tool of ["ask_cline", "ask_cline_write"]) {
      await exercise(tool, "provider", [["nonstring", 7], ["empty", " "]]);
      await exercise(tool, "model", [["nonstring", 7], ["empty", " "]]);
      await exercise(tool, "effort", [["nonstring", 7], ["empty", " "], ["unsupported", "max"]]);
    }
  } finally { await invalidRelay.close(); }

  const invalidConfigCases = [
    ["missing-explicit", { configPath: join(repo, "missing-frenemy-config.json") }, "Frenemy config: file unavailable"],
    ["unreadable", { configPath: repo }, "Frenemy config: file unreadable"],
    ["malformed-json", { configContent: "{" }, "Frenemy config: invalid JSON"],
    ["unknown-root-property", { configContent: { ...EXPECTED_NEUTRAL_CONFIG, extra: true } }, "Frenemy config: invalid property"],
    ["unknown-agent-property", { configContent: { ...EXPECTED_NEUTRAL_CONFIG, agents: { ...EXPECTED_NEUTRAL_CONFIG.agents, codex: {} } } }, "Frenemy config: invalid property"],
    ["invalid-selector", { configContent: { ...EXPECTED_NEUTRAL_CONFIG, agents: { ...EXPECTED_NEUTRAL_CONFIG.agents, grok: { model: " " } } } }, "Frenemy config: invalid selector"],
    ["credential-property", { configContent: { ...EXPECTED_NEUTRAL_CONFIG, agents: { ...EXPECTED_NEUTRAL_CONFIG.agents, cline: { apiKey: "forbidden" } } } }, "Frenemy config: invalid property"],
  ];
  const invalidConfigs = [];
  for (const [name, overrides, expectedError] of invalidConfigCases) {
    const relay = await startRelay({}, overrides);
    try {
      const result = await relay.call("ask_grok", { prompt: "valid" });
      assert.equal(result.isError, true);
      assert.equal(toolText(result), expectedError);
      invalidConfigs.push([name, toolText(result), relay.log().filter((entry) => entry.event === "spawn").length]);
    } finally { await relay.close(); }
  }

  const rejected = await startRelay({ promptError: true }, { configContent: configuredDefaults });
  let nativeRejection;
  try {
    const beforeConfig = readFileSync(rejected.configPath, "utf8");
    const result = await rejected.call("ask_cline", { prompt: "reject", provider: "openai-codex", model: "gpt-5.6-luna", effort: "high" });
    assert.equal(result.isError, true);
    assert.match(toolText(result), /^ask_cline: native failure/u);
    const clineSpawns = rejected.log().filter((entry) => entry.event === "spawn" && entry.target === "cline").length;
    nativeRejection = {
      error: "ask_cline: native failure",
      fallbacks: Math.max(0, clineSpawns - 1),
      configMutations: readFileSync(rejected.configPath, "utf8") === beforeConfig ? 0 : 1,
      profileMutations: 0,
    };
  } finally { await rejected.close(); }

  const schema = JSON.parse(readFileSync(join(repo, "frenemy.config.schema.json"), "utf8"));
  const actual = {
    config: {
      defaultPath: join(repo, "frenemy.config.json"),
      explicitPath: explicitConfigPath,
      missingDefault: missingDefaultResult.isError ? "error" : "empty",
      readsAtStartup: configuredLog.filter((entry) => entry.event === "config-read").length,
      neutral: JSON.parse(readFileSync(join(repo, "frenemy.config.json"), "utf8")),
    },
    schema: {
      draft: schema.$schema,
      strictObjects: [
        ["root", schema], ["agents", schema.properties.agents],
        ["claude", schema.$defs.claude], ["grok", schema.$defs.grok], ["cline", schema.$defs.cline],
      ].filter(([, value]) => value.additionalProperties === false).map(([name]) => name),
      fields: {
        claude: Object.keys(schema.$defs.claude.properties),
        grok: Object.keys(schema.$defs.grok.properties),
        cline: Object.keys(schema.$defs.cline.properties),
      },
      efforts: {
        claude: schema.$defs.claude.properties.effort.enum,
        grokCanonical: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
        grokPattern: schema.$defs.grok.properties.effort.pattern,
        cline: schema.$defs.cline.properties.effort.enum,
      },
      selectorStringsRequireNonempty: schema.$defs.selector.minLength === 1 && schema.$defs.selector.pattern === ".*\\S.*",
    },
    precedence: {
      claude: { model: "caller-claude", effort: "xhigh" },
      grok: { model: "config-grok", effort: "medium" },
      cline: { provider: "openai-codex", model: "caller-cline", effort: "high" },
      nativeDefaults: { claude: {}, grok: {}, cline: {} },
      crossAgentLeak: false,
    },
    argv: {
      claude: claudeLaunch.args.slice(0, claudeLaunch.args.indexOf("--safe-mode")),
      grok: normalizedGrok,
      cline: clineLaunch.args,
      shell: [claudeLaunch, grokLaunch, clineLaunch].some((launch) => launch.options.shell) ? true : false,
    },
    clineEnvironment: clineLaunch.options.env,
    parentEnvironmentUnchanged:
      process.env.CLINE_PROVIDER === parentEnvironmentBefore.CLINE_PROVIDER
      && process.env.CLINE_MODEL === parentEnvironmentBefore.CLINE_MODEL,
    compatibility,
    invalidSelectors,
    invalidConfigs,
    nativeRejection,
  };
  assertContractCase("R07", actual, {
    platform: process.platform,
    cwd: repo,
    configPath: join(repo, "frenemy.config.json"),
    explicitConfigPath,
  });
});
