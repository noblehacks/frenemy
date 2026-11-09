#!/usr/bin/env node
// ============================================================
//  Frenemy, created by Zakariya Syed
//  Lets Codex and Claude Code talk to each other.
//  No copy-pasting between apps, no API keys.
//
//  YouTube:  youtube.com/@noblehacksacademy
//  LinkedIn: linkedin.com/in/zakariya-syed
//  X:        x.com/ZakariyaHacks
//  GitHub:   github.com/noblehacks
// ============================================================
//
// MCP server for Codex. Offers read and explicit-write tools for Claude Code,
// Grok Build, and Cline CLI. Each call runs one native agent turn and relays
// one answer or tool error back.

/**
 * @file Existing Frenemy stdio MCP relay with native Grok Build and Cline CLI support.
 * @change 2026-11-06 FR-FRENEMY-114, FR-FRENEMY-115,
 * TR-FRENEMY-ADAPTER-118, TEST-FRENEMY-114, TEST-FRENEMY-115: Added the four
 * approved Grok/Cline tools while preserving the existing Claude surface.
 * @change 2026-11-06 FR-FRENEMY-116, TR-FRENEMY-CONFIG-120,
 * TEST-FRENEMY-116, AC-FRENEMY-116-01 through AC-FRENEMY-116-05,
 * AC-TR-FRENEMY-CONFIG-120-01 through AC-TR-FRENEMY-CONFIG-120-04:
 * Added validated caller and per-agent execution selectors with agent-specific
 * native process-input mapping.
 */

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const RELAY_DIR = dirname(fileURLToPath(import.meta.url));

// Windows searches the current folder before PATH, so a repo could
// plant a fake claude.exe. We resolve the real one from PATH once.
function resolveClaudeOnWindowsPath() {
  for (const raw of (process.env.PATH ?? "").split(delimiter)) {
    const dir = raw.replace(/"/g, ""); // PATH entries may be quoted on Windows
    if (!dir || !isAbsolute(dir)) continue; // relative entries are the same trap
    const candidate = join(dir, "claude.exe");
    if (existsSync(candidate)) return candidate;
  }
  return null; // reported as an error when a tool is called
}
const CLAUDE_CMD =
  process.platform === "win32" ? resolveClaudeOnWindowsPath() : "claude";

function optionValue(name) {
  const inlinePrefix = `${name}=`;
  for (let index = 2; index < process.argv.length; index++) {
    const value = process.argv[index];
    if (value === name) return process.argv[index + 1] ?? "";
    if (value.startsWith(inlinePrefix)) return value.slice(inlinePrefix.length);
  }
  return null;
}

const GROK_OVERRIDE = optionValue("--grok-executable");
const CLINE_OVERRIDE = optionValue("--cline-executable");
const CONFIG_OVERRIDE = optionValue("--config");
const DEFAULT_CONFIG_PATH = join(RELAY_DIR, "frenemy.config.json");

const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const CLINE_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);
const GROK_EFFORT_PATTERN = /^(?:none|minimal|low|medium|high|xhigh|max|[A-Za-z0-9][A-Za-z0-9._:-]*)$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOwnedProperties(value, allowed) {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("Frenemy config: invalid property");
  }
}

