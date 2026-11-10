/**
 * @file Controlled native-process provider preloaded into the production relay.
 * @change 2026-11-06 TEST-FRENEMY-114, TEST-FRENEMY-115,
 * AC-TEST-FRENEMY-114-01 through AC-TEST-FRENEMY-115-06: Added deterministic
 * Grok, Cline, Claude, failure, permission, and lifecycle fixtures without a
 * production-only test seam.
 * @change 2026-11-06 TEST-FRENEMY-116, AC-TEST-FRENEMY-116-02: Added
 * read-only observations for startup config reads, executable discovery, and
 * child-only Cline ACP provider/model environment selection.
 */
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { PassThrough } from "node:stream";

const logPath = process.env.FRENEMY_STUB_LOG;
const config = JSON.parse(process.env.FRENEMY_STUB_CONFIG ?? "{}");

function record(value) {
  if (logPath) fs.appendFileSync(logPath, `${JSON.stringify(value)}\n`, "utf8");
}

const nativeReadFileSync = fs.readFileSync.bind(fs);
fs.readFileSync = (path, ...args) => {
  if (basename(String(path)) === "frenemy.config.json") record({ event: "config-read", path: String(path) });
  return nativeReadFileSync(path, ...args);
};

const nativeExistsSync = fs.existsSync.bind(fs);
fs.existsSync = (path) => {
  if (config.missingDefaultConfig && basename(String(path)) === "frenemy.config.json") return false;
  return nativeExistsSync(path);
};

const nativeStatSync = fs.statSync.bind(fs);
fs.statSync = (path, ...args) => {
  record({ event: "executable-discovery", path: String(path) });
  return nativeStatSync(path, ...args);
};

if (config.platform) {
  Object.defineProperty(process, "platform", { configurable: true, value: config.platform });
}

if (Number.isSafeInteger(config.timeoutMilliseconds) && config.timeoutMilliseconds > 0) {
  const nativeSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
    callback,
    delay >= 9 * 60 * 1000 ? config.timeoutMilliseconds : delay,
    ...args,
  );
}

class StubChild extends EventEmitter {
  constructor(target) {
    super();
    this.target = target;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new PassThrough();
    this.killed = false;
    this.closed = false;
  }

  close(code = 0, signal = null) {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => {
      this.stdout.end();
      this.stderr.end();
      this.emit("close", code, signal);
    });
  }

  kill(signal = "SIGTERM") {
    if (this.killed) return false;
    this.killed = true;
    record({ event: "kill", target: this.target, signal });
    this.close(null, signal);
    return true;
  }
}

function emitLine(child, value) {
  child.stdout.write(`${JSON.stringify(value)}\n`);
}

function configurePowerShell(child, args) {
  if (config.helperScenario === "spawn-error") {
    queueMicrotask(() => child.emit("error", new Error("controlled helper spawn failure")));
    return;
  }
  if (config.helperScenario === "nonzero") {
    child.stderr.write("controlled helper failure");
    child.close(5);
    return;
  }
  const directoryIndex = args.indexOf("-OwnedDirectory");
  const promptIndex = args.indexOf("-PromptPath");
  const ownedDirectory = args[directoryIndex + 1];
  const promptPath = args[promptIndex + 1];
  fs.mkdirSync(ownedDirectory, { recursive: false, mode: 0o700 });
  fs.writeFileSync(promptPath, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  record({ event: "prompt-protected", ownedDirectory, promptPath });
  child.close(0);
}

function configureGrok(child, args) {
  const promptPath = args[args.indexOf("--prompt-file") + 1];
  const prompt = fs.readFileSync(promptPath);
  record({
    event: "grok-prompt",
    promptPath,
    text: prompt.toString("utf8"),
    hex: prompt.toString("hex"),
  });
  const scenario = config.grokScenario ?? "success";
  queueMicrotask(() => {
    if (scenario === "spawn-error") {
      child.emit("error", new Error("controlled spawn failure"));
      return;
    }
    if (scenario === "hang") return;
    if (scenario === "stdout-overflow") {
      child.stdout.write("x".repeat((2 * 1024 * 1024) + 1));
      return;
    }
    if (scenario === "stderr-overflow") {
      child.stderr.write("x".repeat((2 * 1024 * 1024) + 1));
      return;
    }
    if (scenario === "stderr-at-limit") {
      child.stderr.write("x".repeat(2 * 1024 * 1024));
    }
    if (scenario === "invalid-json") child.stdout.write("not-json");
    else if (scenario === "native-error") child.stdout.write(JSON.stringify({ error: { message: "controlled native failure" } }));
    else {
      const stopReason = {
        "unknown-stop": "unknown",
        "max-tokens": "max_tokens",
        "max-turn-requests": "max_turn_requests",
        cancelled: "cancelled",
        refusal: "refusal",
      }[scenario] ?? "end_turn";
      const text = scenario === "empty-text"
        ? ""
        : (Number.isSafeInteger(config.grokTextLength)
            ? "x".repeat(config.grokTextLength)
            : (config.grokText ?? (scenario === "refusal" ? "refused" : "grok answer")));
      child.stdout.write(JSON.stringify({ stopReason, text }));
    }
    if (config.grokStderr) child.stderr.write(config.grokStderr);
    child.close(scenario === "nonzero" ? 7 : 0);
  });
}

function configureClaude(child) {
  let prompt = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => { prompt += chunk; });
  child.stdin.on("end", () => {
    record({ event: "claude-prompt", prompt });
    const result = config.claudeText ?? `claude:${prompt}`;
    child.stdout.write(JSON.stringify({ is_error: false, result }));
    child.close(0);
  });
}

