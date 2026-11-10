/**
 * @file Test-side native Grok client used before production adapter implementation.
 * @change 2026-11-06 FR-FRENEMY-114, TEST-FRENEMY-114, AC-FRENEMY-114-03,
 * AC-FRENEMY-114-04, AC-FRENEMY-114-05: Added protected prompt transport,
 * exact native arguments, bounded streams, JSON result validation, and cleanup.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expectedGrokArgs } from "../contracts/relay-contract.mjs";

async function runProcess(command, args, options, maxChars) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.once("error", (error) => finish(reject, error));
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > maxChars) {
        child.kill("SIGKILL");
        finish(reject, new Error("Grok stdout overflow."));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > maxChars) {
        child.kill("SIGKILL");
        finish(reject, new Error("Grok stderr overflow."));
      }
    });
    child.once("close", (code) => finish(resolve, { code, stdout, stderr }));
  });
}

async function protectPrompt({ platform, ownedDirectory, promptPath, powerShellExecutable, helperPath }) {
  if (platform === "win32") {
    const result = await runProcess(powerShellExecutable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", helperPath, "-OwnedDirectory", ownedDirectory, "-PromptPath", promptPath], { cwd: dirname(helperPath) }, 262144);
    if (result.code !== 0) throw new Error(`Prompt protection failed: ${result.stderr || result.stdout}`);
    return;
  }
  await mkdir(ownedDirectory, { recursive: false, mode: 0o700 });
  await chmod(ownedDirectory, 0o700);
  await writeFile(promptPath, "", { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(promptPath, 0o600);
}

/** Runs one protected native Grok prompt and returns the validated result and evidence. */
export async function runGrokNative({ executable, cwd, prompt, write, platform, tempRoot, powerShellExecutable, helperPath, maxChars = 2097152 }) {
  const ownedDirectory = join(tempRoot, `grok-${randomUUID()}`);
  const promptPath = join(ownedDirectory, "prompt.txt");
  let protectedBeforeWrite = false;
  try {
    await protectPrompt({ platform, ownedDirectory, promptPath, powerShellExecutable, helperPath });
    protectedBeforeWrite = true;
    await writeFile(promptPath, prompt, { encoding: "utf8", flag: "r+" });
    const args = expectedGrokArgs(write, platform).map((value) => value === "<prompt>" ? promptPath : value);
    const result = await runProcess(executable, args, { cwd }, maxChars);
    if (result.code !== 0) throw new Error(`Grok native failure (${result.code}): ${result.stderr || result.stdout}`);
    let parsed;
    try { parsed = JSON.parse(result.stdout); } catch (error) { throw new Error(`Grok invalid output: ${error.message}`); }
    if (parsed?.error) throw new Error(`Grok native failure: ${parsed.error.message ?? parsed.error}`);
    if (!["end_turn", "refusal"].includes(parsed?.stopReason)) {
      if (["max_tokens", "max_turn_requests", "cancelled"].includes(parsed?.stopReason)) {
        const partial = typeof parsed.text === "string" ? parsed.text.slice(0, 1024) : "";
        throw new Error(`Grok incomplete output: ${parsed.stopReason}; partial=${partial}`);
      }
      throw new Error(`Grok invalid output: ${parsed?.stopReason ?? "missing stop reason"}`);
    }
    if (typeof parsed.text !== "string" || parsed.text.length === 0) throw new Error("Grok invalid output: missing text.");
    if (parsed.text.length > maxChars) throw new Error("Grok final answer overflow.");
    return { args, text: parsed.text, stopReason: parsed.stopReason, protectedBeforeWrite, promptPath };
  } finally {
    await rm(ownedDirectory, { recursive: true, force: true });
  }
}