function validSelector(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateAgentConfig(agent, value) {
  const fields = agent === "cline" ? ["provider", "model", "effort"] : ["model", "effort"];
  assertOwnedProperties(value, fields);
  for (const field of fields) {
    if (value[field] !== undefined && !validSelector(value[field])) {
      throw new Error("Frenemy config: invalid selector");
    }
  }
  if (value.effort !== undefined) {
    const accepted = agent === "claude"
      ? CLAUDE_EFFORTS.has(value.effort)
      : agent === "cline"
        ? CLINE_EFFORTS.has(value.effort)
        : GROK_EFFORT_PATTERN.test(value.effort);
    if (!accepted) throw new Error("Frenemy config: invalid selector");
  }
  return Object.freeze({ ...value });
}

function emptyConfig() {
  return Object.freeze({ agents: Object.freeze({
    claude: Object.freeze({}),
    grok: Object.freeze({}),
    cline: Object.freeze({}),
  }) });
}

function loadFrenemyConfig() {
  const explicit = CONFIG_OVERRIDE !== null;
  const configPath = explicit ? CONFIG_OVERRIDE : DEFAULT_CONFIG_PATH;
  if (explicit && !isAbsolute(configPath)) throw new Error("Frenemy config: path must be absolute");
  if (!existsSync(configPath)) {
    if (explicit) throw new Error("Frenemy config: file unavailable");
    return emptyConfig();
  }
  let source;
  try {
    source = readFileSync(configPath, "utf8");
  } catch {
    throw new Error("Frenemy config: file unreadable");
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Frenemy config: invalid JSON");
  }
  assertOwnedProperties(parsed, ["$schema", "version", "agents"]);
  if (parsed.version !== 1) throw new Error("Frenemy config: invalid property");
  assertOwnedProperties(parsed.agents, ["claude", "grok", "cline"]);
  if (!["claude", "grok", "cline"].every((agent) => isPlainObject(parsed.agents[agent]))) {
    throw new Error("Frenemy config: invalid property");
  }
  return Object.freeze({ agents: Object.freeze({
    claude: validateAgentConfig("claude", parsed.agents.claude),
    grok: validateAgentConfig("grok", parsed.agents.grok),
    cline: validateAgentConfig("cline", parsed.agents.cline),
  }) });
}

let FRENEMY_CONFIG = emptyConfig();
let FRENEMY_CONFIG_ERROR = null;
try {
  FRENEMY_CONFIG = loadFrenemyConfig();
} catch (error) {
  FRENEMY_CONFIG_ERROR = error.message;
}

function validNativeExecutable(candidate, platform = process.platform) {
  if (!candidate || !isAbsolute(candidate)) return false;
  try {
    if (!statSync(candidate).isFile()) return false;
    if (platform === "win32") return extname(candidate).toLowerCase() === ".exe";
    if (platform === "linux") {
      accessSync(candidate, fsConstants.X_OK);
      return true;
    }
  } catch {}
  return false;
}

function resolveNativeExecutable(name, override, platform = process.platform) {
  if (platform !== "win32" && platform !== "linux") return null;
  if (override !== null) return validNativeExecutable(override, platform) ? override : null;
  const fileName = platform === "win32" ? `${name}.exe` : name;
  for (const raw of (process.env.PATH ?? "").split(delimiter)) {
    const directory = raw.replace(/"/g, "");
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = join(directory, fileName);
    if (validNativeExecutable(candidate, platform)) return candidate;
  }
  return null;
}

function resolvePowerShellOnWindowsPath() {
  if (process.platform !== "win32") return null;
  for (const raw of (process.env.PATH ?? "").split(delimiter)) {
    const directory = raw.replace(/"/g, "");
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = join(directory, "pwsh.exe");
    if (validNativeExecutable(candidate, "win32")) return candidate;
  }
  return null;
}

// Safety caps.
const TIMEOUT_MS = 10 * 60 * 1000; // kill a stuck Claude
const MAX_OUTPUT_CHARS = 2 * 1024 * 1024; // max answer size
const MAX_CONCURRENT = 4; // max parallel Claudes
const MAX_LINE_CHARS = 8 * 1024 * 1024; // max protocol line size
let running = 0;

// Every Claude call runs in the folder this server started in.
const SERVER_CWD = process.cwd();

const COMMON_DESCRIPTION =
  "Claude sees the repo on disk, so refer to files by path. Send one self-contained " +
  "instruction. Claude has no memory of your conversation.";

function selectorSchema(description) {
  return { type: "string", minLength: 1, description };
}

function effortSchema(values, description) {
  return { type: "string", enum: values, description };
}

function claudePromptSchema(description) {
  return {
    type: "object",
    properties: {
      prompt: { type: "string", description },
      model: selectorSchema("Optional Claude model ID. Overrides the configured Claude default."),
      effort: effortSchema([...CLAUDE_EFFORTS], "Optional Claude reasoning effort. Overrides the configured Claude default."),
    },
    required: ["prompt"],
    additionalProperties: false,
  };
}

const GROK_PROMPT_SCHEMA = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "A complete, self-contained instruction for the selected agent.",
    },
    model: selectorSchema("Optional Grok model ID. Overrides the configured Grok default."),
    effort: {
      type: "string",
      minLength: 1,
      pattern: GROK_EFFORT_PATTERN.source,
      description: "Optional Grok reasoning effort or documented model-menu identifier. Overrides the configured Grok default.",
    },
  },
  required: ["prompt"],
  additionalProperties: false,
};