function configureCline(child) {
  let buffer = "";
  let promptRequest = null;
  const permissionIds = new Set();
  const permissionRequests = Array.isArray(config.permissions) ? config.permissions : [];
  const clientRequests = Array.isArray(config.clientRequests) ? config.clientRequests : [];

  const finishPrompt = () => {
    if (!promptRequest || permissionIds.size > 0) return;
    const chunks = config.generatedChunks
      ? Array.from({ length: config.generatedChunks.count }, () => "x".repeat(config.generatedChunks.size))
      : (config.clineChunks ?? ["one", " two", " three"]);
    for (const text of chunks) {
      if (child.killed) break;
      emitLine(child, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
        },
      });
    }
    if (config.otherSessionChunk) {
      emitLine(child, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "other-session",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ignored" } },
        },
      });
    }
    if (config.thoughtChunk) {
      emitLine(child, {
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "session-1", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "ignored" } } },
      });
    }
    const id = config.mismatchedPromptId ? promptRequest.id + 100 : promptRequest.id;
    if (config.promptError) {
      emitLine(child, { jsonrpc: "2.0", id, error: { code: -32000, message: "controlled prompt failure" } });
    } else {
      emitLine(child, {
        jsonrpc: "2.0",
        id,
        result: { stopReason: config.stopReason ?? "end_turn" },
      });
    }
    if (config.mismatchedPromptId) child.close(9);
  };

  const sendPermissionRequests = () => {
    permissionRequests.forEach((request, index) => {
      const id = 1000 + index;
      permissionIds.add(id);
      emitLine(child, {
        jsonrpc: "2.0",
        id,
        method: "session/request_permission",
        params: {
          sessionId: request.sessionId ?? "session-1",
          options: request.options ?? [
            { optionId: `allow-${index}`, kind: "allow_once" },
            { optionId: `reject-${index}`, kind: "reject_once" },
          ],
          toolCall: request.toolCall,
          ...(request.params ?? {}),
        },
      });
    });
    clientRequests.forEach((request, index) => {
      emitLine(child, { jsonrpc: "2.0", id: 2000 + index, method: request.method, params: request.params ?? {} });
    });
    if (permissionRequests.length === 0) finishPrompt();
  };

  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      record({ event: "cline-message", message });
      if (permissionIds.has(message.id)) {
        permissionIds.delete(message.id);
        finishPrompt();
        continue;
      }
      if (message.id >= 2000) continue;
      if (message.method === "initialize") {
        if (config.errorMethod === "initialize") emitLine(child, { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "controlled initialize failure" } });
        else emitLine(child, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: config.protocolVersion ?? 1 } });
      } else if (message.method === "session/new") {
        if (config.errorMethod === "session/new") emitLine(child, { jsonrpc: "2.0", id: message.id, error: { code: -32001, message: config.authRequired ? "authRequired" : "controlled new-session failure" } });
        else emitLine(child, { jsonrpc: "2.0", id: message.id, result: { sessionId: config.sessionId ?? "session-1" } });
      } else if (message.method === "session/prompt") {
        promptRequest = message;
        if (config.hang) continue;
        sendPermissionRequests();
      }
    }
  });
}

childProcess.spawn = (command, args = [], options = {}) => {
  const file = basename(command).toLowerCase();
  const target = args.some((value) => typeof value === "string" && value.endsWith("Protect-GrokPrompt.ps1")) ? "prompt-helper"
    : args.includes("--prompt-file") ? "grok"
      : args.includes("--acp") ? "cline"
        : args[0] === "-p" ? "claude"
          : file;
  const child = new StubChild(target);
  record({
    event: "spawn",
    target,
    command,
    args,
    options: {
      cwd: options.cwd,
      shell: options.shell ?? false,
      env: target === "cline"
        ? { CLINE_PROVIDER: options.env?.CLINE_PROVIDER, CLINE_MODEL: options.env?.CLINE_MODEL }
        : undefined,
    },
  });
  if (target === "prompt-helper") configurePowerShell(child, args);
  else if (target === "grok") configureGrok(child, args);
  else if (target === "cline") configureCline(child);
  else if (target === "claude") configureClaude(child);
  else queueMicrotask(() => child.emit("error", new Error(`Unexpected controlled spawn: ${command}`)));
  return child;
};

syncBuiltinESMExports();
