/**
 * @file Native Windows/Linux qualification through the production MCP relay.
 * @change 2026-11-06 FR-FRENEMY-114, FR-FRENEMY-115, TEST-FRENEMY-114,
 * TEST-FRENEMY-115, AC-FRENEMY-114-03, AC-FRENEMY-114-06,
 * AC-FRENEMY-115-04, AC-FRENEMY-115-06: Added post-binding Grok and Cline
 * read/write, file-effect, slash-prompt, cleanup, and MCP response checks.
 * @change 2026-11-06 FR-FRENEMY-116, TEST-FRENEMY-116,
 * AC-FRENEMY-116-06, AC-TEST-FRENEMY-116-03: Qualified Cline with explicit
 * openai-codex, gpt-5.6-luna, and high effort and retained observed identity.
 * @change 2026-11-07 TEST-FRENEMY-115, AC-TEST-FRENEMY-115-04: Require the
 * Cline editor qualification prompt to verify and correct its exact final LF
 * byte so the permitted-file-byte assertion is reproducible.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(dirname(here));
const relayPath = join(repo, "ask-claude-mcp.mjs");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for native qualification.`);
  return resolve(value);
}

const grokExecutable = required("FRENEMY_GROK_EXECUTABLE");
const clineExecutable = required("FRENEMY_CLINE_EXECUTABLE");
const resultRoot = required("FRENEMY_NATIVE_RESULT_DIR");
const marker = `FRENEMY-PRODUCT-NATIVE-${process.platform.toUpperCase()}`;

class ProductRelay {
  constructor(cwd) {
    this.child = spawn(process.execPath, [
      relayPath,
      "--grok-executable", grokExecutable,
      "--cline-executable", clineExecutable,
    ], { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          pending.resolve(message.result);
        }
      }
    });
    this.child.once("error", (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    this.child.once("close", (code) => {
      const error = new Error(`Product relay exited ${code}: ${this.stderr}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  call(name, prompt, selectors = {}) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { prompt, ...selectors } } })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}.`)), 11 * 60 * 1000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
  }

  async close() {
    const closed = new Promise((resolveClose) => this.child.once("close", resolveClose));
    this.child.stdin.end();
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
    await closed;
  }
}

function answer(result, toolName) {
  assert.equal(result?.isError, false, result?.content?.[0]?.text ?? `${toolName} returned no result.`);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.ok(result.content[0].text.length > 0);
  return result.content[0].text;
}

async function promptDirectories() {
  return new Set((await readdir(tmpdir(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("frenemy-grok-"))
    .map((entry) => entry.name));
}

async function clineSessionDirectories() {
  const root = join(homedir(), ".cline", "data", "sessions");
  try {
    return new Set((await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name));
  } catch {
    return new Set();
  }
}

async function readNewClineSessionIdentities(before) {
  const root = join(homedir(), ".cline", "data", "sessions");
  const after = await clineSessionDirectories();
  const identities = [];
  for (const name of after) {
    if (before.has(name)) continue;
    const files = await readdir(join(root, name));
    const metadata = files.find((file) => file.endsWith(".json") && !file.endsWith(".messages.json"));
    if (!metadata) continue;
    const parsed = JSON.parse(await readFile(join(root, name, metadata), "utf8"));
    identities.push({ sessionId: parsed.session_id, provider: parsed.provider, model: parsed.model });
  }
  return identities;
}

test("NativeProductionQualificationTestsQ01 qualifies Grok through the product MCP entry point", { timeout: 1200000 }, async () => {
  const cwd = join(resultRoot, "product-grok-workspace");
  await mkdir(cwd, { recursive: true });
  const sentinelPath = join(cwd, "sentinel.txt");
  const outputPath = join(cwd, "grok-write.txt");
  await writeFile(sentinelPath, "sentinel-original\n", "utf8");
  await writeFile(outputPath, "before\n", "utf8");
  const beforePrompts = await promptDirectories();
  const relay = new ProductRelay(cwd);
  try {
    const readText = answer(await relay.call(
      "ask_grok",
      `Attempt to use a file-editing tool to replace sentinel.txt with forbidden. If editing is unavailable, say REFUSED. Do not use a shell. End with ${marker}.`,
    ), "ask_grok");
    assert.equal(await readFile(sentinelPath, "utf8"), "sentinel-original\n");
    assert.match(readText, /REFUSED/iu);
    assert.match(readText, new RegExp(marker, "u"));

    const writeText = answer(await relay.call(
      "ask_grok_write",
      `Use an available file-editing tool, not a shell, to replace grok-write.txt with exactly grok-write followed by one newline. End with ${marker}.`,
    ), "ask_grok_write");
    assert.equal(await readFile(outputPath, "utf8"), "grok-write\n");
    assert.match(writeText, new RegExp(marker, "u"));

    const slashText = answer(await relay.call(
      "ask_grok",
      `/workflow list\nReturn this unique marker in the model answer text: ${marker}`,
    ), "ask_grok");
    assert.match(slashText, new RegExp(marker, "u"));
  } finally {
    await relay.close();
  }
  assert.deepStrictEqual(await promptDirectories(), beforePrompts);
});

test("NativeProductionQualificationTestsQ02 qualifies Cline through the product MCP entry point", { timeout: 1200000 }, async () => {
  const cwd = join(resultRoot, "product-cline-workspace");
  await mkdir(cwd, { recursive: true });
  const sentinelPath = join(cwd, "sentinel.txt");
  const editorPath = join(cwd, "cline-editor.txt");
  const patchPath = join(cwd, "cline-patch.txt");
  await writeFile(sentinelPath, "sentinel-original\n", "utf8");
  await writeFile(editorPath, "before\n", "utf8");
  await writeFile(patchPath, "before\n", "utf8");
  const selectors = { provider: "openai-codex", model: "gpt-5.6-luna", effort: "high" };
  const beforeSessions = await clineSessionDirectories();
  const relay = new ProductRelay(cwd);
  try {
    answer(await relay.call(
      "ask_cline",
      `Use a file-editing tool now to replace sentinel.txt with forbidden. Do not use a shell. After the permission result, end with ${marker}.`,
      selectors,
    ), "ask_cline");
    assert.equal(await readFile(sentinelPath, "utf8"), "sentinel-original\n");

    const editorText = answer(await relay.call(
      "ask_cline_write",
      `Use the editor file-editing tool, not a shell, to replace cline-editor.txt with exactly cline-editor followed by one newline. The final file must end with LF byte 0x0A; read it back and correct it with the editor if needed before ending with ${marker}.`,
      selectors,
    ), "ask_cline_write");
    assert.equal(await readFile(editorPath, "utf8"), "cline-editor\n");
    assert.match(editorText, new RegExp(marker, "u"));

    answer(await relay.call(
      "ask_cline_write",
      `Use apply_patch, not a shell, to replace the content of cline-patch.txt with exactly cline-patch followed by one newline. The final file must end with LF byte 0x0A; read it back and correct the patch if needed before ending with ${marker}.`,
      selectors,
    ), "ask_cline_write");
    assert.equal(await readFile(patchPath, "utf8"), "cline-patch\n");

    const slashText = answer(await relay.call(
      "ask_cline",
      `/workflow list\nReturn this unique marker in the model answer text: ${marker}`,
      selectors,
    ), "ask_cline");
    assert.match(slashText, new RegExp(marker, "u"));
  } finally {
    await relay.close();
  }
  const identities = await readNewClineSessionIdentities(beforeSessions);
  assert.ok(identities.length >= 4, "Expected one retained Cline session identity per Q02 call.");
  for (const identity of identities) {
    assert.equal(identity.provider, selectors.provider);
    assert.equal(identity.model, selectors.model);
  }
  await writeFile(
    join(resultRoot, "cline-session-identity.json"),
    `${JSON.stringify({ selected: selectors, observed: identities }, null, 2)}\n`,
    "utf8",
  );
});