const CLINE_PROMPT_SCHEMA = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "A complete, self-contained instruction for the selected agent.",
    },
    provider: selectorSchema("Optional Cline provider ID. Overrides the configured Cline default."),
    model: selectorSchema("Optional Cline model ID. Overrides the configured Cline default."),
    effort: effortSchema([...CLINE_EFFORTS], "Optional Cline thinking effort. Overrides the configured Cline default."),
  },
  required: ["prompt"],
  additionalProperties: false,
};

function resolveExecutionSelectors(toolName, args) {
  const agent = toolName.includes("claude") ? "claude" : toolName.includes("grok") ? "grok" : "cline";
  const fields = agent === "cline" ? ["provider", "model", "effort"] : ["model", "effort"];
  const selected = {};
  for (const field of fields) {
    const callerValue = Object.prototype.hasOwnProperty.call(args, field) ? args[field] : undefined;
    const value = callerValue === undefined ? FRENEMY_CONFIG.agents[agent][field] : callerValue;
    if (value === undefined) continue;
    if (!validSelector(value)) throw new Error(`${toolName}: invalid ${field}`);
    if (field === "effort") {
      const accepted = agent === "claude"
        ? CLAUDE_EFFORTS.has(value)
        : agent === "cline"
          ? CLINE_EFFORTS.has(value)
          : GROK_EFFORT_PATTERN.test(value);
      if (!accepted) throw new Error(`${toolName}: invalid ${field}`);
    }
    selected[field] = value;
  }
  return selected;
}

function appendSelectorArgs(args, agent, selectors) {
  const flags = agent === "claude"
    ? { model: "--model", effort: "--effort" }
    : agent === "grok"
      ? { model: "--model", effort: "--reasoning-effort" }
      : { effort: "--thinking" };
  for (const [field, flag] of Object.entries(flags)) {
    if (selectors[field] !== undefined) args.push(flag, selectors[field]);
  }
  return args;
}

// The six tools Codex gets.
const TOOLS = [
  {
    name: "ask_claude",
    description:
      "Ask Claude Code a question about this repo and return its answer. File-editing " +
      "tools and the shell are disabled for this call. Use for code review, second " +
      "opinions, and explanations. " + COMMON_DESCRIPTION,
    inputSchema: claudePromptSchema("A complete, self-contained instruction for Claude."),
  },
  {
    name: "ask_claude_write",
    description:
      "Ask Claude Code to make changes in this repo (refactors, fixes, new code). " +
      "Claude MAY edit files. " + COMMON_DESCRIPTION,
    inputSchema: claudePromptSchema("A complete, self-contained instruction for Claude."),
  },
  {
    name: "ask_grok",
    description: "Ask Grok Build a question about the current workspace. File edits are disabled.",
    inputSchema: GROK_PROMPT_SCHEMA,
  },
  {
    name: "ask_grok_write",
    description: "Ask Grok Build to make changes. This call may edit files.",
    inputSchema: GROK_PROMPT_SCHEMA,
  },
  {
    name: "ask_cline",
    description: "Ask Cline CLI a question about the current workspace. File edits are disabled.",
    inputSchema: CLINE_PROMPT_SCHEMA,
  },
  {
    name: "ask_cline_write",
    description: "Ask Cline CLI to make changes. This call may edit files.",
    inputSchema: CLINE_PROMPT_SCHEMA,
  },
];

