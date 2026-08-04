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
// MCP server for Codex. Offers two tools, ask_claude (read-only)
// and ask_claude_write (may edit files). Each call runs `claude -p`
// (answer one prompt, then exit) and relays the answer back.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

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

// The two tools Codex gets.
const TOOLS = [
  {
    name: "ask_claude",
    description:
      "Ask Claude Code a question about this repo and return its answer. File-editing " +
      "tools and the shell are disabled for this call. Use for code review, second " +
      "opinions, and explanations. " + COMMON_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A complete, self-contained instruction for Claude.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "ask_claude_write",
    description:
      "Ask Claude Code to make changes in this repo (refactors, fixes, new code). " +
      "Claude MAY edit files. " + COMMON_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A complete, self-contained instruction for Claude.",
        },
      },
      required: ["prompt"],
    },
  },
];

// Start Claude, send the prompt, return the answer.
function runClaude({ prompt }, write) {
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
    if (write) {
      // Write mode: edits auto-accepted; only user-level settings load,
      // so a cloned repo's own hooks/plugins can't join the run.
      args.push("--permission-mode", "acceptEdits");
      args.push("--setting-sources", "user");
    } else {
      // Read mode, enforced: safe mode + an allowlist of tools.
      // An allowlist rather than a denylist, because denying `Bash` by name
      // leaves Windows open: `PowerShell` is a separate tool, switched on by
      // CLAUDE_CODE_USE_POWERSHELL_TOOL or the Windows rollout rather than by
      // settings, and it can run `codex exec`, write files and reach the
      // network. With an allowlist the side-effect tools are absent, not just
      // named. That absence is also the loop guard: no shell means no way back
      // to Codex, whatever instructions this Claude happens to read.
      // Subagents stay available and inherit the restriction.
      args.push("--safe-mode");
      args.push("--tools", "Read,Glob,Grep,Agent");
      // Named as well, as a second lock if the allowlist is ever widened.
      args.push(
        "--disallowedTools",
        "Bash", "PowerShell", "Edit", "Write", "NotebookEdit",
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

// Cut out PEM private key blocks. Doing this with one lazy regex,
// `BEGIN...[\s\S]*?...END`, is quadratic when the text holds many BEGIN markers
// and no END: every marker rescans the rest of the string. Both scans below only
// ever move forward, so the work is linear in the length of the text.
function redactPrivateKeyBlocks(t) {
  const beginRe = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
  const endRe = /-----END [A-Z ]*PRIVATE KEY-----/g;
  let out = "";
  let cursor = 0;
  let begin;
  while ((begin = beginRe.exec(t)) !== null) {
    endRe.lastIndex = beginRe.lastIndex;
    const end = endRe.exec(t);
    if (!end) break; // unterminated block: leave the tail as it is, same as before
    out += t.slice(cursor, begin.index) + "[frenemy: private key block redacted]";
    cursor = end.index + end[0].length;
    beginRe.lastIndex = cursor;
  }
  return out + t.slice(cursor);
}

// Strip terminal control sequences (keep newline and tab) and redact private
// key blocks before Claude's output enters Codex's context. The key redaction
// is best effort only; do not rely on it to prevent secret leakage.
function sanitize(text) {
  let t = String(text);
  t = t.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, ""); // OSC sequences
  t = t.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, ""); // CSI sequences
  t = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""); // stray controls, incl. lone ESC
  t = redactPrivateKeyBlocks(t);
  // Same best-effort idea, widened to the token shapes that actually turn up in
  // a repo: a .env Claude was asked to read, a stack trace, a config dump.
  // Whatever crosses this line lands in Codex's context and goes to OpenAI, so
  // the cheap patterns are worth having. Still not a guarantee.
  for (const pattern of [
    /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,      // Anthropic / OpenAI style keys
    /\bAIza[0-9A-Za-z_-]{35}\b/g,              // Google API keys
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,         // GitHub tokens
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,         // Slack tokens
    /\bAKIA[0-9A-Z]{16}\b/g,                   // AWS access key ids
    /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  ]) {
    t = t.replace(pattern, "[frenemy: credential redacted]");
  }
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
    // The schema says prompt is required, but nothing enforces it on the wire.
    // Without this check a missing prompt becomes the literal string "undefined"
    // and burns a full Claude call, and in write mode an unsupervised one.
    const prompt = params?.arguments?.prompt;
    if (typeof prompt !== "string" || prompt.trim() === "") {
      return reply(id, {
        content: [{ type: "text", text: "prompt is required and must be a non-empty string." }],
        isError: true,
      });
    }
    const write = tool.name === "ask_claude_write";
    const { ok, text } = await runClaude(params.arguments ?? {}, write);
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
