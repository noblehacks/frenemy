/**
 * @file Live four-agent reasoning and peer-review integration test.
 * @change 2026-11-07 FR-FRENEMY-117, TR-FRENEMY-ORCH-121,
 * TEST-FRENEMY-117, AC-FRENEMY-117-01 through AC-FRENEMY-117-05,
 * AC-TR-FRENEMY-ORCH-121-01 through AC-TR-FRENEMY-ORCH-121-06, and
 * AC-TEST-FRENEMY-117-Q01 through Q05 and AC-TEST-FRENEMY-117-06 through 08:
 * Bound the green mock contract to the existing Frenemy read-only tools and
 * Codex CLI while retaining complete boundary-visible session evidence.
 * @change 2026-11-07 TEST-FRENEMY-117 and AC-TEST-FRENEMY-117-08: Reject a
 * substituted Claude executable before live orchestration so the retained
 * executable version is bound to the command the relay can resolve.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 and 07: Bind
 * sequential advancement to the shared complete per-question evidence gate and
 * retain the actual process result in every transcript.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 through 08:
 * Retain every settled parallel session and its orchestration request/result,
 * including failures, before rejecting the active question.
 * @change 2026-11-07 TEST-FRENEMY-117 and AC-FRENEMY-117-04: Retain every
 * settled review session when one review result cannot be parsed, record the
 * parse failure, and reject only after the complete settled batch is retained.
 * @change 2026-11-07 TEST-FRENEMY-117 and AC-FRENEMY-117-04: Retain a
 * synthesized failed session, transcript, and stderr record when a rejected
 * participant promise has no session metadata. The test-only
 * FRENEMY_FOUR_AGENT_FORCE_SESSION_METADATA_FAILURE_AGENT seam proves this
 * path and is never set by a Nuke target.
 * @change 2026-11-07 TEST-FRENEMY-117 and AC-FRENEMY-117-04: The test-only
 * FRENEMY_FOUR_AGENT_FORCE_REVIEW_PARSE_FAILURE_AGENT seam replaces one named
 * reviewer's successful response with invalid JSON before parsing. It is never
 * set by a Nuke target.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PARTICIPANTS,
  answerPrompt,
  assertFourAgentCoreEvidence,
  loadQuestionFixture,
  reviewPrompt,
  runQuestionSequence,
} from "../contracts/four-agent-reasoning.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(dirname(here));
const relayPath = join(repo, "ask-claude-mcp.mjs");
const fixturePath = join(here, "..", "fixtures", "four-agent-reasoning-questions.json");
const fixture = loadQuestionFixture(fixturePath);
const runId = process.env.FRENEMY_FOUR_AGENT_RUN_ID;
const artifactRoot = process.env.FRENEMY_FOUR_AGENT_RESULT_ROOT;
const executables = Object.freeze({
  claude: process.env.FRENEMY_CLAUDE_EXECUTABLE,
  codex: process.env.FRENEMY_CODEX_EXECUTABLE,
  grok: process.env.FRENEMY_GROK_EXECUTABLE,
  cline: process.env.FRENEMY_CLINE_EXECUTABLE,
});
const sessionTimeoutMilliseconds = Number.parseInt(process.env.FRENEMY_FOUR_AGENT_SESSION_TIMEOUT_MS ?? "1800000", 10);
const forcedReviewParseFailureAgent = process.env.FRENEMY_FOUR_AGENT_FORCE_REVIEW_PARSE_FAILURE_AGENT;
const forcedSessionMetadataFailureAgent = process.env.FRENEMY_FOUR_AGENT_FORCE_SESSION_METADATA_FAILURE_AGENT;

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function relativePath(path) {
  return relative(artifactRoot, path).replaceAll("\\", "/");
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(path, values) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, values.map((value) => `${JSON.stringify(value)}\n`).join(""), "utf8");
}

function event({ questionId, phase, agent, sessionId, timestamp = localTimestamp(), direction, eventType, payload }) {
  return { runId, questionId, phase, agent, sessionId, timestamp, direction, eventType, payload };
}

async function requireExecutable(agent, path) {
  assert.ok(path, `${agent} executable was not provided`);
  assert.ok(isAbsolute(path), `${agent} executable must be absolute`);
  assert.ok(existsSync(path), `${agent} executable does not exist: ${path}`);
  assert.ok((await stat(path)).isFile(), `${agent} executable is not a file: ${path}`);
  if (agent === "claude") {
    const expectedName = process.platform === "win32" ? "claude.exe" : "claude";
    assert.equal(
      basename(path).toLowerCase(),
      expectedName,
      `claude executable must be named ${expectedName} so the relay resolves the configured command`,
    );
  }
}

async function clineSessionDirectories() {
  const root = join(homedir(), ".cline", "data", "sessions");
  try {
    return new Set((await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  } catch {
    return new Set();
  }
}

async function readNewClineSessionIdentities(before) {
  const root = join(homedir(), ".cline", "data", "sessions");
  for (let attempt = 0; attempt < 40; attempt += 1) {
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
    if (identities.length > 0) return identities;
    await delay(250);
  }
  return [];
}

function extractRelayText(message) {
  assert.ok(message?.result, "relay response omitted result");
  assert.equal(message.result.isError, false, message.result.content?.[0]?.text ?? "relay reported an error");
  assert.equal(message.result.content?.length, 1, "relay response must contain one text item");
  assert.equal(message.result.content[0].type, "text", "relay response must contain text");
  const text = message.result.content[0].text;
  assert.ok(text.trim(), "relay returned an empty answer");
  return text;
}

async function runRelaySession(agent, role, question, prompt) {
  const startedAt = localTimestamp();
  const beforeClineSessions = agent === "cline" ? await clineSessionDirectories() : null;
  const sessionId = `${runId}-${question.id}-${agent}-${role}`;
  const transcriptPath = join(artifactRoot, "sessions", agent, question.id, `${role}.jsonl`);
  const stderrPath = join(artifactRoot, "stderr", agent, question.id, `${role}.log`);
  const transcript = [];
  const stderr = [];
  const args = [relayPath, "--grok-executable", executables.grok, "--cline-executable", executables.cline];
  const tool = { claude: "ask_claude", grok: "ask_grok", cline: "ask_cline" }[agent];
  const toolArguments = { prompt, effort: "medium" };
  if (agent === "cline") Object.assign(toolArguments, { provider: "openai-codex", model: "gpt-5.6-luna" });
  const child = spawn(process.execPath, args, {
    cwd: repo,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PATH: `${dirname(executables.claude)}${delimiter}${process.env.PATH ?? ""}` },
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let buffer = "";
  let nextId = 1;
  const pending = new Map();
  let closeResult;
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      closeResult = { code, signal };
      for (const waiter of pending.values()) waiter.reject(new Error(`relay exited before response: ${code}/${signal}`));
      pending.clear();
      resolve(closeResult);
    });
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "response", eventType: "relay_jsonrpc", payload: message }));
      const waiter = pending.get(message.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });

  const request = (method, params = {}) => {
    const id = nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "request", eventType: "relay_jsonrpc", payload: message }));
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        child.kill("SIGKILL");
        reject(new Error(`${agent} ${role} session timed out`));
      }, sessionTimeoutMilliseconds);
      pending.set(id, { resolve, reject, timer });
    });
  };

  let status = "failed";
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "frenemy-four-agent-test", version: "1.0.0" } });
    assert.equal(initialized.result.serverInfo.name, "frenemy", "wrong relay identity");
    const notification = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
    transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "request", eventType: "relay_jsonrpc", payload: notification }));
    child.stdin.write(`${JSON.stringify(notification)}\n`);
    const response = await request("tools/call", { name: tool, arguments: toolArguments });
    const text = extractRelayText(response);
    transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "response", eventType: "agent_result", payload: { text } }));
    status = "completed";
    child.stdin.end();
    const exit = await closed;
    assert.equal(exit.code, 0, `${agent} relay exited with code ${exit.code}`);
    const completedAt = localTimestamp();
    let observedIdentities;
    let identityPath;
    if (agent === "cline") {
      observedIdentities = await readNewClineSessionIdentities(beforeClineSessions);
      assert.ok(observedIdentities.length > 0, "Cline created no observable session identity record");
      for (const identity of observedIdentities) {
        assert.equal(identity.provider, "openai-codex", "Cline used a substituted provider");
        assert.equal(identity.model, "gpt-5.6-luna", "Cline used a substituted model");
      }
      const absoluteIdentityPath = join(artifactRoot, "session-identities", agent, question.id, `${role}.json`);
      await writeJson(absoluteIdentityPath, { selected: { provider: "openai-codex", model: "gpt-5.6-luna", effort: "medium" }, observed: observedIdentities });
      identityPath = relativePath(absoluteIdentityPath);
    }
    return {
      text,
      session: {
        questionId: question.id,
        agent,
        role,
        sessionId,
        effort: "medium",
        status,
        startedAt,
        completedAt,
        transcriptPath: relativePath(transcriptPath),
        transcriptComplete: exit.code === 0
          && transcript.some((item) => item.direction === "request" && item.payload?.method === "tools/call")
          && transcript.some((item) => item.direction === "response" && item.payload?.id === response.id),
        resultText: text,
        stderrPath: relativePath(stderrPath),
        target: executables[agent],
        relayArgv: args,
        requestedConfiguration: { effort: "medium", ...(agent === "cline" ? { provider: "openai-codex", model: "gpt-5.6-luna" } : {}) },
        ...(observedIdentities ? { observedIdentities } : {}),
        ...(identityPath ? { identityPath } : {}),
      },
    };
  } catch (error) {
    transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "internal", eventType: "session_failure", payload: { message: error.message } }));
    error.session = {
      questionId: question.id,
      agent,
      role,
      sessionId,
      effort: "medium",
      status: "failed",
      startedAt,
      completedAt: localTimestamp(),
      transcriptPath: relativePath(transcriptPath),
      transcriptComplete: false,
      resultText: "",
      stderrPath: relativePath(stderrPath),
      target: executables[agent],
      relayArgv: args,
      requestedConfiguration: { effort: "medium", ...(agent === "cline" ? { provider: "openai-codex", model: "gpt-5.6-luna" } : {}) },
    };
    throw error;
  } finally {
    if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
    transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "internal", eventType: "session_exit", payload: closeResult ?? { code: child.exitCode, signal: child.signalCode, status } }));
    if (stderr.length > 0) transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "response", eventType: "stderr", payload: { text: stderr.join("") } }));
    await writeJsonl(transcriptPath, transcript);
    await mkdir(dirname(stderrPath), { recursive: true });
    await writeFile(stderrPath, stderr.join(""), "utf8");
  }
}

async function runCodexSession(role, question, prompt) {
  const startedAt = localTimestamp();
  const agent = "codex";
  const sessionId = `${runId}-${question.id}-${agent}-${role}`;
  const transcriptPath = join(artifactRoot, "sessions", agent, question.id, `${role}.jsonl`);
  const stderrPath = join(artifactRoot, "stderr", agent, question.id, `${role}.log`);
  const lastMessagePath = join(artifactRoot, "last-messages", agent, question.id, `${role}.txt`);
  await mkdir(dirname(lastMessagePath), { recursive: true });
  const args = ["exec", "--sandbox", "read-only", "--json", "-c", "model_reasoning_effort=medium", "-C", repo, "-o", lastMessagePath, "-"];
  const transcript = [event({ questionId: question.id, phase: role, agent, sessionId, timestamp: startedAt, direction: "request", eventType: "codex_prompt", payload: { prompt, executable: executables.codex, argv: args } })];
  const child = spawn(executables.codex, args, { cwd: repo, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  const timer = setTimeout(() => child.kill("SIGKILL"), sessionTimeoutMilliseconds);
  child.stdin.end(prompt);
  let status = "failed";
  try {
    const exit = await closed;
    clearTimeout(timer);
    for (const line of stdout.split(/\r?\n/u).filter(Boolean)) {
      transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "response", eventType: "codex_jsonl", payload: JSON.parse(line) }));
    }
    transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "internal", eventType: "session_exit", payload: exit }));
    if (stderr) transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "response", eventType: "stderr", payload: { text: stderr } }));
    assert.equal(exit.code, 0, `codex ${role} session exited with code ${exit.code}`);
    const text = readFileSync(lastMessagePath, "utf8");
    assert.ok(text.trim(), "codex returned an empty answer");
    transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "response", eventType: "agent_result", payload: { text } }));
    status = "completed";
    return { text, session: { questionId: question.id, agent, role, sessionId, effort: "medium", status, startedAt, completedAt: localTimestamp(), transcriptPath: relativePath(transcriptPath), transcriptComplete: exit.code === 0 && transcript.some((item) => item.eventType === "codex_prompt") && transcript.some((item) => item.eventType === "agent_result"), resultText: text, stderrPath: relativePath(stderrPath), target: executables.codex, argv: args, requestedConfiguration: { effort: "medium" } } };
  } catch (error) {
    transcript.push(event({ questionId: question.id, phase: role, agent, sessionId, direction: "internal", eventType: "session_failure", payload: { message: error.message } }));
    error.session = {
      questionId: question.id,
      agent,
      role,
      sessionId,
      effort: "medium",
      status: "failed",
      startedAt,
      completedAt: localTimestamp(),
      transcriptPath: relativePath(transcriptPath),
      transcriptComplete: false,
      resultText: "",
      stderrPath: relativePath(stderrPath),
      target: executables.codex,
      argv: args,
      requestedConfiguration: { effort: "medium" },
    };
    throw error;
  } finally {
    clearTimeout(timer);
    await writeJsonl(transcriptPath, transcript);
    await mkdir(dirname(stderrPath), { recursive: true });
    await writeFile(stderrPath, stderr, "utf8");
  }
}

function runParticipantSession(agent, role, question, prompt) {
  if (agent === forcedSessionMetadataFailureAgent) {
    return Promise.reject(new Error(`forced ${agent} ${role} failure without session metadata`));
  }
  return agent === "codex" ? runCodexSession(role, question, prompt) : runRelaySession(agent, role, question, prompt);
}

function appendOrchestrationRequests(orchestration, role, question, prompts) {
  for (const agent of PARTICIPANTS) {
    orchestration.push(event({
      questionId: question.id,
      phase: role,
      agent,
      sessionId: `${runId}-${question.id}-${agent}-${role}`,
      direction: "request",
      eventType: `${role}_prompt`,
      payload: {
        prompt: prompts.get(agent),
        requestedConfiguration: { effort: "medium", ...(agent === "cline" ? { provider: "openai-codex", model: "gpt-5.6-luna" } : {}) },
      },
    }));
  }
}

async function retainSettledSession({ result, role, question, agent, sessions, orchestration }) {
  if (result.status === "fulfilled") {
    sessions.push(result.value.session);
    return result.value;
  }
  let session = result.reason?.session;
  if (!session) {
    const startedAt = localTimestamp();
    const completedAt = localTimestamp();
    const sessionId = `${runId}-${question.id}-${agent}-${role}`;
    const transcriptPath = `sessions/${agent}/${question.id}/${role}.jsonl`;
    const stderrPath = `stderr/${agent}/${question.id}/${role}.log`;
    const message = result.reason?.message ?? String(result.reason);
    session = {
      questionId: question.id,
      agent,
      role,
      sessionId,
      effort: "medium",
      status: "failed",
      startedAt,
      completedAt,
      transcriptPath,
      transcriptComplete: false,
      resultText: "",
      stderrPath,
      target: executables[agent],
      requestedConfiguration: { effort: "medium", ...(agent === "cline" ? { provider: "openai-codex", model: "gpt-5.6-luna" } : {}) },
      synthesizedFailureEvidence: true,
    };
    await writeJsonl(join(artifactRoot, transcriptPath), [
      event({ questionId: question.id, phase: role, agent, sessionId, timestamp: startedAt, direction: "internal", eventType: "session_failure", payload: { message, synthesized: true } }),
      event({ questionId: question.id, phase: role, agent, sessionId, timestamp: completedAt, direction: "internal", eventType: "session_exit", payload: { code: null, signal: null, status: "failed", synthesized: true } }),
    ]);
    await mkdir(dirname(join(artifactRoot, stderrPath)), { recursive: true });
    await writeFile(join(artifactRoot, stderrPath), `${message}\n`, "utf8");
  }
  sessions.push(session);
  orchestration.push(event({
    questionId: question.id,
    phase: role,
    agent,
    sessionId: session.sessionId,
    timestamp: session.completedAt,
    direction: "response",
    eventType: `${role}_failure`,
    payload: { name: result.reason?.name ?? "Error", message: result.reason?.message ?? String(result.reason), status: "failed" },
  }));
  return null;
}

async function collectFiles(root) {
  const files = {};
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name !== "manifest.json") files[relative(root, path).replaceAll("\\", "/")] = await readFile(path, "utf8");
    }
  };
  await visit(root);
  return files;
}

async function buildLiveCoreEvidence({ answers, judgments, sessions, orchestration }) {
  const files = await collectFiles(artifactRoot);
  return { runId, fixture, participants: [...PARTICIPANTS], answers, judgments, sessions, orchestration, files };
}

function parseJudgments(text, reviewerAgent, question) {
  const judgments = JSON.parse(text.trim());
  assert.ok(Array.isArray(judgments), `${reviewerAgent} review must be a JSON array`);
  assert.equal(judgments.length, 3, `${reviewerAgent} review must contain exactly three judgments`);
  return judgments.map((judgment) => ({ ...judgment, questionId: judgment.questionId, reviewerAgent: judgment.reviewerAgent }));
}

test("FourAgentReasoningIntegrationTests all four agents answer and peer-review the five AC questions", async () => {
  assert.ok(runId, "FRENEMY_FOUR_AGENT_RUN_ID is required");
  assert.ok(artifactRoot && isAbsolute(artifactRoot), "FRENEMY_FOUR_AGENT_RESULT_ROOT must be absolute");
  assert.ok(Number.isInteger(sessionTimeoutMilliseconds) && sessionTimeoutMilliseconds > 0, "session timeout must be a positive integer");
  await mkdir(artifactRoot, { recursive: true });
  await writeJson(join(artifactRoot, "questions.json"), fixture);

  const answers = [];
  const judgments = [];
  const sessions = [];
  const orchestration = [];
  let failure;
  let activeQuestionId = null;
  try {
    for (const agent of PARTICIPANTS) await requireExecutable(agent, executables[agent]);
    await runQuestionSequence(fixture.questions, async (question) => {
      activeQuestionId = question.id;
      const answerPrompts = new Map(PARTICIPANTS.map((agent) => [agent, answerPrompt(agent, question)]));
      appendOrchestrationRequests(orchestration, "answer", question, answerPrompts);
      const answerResults = await Promise.allSettled(PARTICIPANTS.map((agent) => runParticipantSession(agent, "answer", question, answerPrompts.get(agent))));
      const answerFailures = [];
      for (let index = 0; index < answerResults.length; index += 1) {
        const result = answerResults[index];
        const agent = PARTICIPANTS[index];
        const settled = await retainSettledSession({ result, role: "answer", question, agent, sessions, orchestration });
        if (!settled) {
          answerFailures.push(result.reason);
          continue;
        }
        const answer = { questionId: question.id, agent, sessionId: settled.session.sessionId, effort: "medium", status: "completed", answer: settled.text };
        answers.push(answer);
        orchestration.push(event({ questionId: question.id, phase: "answer", agent, sessionId: answer.sessionId, timestamp: settled.session.completedAt, direction: "response", eventType: "answer_result", payload: answer }));
      }
      if (answerFailures.length > 0) throw answerFailures[0];

      const questionAnswers = answers.filter((answer) => answer.questionId === question.id);
      const reviewPrompts = new Map(PARTICIPANTS.map((agent) => [agent, reviewPrompt(agent, question, questionAnswers)]));
      appendOrchestrationRequests(orchestration, "review", question, reviewPrompts);
      const reviewResults = await Promise.allSettled(PARTICIPANTS.map((agent) => runParticipantSession(agent, "review", question, reviewPrompts.get(agent))));
      const reviewFailures = [];
      for (let index = 0; index < reviewResults.length; index += 1) {
        const result = reviewResults[index];
        const reviewerAgent = PARTICIPANTS[index];
        const settled = await retainSettledSession({ result, role: "review", question, agent: reviewerAgent, sessions, orchestration });
        if (!settled) {
          reviewFailures.push(result.reason);
          continue;
        }
        try {
          const reviewText = reviewerAgent === forcedReviewParseFailureAgent ? "forced invalid review JSON" : settled.text;
          const reviewJudgments = parseJudgments(reviewText, reviewerAgent, question);
          settled.session.judgments = reviewJudgments;
          judgments.push(...reviewJudgments);
          orchestration.push(event({ questionId: question.id, phase: "review", agent: reviewerAgent, sessionId: settled.session.sessionId, timestamp: settled.session.completedAt, direction: "response", eventType: "review_result", payload: reviewJudgments }));
        }
        catch (error) {
          settled.session.status = "failed";
          settled.session.error = { name: error.name, message: error.message };
          reviewFailures.push(error);
          orchestration.push(event({
            questionId: question.id,
            phase: "review",
            agent: reviewerAgent,
            sessionId: settled.session.sessionId,
            timestamp: settled.session.completedAt,
            direction: "response",
            eventType: "review_failure",
            payload: { name: error.name, message: error.message, status: "failed" },
          }));
        }
      }
      if (reviewFailures.length > 0) throw reviewFailures[0];
      return {
        answers: answers.filter((answer) => answer.questionId === question.id),
        judgments: judgments.filter((judgment) => judgment.questionId === question.id),
        sessions: sessions.filter((session) => session.questionId === question.id),
        files: await collectFiles(artifactRoot),
      };
    });

    await writeJsonl(join(artifactRoot, "orchestration.jsonl"), orchestration);
    await writeJson(join(artifactRoot, "answers.json"), answers);
    await writeJson(join(artifactRoot, "peer-judgments.json"), judgments);
    await writeJson(join(artifactRoot, "sessions.json"), sessions);
    await writeJson(join(artifactRoot, "summary.json"), { runId, status: "passed", counts: { questions: fixture.questions.length, answers: answers.length, sessions: sessions.length, judgments: judgments.length }, minimumAccuracy: Math.min(...judgments.map(({ accuracy }) => accuracy)) });
    const evidence = await buildLiveCoreEvidence({ answers, judgments, sessions, orchestration });
    assertFourAgentCoreEvidence(evidence);
  } catch (error) {
    failure = error;
    orchestration.push(event({
      questionId: activeQuestionId ?? "PRECHECK",
      phase: "run",
      agent: "orchestrator",
      sessionId: `${runId}-run`,
      direction: "internal",
      eventType: "run_failure",
      payload: { name: error.name, message: error.message },
    }));
    throw error;
  } finally {
    await writeJsonl(join(artifactRoot, "orchestration.jsonl"), orchestration);
    await writeJson(join(artifactRoot, "answers.json"), answers);
    await writeJson(join(artifactRoot, "peer-judgments.json"), judgments);
    await writeJson(join(artifactRoot, "sessions.json"), sessions);
    await writeJson(join(artifactRoot, "summary.json"), { runId, status: failure ? "failed" : "passed", failure: failure ? { name: failure.name, message: failure.message, stack: failure.stack } : null, counts: { questions: fixture.questions.length, answers: answers.length, sessions: sessions.length, judgments: judgments.length }, minimumAccuracy: judgments.length > 0 ? Math.min(...judgments.map(({ accuracy }) => Number.isInteger(accuracy) ? accuracy : -1)) : null });
  }
});