const CLINE_READ_TOOLS = new Set(["Read", "Glob", "Grep", "read_files", "search_codebase"]);
const CLINE_WRITE_TOOLS = new Set(["Edit", "Write", "editor", "apply_patch"]);
const CLINE_DENIED_TOOLS = new Set([
  "Bash", "run_commands", "WebFetch", "fetch_web_content", "WebSearch",
  "web_search", "Agent", "spawn_agent", "MCPTool", "Delete", "Move",
]);

// Start Claude, send the prompt, return the answer.
function runClaude({ prompt, model, effort }, write) {
  return new Promise((resolve) => {
    if (running >= MAX_CONCURRENT) {
      return resolve({
        ok: false,
        text: `Too many Claude calls at once (limit ${MAX_CONCURRENT}). Try again in a moment.`,
      });
    }
    running++;

    // Prompt goes in via stdin, so it never shows in the process list.
    const args = ["-p", "--output-format", "json"];
    appendSelectorArgs(args, "claude", { model, effort });
    if (write) {
      // Write mode: edits auto-accepted; only user-level settings load,
      // so a cloned repo's own hooks/plugins can't join the run.
      args.push("--permission-mode", "acceptEdits");
      args.push("--setting-sources", "user");
    } else {
      // Read mode, enforced: safe mode + side-effect tools disabled.
      // Subagents stay available and inherit the bans.
      args.push("--safe-mode");
      args.push(
        "--disallowedTools",
        "Bash", "Edit", "Write", "NotebookEdit",
        "WebFetch", "WebSearch"
      );
      args.push("--strict-mcp-config");
    }

    if (!CLAUDE_CMD) {
      running--;
      return resolve({
        ok: false,
        text: "claude.exe was not found on PATH. Install Claude Code with the native Windows installer.",
      });
    }

    // Never launched through a shell; on Windows this is an absolute path.
    const child = spawn(CLAUDE_CMD, args, {
      cwd: SERVER_CWD,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    let out = "";
    let err = "";
    let done = false;

    // Report back exactly once, whatever happens.
    const finish = (result) => {
      if (done) return;
      done = true;
      running--;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, text: `claude timed out after ${TIMEOUT_MS / 60000} minutes.` });
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => {
      out += d;
      if (out.length > MAX_OUTPUT_CHARS) {
        child.kill("SIGKILL");
        finish({ ok: false, text: "claude produced more output than the ~2 MB cap; aborted." });
      }
    });
    child.stderr.on("data", (d) => {
      if (err.length < MAX_OUTPUT_CHARS) err += d;
    });

    child.on("error", (e) =>
      finish({ ok: false, text: `Failed to launch claude: ${e.message}` })
    );

    // Unpack Claude's JSON answer, or explain what went wrong.
    child.on("close", (code) => {
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) {
          finish({ ok: false, text: parsed.result || "Claude reported an error." });
        } else {
          finish({ ok: true, text: parsed.result ?? "" });
        }
      } catch {
        finish({
          ok: false,
          text: `claude exited ${code} and returned no usable JSON.\n${err || out}`.trim(),
        });
      }
    });

    // If Claude exits before reading the prompt, don't crash the relay.
    child.stdin.on("error", () => {});
    child.stdin.write(String(prompt ?? ""));
    child.stdin.end();
  });
}

