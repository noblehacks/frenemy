/**
 * @file Native Windows/Linux qualification for the Grok and Cline relay bindings.
 * @change 2026-11-06 FR-FRENEMY-114, FR-FRENEMY-115, TEST-FRENEMY-114,
 * TEST-FRENEMY-115, AC-FRENEMY-114-02 through AC-FRENEMY-114-06 and
 * AC-FRENEMY-115-02, AC-FRENEMY-115-04, AC-FRENEMY-115-06: Added harmless
 * read/write fixtures, sentinel checks, slash-prompt markers, permission evidence,
 * and the shared Q01/Q02 assertions before product adapter implementation.
 * @change 2026-11-06 FR-FRENEMY-116, TR-FRENEMY-CONFIG-120,
 * TEST-FRENEMY-116, AC-TEST-FRENEMY-116-03: Qualified the test-side Cline ACP
 * client with explicit openai-codex, gpt-5.6-luna, and high effort selection.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { assertContractCase } from "../contracts/relay-contract.mjs";
import { runClineAcp } from "./cline-acp-client.mjs";
import { runGrokNative } from "./grok-native-client.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for native qualification.`);
  return resolve(value);
};

const grokExecutable = required("FRENEMY_GROK_EXECUTABLE");
const clineExecutable = required("FRENEMY_CLINE_EXECUTABLE");
const powerShellExecutable = required("FRENEMY_PWSH_EXECUTABLE");
const resultRoot = required("FRENEMY_NATIVE_RESULT_DIR");
const helperPath = resolve("tests/native/Protect-GrokPrompt.ps1");
const marker = `FRENEMY-NATIVE-${process.platform.toUpperCase()}`;
const context = { marker };

async function freshWorkspace(name) {
  const path = join(resultRoot, name);
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  return path;
}

async function readClineIdentity(sessionId) {
  const sessionDirectory = join(homedir(), ".cline", "data", "sessions", sessionId);
  const files = await readdir(sessionDirectory);
  const metadata = files.find((file) => file.endsWith(".json") && !file.endsWith(".messages.json"));
  assert.ok(metadata, `Missing Cline metadata for ${sessionId}.`);
  const parsed = JSON.parse(await readFile(join(sessionDirectory, metadata), "utf8"));
  return { provider: parsed.provider, model: parsed.model };
}

test("NativeQualificationTestsQ01 qualifies native Grok read and write controls", { timeout: 1200000 }, async () => {
  const cwd = await freshWorkspace("grok-workspace");
  const tempRoot = join(resultRoot, "grok-prompts");
  await mkdir(tempRoot, { recursive: true });
  const sentinelPath = join(cwd, "sentinel.txt");
  const outputPath = join(cwd, "grok-write.txt");
  await writeFile(sentinelPath, "sentinel-original\n", "utf8");
  await writeFile(outputPath, "before\n", "utf8");

  const read = await runGrokNative({
    executable: grokExecutable,
    cwd,
    prompt: `Attempt to use a file-editing tool to replace sentinel.txt with forbidden. If editing is unavailable, say REFUSED. Do not use a shell. End with ${marker}.`,
    write: false,
    platform: process.platform,
    tempRoot,
    powerShellExecutable,
    helperPath,
  });
  assert.equal(await readFile(sentinelPath, "utf8"), "sentinel-original\n");
  assert.match(read.text, /REFUSED/i);
  assert.match(read.text, new RegExp(marker));

  const write = await runGrokNative({
    executable: grokExecutable,
    cwd,
    prompt: `Use an available file-editing tool, not a shell, to replace grok-write.txt with exactly grok-write followed by one newline. End with ${marker}.`,
    write: true,
    platform: process.platform,
    tempRoot,
    powerShellExecutable,
    helperPath,
  });
  const writeBytes = await readFile(outputPath, "utf8");
  assert.equal(writeBytes, "grok-write\n");

  const slash = await runGrokNative({
    executable: grokExecutable,
    cwd,
    prompt: `/workflow list\nReturn this unique marker in the model answer text: ${marker}`,
    write: false,
    platform: process.platform,
    tempRoot,
    powerShellExecutable,
    helperPath,
  });
  assert.match(slash.text, new RegExp(marker));

  assertContractCase("Q01", {
    provider: "test-side-native",
    modes: ["read", "write"],
    readRefused: true,
    readSentinelUnchanged: true,
    writeBytes,
    stopReason: write.stopReason,
    marker,
    answerIncludesMarker: slash.text.includes(marker),
    promptProtected: read.protectedBeforeWrite && write.protectedBeforeWrite && slash.protectedBeforeWrite,
    cleanup: true,
  }, context);
});

test("NativeQualificationTestsQ02 qualifies native Cline ACP read and write controls", { timeout: 1200000 }, async () => {
  const cwd = await freshWorkspace("cline-workspace");
  const sentinelPath = join(cwd, "sentinel.txt");
  const editorPath = join(cwd, "cline-editor.txt");
  const patchPath = join(cwd, "cline-patch.txt");
  await writeFile(sentinelPath, "sentinel-original\n", "utf8");
  await writeFile(editorPath, "before\n", "utf8");
  await writeFile(patchPath, "before\n", "utf8");
  const selectors = { provider: "openai-codex", model: "gpt-5.6-luna", effort: "high" };
  const invokeCline = (options) => runClineAcp({ executable: clineExecutable, cwd, ...selectors, ...options });

  const read = await invokeCline({ write: false, prompt: `Use a file-editing tool now to replace sentinel.txt with forbidden. Do not use a shell. After the permission result, end with ${marker}.` });
  assert.equal(await readFile(sentinelPath, "utf8"), "sentinel-original\n");
  assert.ok(read.permissions.some(({ decision }) => decision.allowed === false));
  assert.deepEqual(read.selectorEnvironment, { CLINE_PROVIDER: selectors.provider, CLINE_MODEL: selectors.model });
  assert.deepEqual(read.args.slice(-2), ["--thinking", selectors.effort]);

  const editor = await invokeCline({ write: true, prompt: `Use the editor file-editing tool, not a shell, to replace cline-editor.txt with exactly cline-editor followed by one newline. End with ${marker}.` });
  const editorBytes = await readFile(editorPath, "utf8");
  assert.equal(editorBytes, "cline-editor\n");
  assert.ok(editor.permissions.some(({ decision }) => decision.allowed === true));

  const patch = await invokeCline({ write: true, prompt: `Use apply_patch, not a shell, to replace the content of cline-patch.txt with exactly cline-patch followed by one newline. The final file must end with LF byte 0x0A; read it back and correct the patch if needed before ending with ${marker}.` });
  const patchBytes = await readFile(patchPath, "utf8");
  assert.equal(patchBytes, "cline-patch\n");
  assert.ok(patch.permissions.some(({ decision }) => decision.allowed === true));

  const slash = await invokeCline({ write: false, prompt: `/workflow list\nReturn this unique marker in the model answer text: ${marker}` });
  assert.match(slash.answer, new RegExp(marker));

  const identities = await Promise.all([read, editor, patch, slash].map(({ sessionId }) => readClineIdentity(sessionId)));
  for (const identity of identities) {
    assert.deepEqual(identity, { provider: selectors.provider, model: selectors.model });
  }

  const decisions = [...editor.permissions, ...patch.permissions];
  const offeredOptionsEchoed = decisions.filter(({ decision }) => decision.allowed).every(({ request, decision }) => request.options.some((option) => option.optionId === decision.outcome.optionId));
  assertContractCase("Q02", {
    provider: "test-side-native",
    modes: ["read", "write"],
    selectedProvider: selectors.provider,
    selectedModel: selectors.model,
    selectedEffort: selectors.effort,
    observedProvider: identities[0].provider,
    observedModel: identities[0].model,
    readRejected: true,
    readSentinelUnchanged: true,
    editorBytes,
    patchBytes,
    stopReason: patch.stopReason,
    marker,
    answerIncludesMarker: slash.answer.includes(marker),
    offeredOptionsEchoed,
  }, context);
});
