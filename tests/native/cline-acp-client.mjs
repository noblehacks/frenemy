/**
 * @file Test-side ACP client used to qualify the selected native Cline CLI.
 * @change 2026-11-06 FR-FRENEMY-114, TEST-FRENEMY-114, AC-FRENEMY-114-02,
 * AC-FRENEMY-114-03, AC-FRENEMY-114-04: Added protocol-1 initialization,
 * one-session prompt handling, exact permission-option echoing, bounded streams,
 * and attributable answer collection before production adapter implementation.
 * @change 2026-11-06 FR-FRENEMY-114, TEST-FRENEMY-114,
 * AC-FRENEMY-114-04: Retained a bounded ACP transcript and stderr tail in
 * qualification errors so protocol-shape failures remain attributable.
 * @change 2026-11-06 FR-FRENEMY-114, TEST-FRENEMY-114,
 * AC-FRENEMY-114-04: Replaced raw ACP transcript retention with bounded event
 * summaries so large configuration option payloads cannot hide the event sequence.
 * @change 2026-11-06 FR-FRENEMY-116, TR-FRENEMY-CONFIG-120,
 * TEST-FRENEMY-116, AC-FRENEMY-116-03: Added explicit test-side Cline ACP
 * provider/model child environment and --thinking effort inputs.
 */
import { spawn } from "node:child_process";

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "read_files", "search_codebase"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "editor", "apply_patch"]);
const DENIED_TOOLS = new Set(["Bash", "run_commands", "WebFetch", "fetch_web_content", "WebSearch", "web_search", "Agent", "spawn_agent", "MCPTool", "Delete", "Move"]);

function titleToken(title) {
  if (typeof title !== "string") return null;
  return title.split(": ", 1)[0];
}

function hasValidInput(tool, rawInput) {
  if (rawInput === null || rawInput === undefined) return false;
  if (["Read", "Glob", "Grep", "Edit", "Write"].includes(tool)) return typeof rawInput === "object" && !Array.isArray(rawInput);
  if (["read_files", "search_codebase"].includes(tool)) return typeof rawInput === "string" || Array.isArray(rawInput) || typeof rawInput === "object";
  if (tool === "apply_patch") return (typeof rawInput === "string" && rawInput.length > 0) || (typeof rawInput === "object" && typeof rawInput.input === "string" && rawInput.input.length > 0);
  if (tool === "editor") {
    if (typeof rawInput !== "object" || Array.isArray(rawInput) || typeof rawInput.path !== "string" || rawInput.path.length === 0 || typeof rawInput.new_text !== "string") return false;
    if (rawInput.old_text !== undefined && rawInput.old_text !== null && typeof rawInput.old_text !== "string") return false;
    if (rawInput.insert_line === undefined || rawInput.insert_line === null) return true;
    if (Number.isSafeInteger(rawInput.insert_line)) return rawInput.insert_line > 0;
    return typeof rawInput.insert_line === "string" && /^[1-9][0-9]*$/.test(rawInput.insert_line);
  }
  return false;
}

function summarizeClineMessage(message, pending) {
  if (message.method === "session/update") {
    const update = message.params?.update;
    return {
      method: message.method,
      sessionId: message.params?.sessionId,
      update: update?.sessionUpdate,
      contentType: update?.content?.type,
      text: typeof update?.content?.text === "string" ? update.content.text.slice(0, 512) : undefined,
      configId: update?.configId,
      optionCount: Array.isArray(update?.options) ? update.options.length : undefined,
    };
  }
  if (message.method) {
    const call = message.params?.toolCall ?? message.params?.subject?.toolCall;
    return { method: message.method, id: message.id, tool: call?.title, kind: call?.kind ?? message.params?.subject?.kind };
  }
  const result = message.result;
  return {
    id: message.id,
    responseTo: pending.get(message.id)?.method,
    error: message.error?.message,
    resultKeys: result && typeof result === "object" ? Object.keys(result) : [],
    protocolVersion: result?.protocolVersion,
    sessionId: result?.sessionId,
    stopReason: result?.stopReason,
  };
}