function runCapturedProcess(command, args, { cwd, deadline, stdin = null }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const fail = (error) => {
      if (!child.killed) child.kill("SIGKILL");
      finish(reject, error);
    };
    const timer = setTimeout(
      () => fail(new Error(`timed out after ${TIMEOUT_MS / 60000} minutes`)),
      Math.max(1, deadline - Date.now()),
    );
    child.once("error", (error) => fail(new Error(`launch failure: ${error.message}`)));
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_CHARS) fail(new Error("stdout overflow"));
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT_CHARS) fail(new Error("stderr overflow"));
    });
    child.once("close", (code) => finish(resolve, { code, stdout, stderr }));
    child.stdin.once("error", () => {});
    if (stdin !== null) child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function runNativeTool(toolName, operation) {
  if (running >= MAX_CONCURRENT) {
    return {
      ok: false,
      text: `${toolName}: too many agent calls at once (limit ${MAX_CONCURRENT}). Try again in a moment.`,
    };
  }
  running++;
  const deadline = Date.now() + TIMEOUT_MS;
  try {
    return { ok: true, text: await operation(deadline) };
  } catch (error) {
    return { ok: false, text: `${toolName}: ${error.message}` };
  } finally {
    running--;
  }
}

function expectedGrokArgs(write, promptPath, selectors = {}) {
  const common = ["--no-auto-update", "--verbatim", "--prompt-file", promptPath, "--output-format", "json"];
  const mode = write
    ? ["--permission-mode", "acceptEdits", "--tools", "read_file,grep,list_dir,Edit,Write", "--allow", "Edit", "--allow", "Write"]
    : ["--permission-mode", "dontAsk", "--tools", "read_file,grep,list_dir", "--deny", "Edit", "--deny", "Write"];
  const denied = ["--deny", "Bash", "--deny", "MCPTool", "--deny", "WebFetch", "--deny", "WebSearch", "--disable-web-search"];
  return appendSelectorArgs(
    [...common, ...mode, ...denied, ...(process.platform === "linux" && !write ? ["--sandbox", "read-only"] : [])],
    "grok",
    selectors,
  );
}

async function protectGrokPrompt(ownedDirectory, promptPath, deadline) {
  if (Date.now() >= deadline) throw new Error(`timed out after ${TIMEOUT_MS / 60000} minutes`);
  if (process.platform === "win32") {
    const powerShell = resolvePowerShellOnWindowsPath();
    const helperPath = join(RELAY_DIR, "Protect-GrokPrompt.ps1");
    if (!powerShell) throw new Error("PowerShell executable unavailable before prompt write");
    if (!existsSync(helperPath)) throw new Error("prompt protection helper unavailable before prompt write");
    const result = await runCapturedProcess(powerShell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File", helperPath,
      "-OwnedDirectory", ownedDirectory, "-PromptPath", promptPath,
    ], { cwd: RELAY_DIR, deadline });
    if (result.code !== 0) {
      throw new Error(`prompt protection failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
    }
    return;
  }
  await mkdir(ownedDirectory, { recursive: false, mode: 0o700 });
  await chmod(ownedDirectory, 0o700);
  await writeFile(promptPath, "", { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(promptPath, 0o600);
  if (Date.now() >= deadline) throw new Error(`timed out after ${TIMEOUT_MS / 60000} minutes`);
}

async function runGrok({ prompt, model, effort }, write, toolName) {
  return runNativeTool(toolName, async (deadline) => {
    if (process.platform !== "win32" && process.platform !== "linux") {
      throw new Error("unsupported platform");
    }
    const executable = resolveNativeExecutable("grok", GROK_OVERRIDE);
    if (!executable) throw new Error("executable unavailable");
    const ownedDirectory = join(tmpdir(), `frenemy-grok-${randomUUID()}`);
    const promptPath = join(ownedDirectory, "prompt.txt");
    let resultText;
    let caughtError;
    try {
      await protectGrokPrompt(ownedDirectory, promptPath, deadline);
      await writeFile(promptPath, prompt, { encoding: "utf8", flag: "r+" });
      const result = await runCapturedProcess(
        executable,
        expectedGrokArgs(write, promptPath, { model, effort }),
        { cwd: SERVER_CWD, deadline },
      );
      if (result.code !== 0) throw new Error(`native failure (${result.code}): ${result.stderr || `exit ${result.code}`}`);
      let parsed;
      try {
        parsed = JSON.parse(result.stdout);
      } catch (error) {
        throw new Error(`invalid output: ${error.message}`);
      }
      if (parsed?.error) throw new Error(`native failure: ${parsed.error.message ?? parsed.error}`);
      if (["max_tokens", "max_turn_requests", "cancelled"].includes(parsed?.stopReason)) {
        throw new Error(`incomplete output: ${parsed.stopReason}`);
      }
      if (!["end_turn", "refusal"].includes(parsed?.stopReason)) {
        throw new Error(`invalid output: ${parsed?.stopReason ?? "missing stop reason"}`);
      }
      if (typeof parsed.text !== "string" || parsed.text.length === 0) {
        throw new Error("invalid output: missing text");
      }
      if (parsed.text.length > MAX_OUTPUT_CHARS) throw new Error("final answer overflow");
      resultText = parsed.text;
    } catch (error) {
      caughtError = error;
    }
    try {
      await rm(ownedDirectory, { recursive: true, force: true });
    } catch (error) {
      const prefix = caughtError ? `${caughtError.message}; ` : "";
      caughtError = new Error(`${prefix}cleanup failure; residue: ${ownedDirectory}; ${error.message}`);
    }
    if (caughtError) throw caughtError;
    return resultText;
  });
}

function clineTitleToken(title) {
  if (typeof title !== "string") return null;
  return title.split(": ", 1)[0];
}

function hasValidClineInput(tool, rawInput) {
  if (rawInput === null || rawInput === undefined) return false;
  if (["Read", "Glob", "Grep", "Edit", "Write"].includes(tool)) {
    return typeof rawInput === "object" && !Array.isArray(rawInput);
  }
  if (["read_files", "search_codebase"].includes(tool)) {
    return typeof rawInput === "string" || Array.isArray(rawInput) || typeof rawInput === "object";
  }
  if (tool === "apply_patch") {
    return (typeof rawInput === "string" && rawInput.length > 0)
      || (typeof rawInput === "object" && typeof rawInput.input === "string" && rawInput.input.length > 0);
  }
  if (tool === "editor") {
    if (typeof rawInput !== "object" || Array.isArray(rawInput)) return false;
    if (typeof rawInput.path !== "string" || rawInput.path.length === 0 || typeof rawInput.new_text !== "string") return false;
    if (rawInput.old_text !== undefined && rawInput.old_text !== null && typeof rawInput.old_text !== "string") return false;
    if (rawInput.insert_line === undefined || rawInput.insert_line === null) return true;
    if (Number.isSafeInteger(rawInput.insert_line)) return rawInput.insert_line > 0;
    return typeof rawInput.insert_line === "string" && /^[1-9][0-9]*$/.test(rawInput.insert_line);
  }
  return false;
}

function decideClinePermission(params, sessionId, write) {
  if (!params || !Array.isArray(params.options)) {
    return { outcome: { outcome: "cancelled" } };
  }
  const call = params.toolCall ?? params.subject?.toolCall;
  const tool = clineTitleToken(call?.title ?? params.title);
  const kind = call?.kind ?? params.subject?.kind;
  const rawInput = call?.rawInput ?? params.subject?.rawInput;
  const readAllowed = params.sessionId === sessionId
    && CLINE_READ_TOOLS.has(tool)
    && (kind === "read" || kind === "search")
    && hasValidClineInput(tool, rawInput);
  const writeAllowed = write
    && CLINE_WRITE_TOOLS.has(tool)
    && ((tool === "apply_patch" && kind === "other") || (tool !== "apply_patch" && kind === "edit"))
    && hasValidClineInput(tool, rawInput);
  const allowed = !CLINE_DENIED_TOOLS.has(tool) && (readAllowed || writeAllowed);
  const optionKind = allowed ? "allow_once" : "reject_once";
  const option = params.options.find((candidate) => candidate?.kind === optionKind && typeof candidate.optionId === "string");
  return option
    ? { outcome: { outcome: "selected", optionId: option.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

async function runClineAcp(executable, prompt, write, deadline, selectors = {}) {
  const args = ["--acp", "--auto-approve", "false", "--cwd", SERVER_CWD];
  appendSelectorArgs(args, "cline", selectors);
  const env = { ...process.env };
  if (selectors.provider !== undefined) env.CLINE_PROVIDER = selectors.provider;
  if (selectors.model !== undefined) env.CLINE_MODEL = selectors.model;
  const child = spawn(executable, args, { cwd: SERVER_CWD, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdoutCount = 0;
  let stderrCount = 0;
  let stderr = "";
  let buffer = "";
  let answer = "";
  let sessionId = null;
  let nextId = 1;
  let terminal = false;
  const pending = new Map();
  const terminate = () => {
    if (!child.killed) child.kill("SIGKILL");
  };
  const failPending = (error) => {
    if (terminal) return;
    terminal = true;
    terminate();
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    try {
      send({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
  const timer = setTimeout(
    () => failPending(new Error(`timed out after ${TIMEOUT_MS / 60000} minutes`)),
    Math.max(1, deadline - Date.now()),
  );
  const exited = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  child.once("error", (error) => failPending(new Error(`launch failure: ${error.message}`)));
  child.once("close", (code) => {
    if (pending.size > 0) failPending(new Error(`native failure: exited ${code}; ${stderr}`));
  });
  child.stderr.on("data", (chunk) => {
    stderrCount += chunk.length;
    stderr = `${stderr}${chunk}`.slice(-MAX_OUTPUT_CHARS);
    if (stderrCount > MAX_OUTPUT_CHARS) failPending(new Error("stderr overflow"));
  });
  child.stdout.on("data", (chunk) => {
    if (terminal) return;
    stdoutCount += chunk.length;
    if (stdoutCount > MAX_OUTPUT_CHARS) {
      failPending(new Error("stdout overflow"));
      return;
    }
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        failPending(new Error(`invalid output: ${error.message}`));
        continue;
      }
      if (message.method === "session/update") {
        const update = message.params?.update;
        if (message.params?.sessionId === sessionId
            && update?.sessionUpdate === "agent_message_chunk"
            && update.content?.type === "text") {
          answer += update.content.text;
          if (answer.length > MAX_OUTPUT_CHARS) failPending(new Error("final answer overflow"));
        }
        continue;
      }
      if (message.method && message.id !== undefined) {
        if (message.method === "session/request_permission") {
          const decision = decideClinePermission(message.params, sessionId, write);
          send({ jsonrpc: "2.0", id: message.id, result: { outcome: decision.outcome } });
        } else {
          send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unsupported client method: ${message.method}` } });
        }
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(`native failure (${entry.method}): ${message.error.message ?? "native error"}`));
        else entry.resolve(message.result);
      }
    }
  });
  child.stdin.once("error", () => {});
  try {
    const initialize = await request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    if (initialize?.protocolVersion !== 1) throw new Error(`protocol error: selected version ${initialize?.protocolVersion}`);
    const created = await request("session/new", { cwd: SERVER_CWD, mcpServers: [] });
    sessionId = created?.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("protocol error: missing session ID");
    const result = await request("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] });
    if (["max_tokens", "max_turn_requests", "refusal", "cancelled"].includes(result?.stopReason)) {
      throw new Error(`incomplete output: ${result.stopReason}`);
    }
    if (result?.stopReason !== "end_turn") throw new Error(`protocol error: ${result?.stopReason ?? "missing stop reason"}`);
    if (answer.length === 0) throw new Error("protocol error: end_turn without attributable answer text");
    terminal = true;
    clearTimeout(timer);
    child.stdin.end();
    terminate();
    await exited;
    return answer;
  } finally {
    clearTimeout(timer);
    terminate();
  }
}