/** Returns the exact offered ACP permission option selected by the test policy. */
export function decideClinePermission(params, sessionId, write) {
  if (!params || params.sessionId !== sessionId || !Array.isArray(params.options)) return { outcome: { outcome: "cancelled" }, allowed: false, tool: null };
  const call = params.toolCall ?? params.subject?.toolCall;
  const tool = titleToken(call?.title ?? params.title);
  const kind = call?.kind ?? params.subject?.kind;
  const rawInput = call?.rawInput ?? params.subject?.rawInput;
  const readAllowed = READ_TOOLS.has(tool) && (kind === "read" || kind === "search") && hasValidInput(tool, rawInput);
  const writeAllowed = write && WRITE_TOOLS.has(tool) && ((tool === "apply_patch" && kind === "other") || (tool !== "apply_patch" && kind === "edit")) && hasValidInput(tool, rawInput);
  const allowed = !DENIED_TOOLS.has(tool) && (readAllowed || writeAllowed);
  const desiredKind = allowed ? "allow_once" : "reject_once";
  const option = params.options.find((candidate) => candidate?.kind === desiredKind && typeof candidate.optionId === "string");
  if (!option) return { outcome: { outcome: "cancelled" }, allowed: false, tool };
  return { outcome: { outcome: "selected", optionId: option.optionId }, allowed, tool };
}

/** Runs one Cline ACP prompt with bounded streams and a fail-closed client surface. */
export async function runClineAcp({ executable, cwd, prompt, write, provider, model, effort, timeoutMs = 600000, maxChars = 2097152 }) {
  const args = ["--acp", "--auto-approve", "false", "--cwd", cwd];
  if (effort !== undefined) args.push("--thinking", effort);
  const env = { ...process.env };
  if (provider !== undefined) env.CLINE_PROVIDER = provider;
  if (model !== undefined) env.CLINE_MODEL = model;
  const child = spawn(executable, args, { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdoutCount = 0;
  let stderrCount = 0;
  let stderr = "";
  let buffer = "";
  const events = [];
  let answer = "";
  let sessionId = null;
  let nextId = 1;
  const permissions = [];
  const pending = new Map();

  const terminate = () => {
    if (!child.killed) child.kill("SIGKILL");
  };
  const failPending = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    send({ jsonrpc: "2.0", id, method, params });
  });

  const timer = setTimeout(() => {
    terminate();
    failPending(new Error("Cline ACP timed out."));
  }, timeoutMs);

  const exited = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  child.once("error", (error) => failPending(error));
  child.stderr.on("data", (chunk) => {
    stderrCount += chunk.length;
    stderr = `${stderr}${chunk}`.slice(-8192);
    if (stderrCount > maxChars) {
      terminate();
      failPending(new Error("Cline stderr overflow."));
    }
  });
  child.stdout.on("data", (chunk) => {
    stdoutCount += chunk.length;
    if (stdoutCount > maxChars) {
      terminate();
      failPending(new Error("Cline stdout overflow."));
      return;
    }
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (error) {
        terminate();
        failPending(new Error(`Cline emitted malformed JSON: ${error.message}`));
        continue;
      }
      events.push(summarizeClineMessage(message, pending));
      if (events.length > 256) events.shift();
      if (message.method === "session/update") {
        const update = message.params?.update;
        if (message.params?.sessionId === sessionId && update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") answer += update.content.text;
        continue;
      }
      if (message.method && message.id !== undefined) {
        if (message.method === "session/request_permission") {
          const decision = decideClinePermission(message.params, sessionId, write);
          permissions.push({ request: message.params, decision });
          send({ jsonrpc: "2.0", id: message.id, result: { outcome: decision.outcome } });
        } else {
          send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unsupported client method: ${message.method}` } });
        }
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message ?? "native error"}`));
        else entry.resolve(message.result);
      }
    }
  });

  try {
    const initialize = await request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    if (initialize?.protocolVersion !== 1) throw new Error(`Cline selected unsupported protocol ${initialize?.protocolVersion}.`);
    const created = await request("session/new", { cwd, mcpServers: [] });
    sessionId = created?.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("Cline did not return a session ID.");
    const result = await request("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] });
    if (result?.stopReason !== "end_turn") throw new Error(`Cline returned incomplete stop reason ${result?.stopReason ?? "missing"}.`);
    if (answer.length === 0) throw new Error(`Cline returned end_turn without attributable answer text. events=${JSON.stringify(events)} stderr=${stderr}`);
    if (answer.length > maxChars) throw new Error("Cline final answer overflow.");
    child.stdin.end();
    terminate();
    await exited;
    return {
      args,
      selectorEnvironment: { CLINE_PROVIDER: env.CLINE_PROVIDER, CLINE_MODEL: env.CLINE_MODEL },
      initialize,
      newSession: { cwd, mcpServers: [] },
      sessionId,
      prompt,
      answer,
      stopReason: result.stopReason,
      permissions,
      stdoutCount,
      stderrCount,
    };
  } finally {
    clearTimeout(timer);
    terminate();
  }
}