async function runCline({ prompt, provider, model, effort }, write, toolName) {
  return runNativeTool(toolName, async (deadline) => {
    if (process.platform !== "win32" && process.platform !== "linux") {
      throw new Error("unsupported platform");
    }
    const executable = resolveNativeExecutable("cline", CLINE_OVERRIDE);
    if (!executable) throw new Error("executable unavailable");
    return runClineAcp(executable, prompt, write, deadline, { provider, model, effort });
  });
}

// Strip terminal control sequences (keep newline and tab) and redact private
// key blocks before Claude's output enters Codex's context. The key redaction
// is best effort only; do not rely on it to prevent secret leakage.
function sanitize(text) {
  let t = String(text);
  t = t.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, ""); // OSC sequences
  t = t.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, ""); // CSI sequences
  t = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""); // stray controls, incl. lone ESC
  t = t.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[frenemy: private key block redacted]"
  );
  return t;
}

// --- MCP plumbing: JSON messages over stdin/stdout, one per line.

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

async function handle(msg) {
  const { id, method, params } = msg;

  // No id means notification. Never reply to those.
  if (id === undefined) return;

  if (method === "ping") {
    return reply(id, {});
  }

  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "frenemy", version: "1.4.0" },
    });
  }

  if (method === "tools/list") {
    return reply(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) {
      return reply(id, {
        content: [{ type: "text", text: `Unknown tool: ${params?.name}` }],
        isError: true,
      });
    }
    const args = isPlainObject(params?.arguments) ? params.arguments : {};
    if (FRENEMY_CONFIG_ERROR) {
      return reply(id, {
        content: [{ type: "text", text: FRENEMY_CONFIG_ERROR }],
        isError: true,
      });
    }
    let selectors;
    try {
      selectors = resolveExecutionSelectors(tool.name, args);
    } catch (error) {
      return reply(id, {
        content: [{ type: "text", text: error.message }],
        isError: true,
      });
    }
    const executionArgs = { ...args, ...selectors };
    let result;
    if (tool.name === "ask_claude" || tool.name === "ask_claude_write") {
      result = await runClaude(executionArgs, tool.name === "ask_claude_write");
    } else {
      if (typeof args.prompt !== "string" || args.prompt.trim().length === 0) {
        return reply(id, {
          content: [{ type: "text", text: `${tool.name}: invalid prompt` }],
          isError: true,
        });
      }
      if (tool.name === "ask_grok" || tool.name === "ask_grok_write") {
        result = await runGrok(executionArgs, tool.name === "ask_grok_write", tool.name);
      } else {
        result = await runCline(executionArgs, tool.name === "ask_cline_write", tool.name);
      }
    }
    const { ok, text } = result;
    return reply(id, { content: [{ type: "text", text: sanitize(text) }], isError: !ok });
  }

  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
}

// Read messages line by line; overlong lines get dropped, not buffered forever.
let buffer = "";
let discarding = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const rawLine = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (discarding) {
      discarding = false; // this newline ends the dropped line
      continue;
    }
    if (rawLine.length > MAX_LINE_CHARS) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Input line too long; discarded." } });
      continue;
    }
    const line = rawLine.trim();
    if (!line) continue;
    try {
      handle(JSON.parse(line)).catch(() => {}); // one bad call must not kill the relay
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
  }
  if (discarding) {
    buffer = "";
  } else if (buffer.length > MAX_LINE_CHARS) {
    buffer = "";
    discarding = true;
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Input line too long; discarded." } });
  }
});
