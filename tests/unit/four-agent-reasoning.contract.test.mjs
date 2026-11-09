/**
 * @file BDPv4 independent mock proof for the four-agent reasoning integration.
 * @change 2026-11-07 FR-FRENEMY-117, TR-FRENEMY-ORCH-121,
 * TEST-FRENEMY-117, AC-TEST-FRENEMY-117-Q01 through Q05 and
 * AC-TEST-FRENEMY-117-06 through 08: Added deterministic scripted evidence and
 * deliberate negative controls that remain reproducible without harvested live
 * data or integration artifacts.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-08: Prove that an
 * actual receipt member substitution fails while harmless member reordering passes.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 through 08:
 * Prove per-question stop behavior, transcript/tool/result binding, and exact
 * ZIP-derived passed and failed archive evidence with byte-level controls.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 and 08: Added
 * direct controls for transcript results, Cline identity, orchestration pairs,
 * per-question stop branches, required report members, and ZIP parser guards.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 and 07: Made
 * the assertion inventory consume messages from controls that actually reached
 * each assertion occurrence, and added loader and per-question branch controls.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 through 08:
 * Record direct controls only when their named subtests execute, inventory
 * assertion occurrences one-for-one, and reject incomplete failed-run archives.
 * @change 2026-11-09 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 and 07: Added
 * direct negative controls for every previously justified but directly reachable
 * session, transcript, per-question participant, effort, and manifest assertion.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertFourAgentArchiveEvidence,
  assertFourAgentEvidence,
  createScriptedEvidence,
  deriveArchiveEvidence,
  loadQuestionFixture,
  runQuestionSequence,
  sha256,
} from "../contracts/four-agent-reasoning.mjs";
import { createDeflatedZip, createStoredZip, inspectZipArchive } from "../contracts/zip-archive.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "fixtures", "four-agent-reasoning-questions.json");
const fixture = loadQuestionFixture(fixturePath);

function collectLiteralAssertionMessages(source) {
  const messages = [];
  const callPattern = /assert\.(?:ok|equal|notEqual|deepStrictEqual|match)\(/gu;
  for (const match of source.matchAll(callPattern)) {
    let depth = 1;
    let quote = null;
    let escaped = false;
    let index = match.index + match[0].length;
    const topLevelCommas = [];
    for (; index < source.length && depth > 0; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (["\"", "'", "`"].includes(character)) {
        quote = character;
        continue;
      }
      if (character === "(") depth += 1;
      else if (character === ")") depth -= 1;
      else if (character === "," && depth === 1) topLevelCommas.push(index);
    }
    if (topLevelCommas.length === 0) continue;
    let candidateEnd = index - 1;
    if (source.slice(topLevelCommas.at(-1) + 1, candidateEnd).trim() === "") candidateEnd = topLevelCommas.pop();
    if (topLevelCommas.length === 0) continue;
    const candidate = source.slice(topLevelCommas.at(-1) + 1, candidateEnd).trim();
    const delimiter = candidate[0];
    if (!["\"", "'", "`"].includes(delimiter) || candidate.at(-1) !== delimiter) continue;
    const message = delimiter === "\""
      ? JSON.parse(candidate)
      : candidate.slice(1, -1).replace(/\$\{[^}]+\}/gu, "*");
    messages.push(message);
  }
  return messages;
}

function mutateSessionTranscript(evidence, sessionPredicate, eventPredicate, mutate) {
  const session = evidence.sessions.find(sessionPredicate);
  assert.ok(session, "scripted session for mutation was not found");
  const events = evidence.files[session.transcriptPath].split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const selected = events.find(eventPredicate);
  assert.ok(selected, "scripted transcript event for mutation was not found");
  mutate(selected);
  evidence.files[session.transcriptPath] = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function removeSessionTranscriptEvent(evidence, sessionPredicate, eventPredicate) {
  const session = evidence.sessions.find(sessionPredicate);
  assert.ok(session, "scripted session for removal was not found");
  const events = evidence.files[session.transcriptPath].split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const index = events.findIndex(eventPredicate);
  assert.ok(index >= 0, "scripted transcript event for removal was not found");
  events.splice(index, 1);
  evidence.files[session.transcriptPath] = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function rebuildManifestEntries(evidence) {
  evidence.manifest.entries = Object.entries(evidence.files).map(([path, content]) => ({
    path,
    size: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
  }));
}

function rewriteOrchestration(evidence, mutate) {
  mutate(evidence.orchestration);
  evidence.files["orchestration.jsonl"] = `${evidence.orchestration.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function createArchiveFixture(evidence, entries = Object.entries(evidence.files)) {
  const manifestText = `${JSON.stringify(evidence.manifest, null, 2)}\n`;
  const archiveEntries = [...entries, ["manifest.json", manifestText]];
  const bytes = createStoredZip(archiveEntries);
  const validationReceipt = {
    ...evidence.archive.validationReceipt,
    zipSha256: sha256(bytes),
    manifestSha256: sha256(manifestText),
    memberCount: archiveEntries.length,
    members: archiveEntries.map(([path]) => path),
    status: evidence.manifest.status,
    sourceFileCount: evidence.manifest.sourceFiles.length,
  };
  return { bytes, validationReceipt };
}

test("FourAgentReasoningMockTests correct independent evidence satisfies the complete contract", () => {
  assert.doesNotThrow(() => assertFourAgentEvidence(createScriptedEvidence(fixture)));
});

const negativeControls = [
  ["wrong core question count", /wrong question count/u, (x) => { x.fixture.questions.pop(); }],
  ["missing participant", /missing or reordered participant/u, (x) => { x.participants.pop(); }],
  ["missing answer", /missing answer/u, (x) => { x.answers.pop(); }],
  ["missing session", /missing session/u, (x) => { x.sessions.pop(); }],
  ["missing judgment", /missing judgment/u, (x) => { x.judgments.pop(); }],
  ["wrong question identity", /answer has wrong question identity/u, (x) => { x.answers[0].questionId = "Q99"; }],
  ["duplicated question identity", /duplicate question identity/u, (x) => { x.fixture.questions[1].id = "Q01"; }],
  ["wrong rubric identity", /core question AC identity drifted/u, (x) => { x.fixture.questions[0].acceptanceCriterionId = "AC-WRONG"; }],
  ["core canonical AC hash drift", /core canonical AC hash drifted/u, (x) => { x.fixture.questions[0].acceptanceCriterionSha256 = "0".repeat(64); }],
  ["core AC projection hash drift", /core AC projection hash mismatch/u, (x) => { x.fixture.questions[0].acceptanceCriterionText += " altered"; }],
  ["question text drift", /core exact question is not present in the AC projection/u, (x) => { x.fixture.questions[0].question += " altered"; }],
  ["rubric text drift", /core rubric drifted from the AC projection/u, (x) => { x.fixture.questions[4].rubric = x.fixture.questions[4].rubric.replace("680", "120"); }],
  ["non-medium effort", /answer effort is not medium/u, (x) => { x.answers[0].effort = "high"; }],
  ["relay request non-medium effort", /relay request effort is not medium/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "claude", ({ eventType, payload }) => eventType === "relay_jsonrpc" && payload.method === "tools/call", (event) => { event.payload.params.arguments.effort = "high"; })],
  ["Codex request non-medium effort", /Codex argv does not request medium effort/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "codex", ({ eventType }) => eventType === "codex_prompt", (event) => { event.payload.argv = event.payload.argv.filter((value) => value !== "model_reasoning_effort=medium"); })],
  ["session requested configuration non-medium", /session requested configuration is not medium/u, (x) => { x.sessions[0].requestedConfiguration.effort = "high"; }],
  ["missing observed Cline identity", /Cline observed identity is missing/u, (x) => { x.sessions.find(({ agent }) => agent === "cline").observedIdentities = []; }],
  ["substituted Cline provider", /Cline observed provider was substituted/u, (x) => { x.sessions.find(({ agent }) => agent === "cline").observedIdentities[0].provider = "different-provider"; }],
  ["substituted Cline model", /Cline observed model was substituted/u, (x) => { x.sessions.find(({ agent }) => agent === "cline").observedIdentities[0].model = "different-model"; }],
  ["missing Codex argv", /Codex session argv is not retained/u, (x) => { delete x.sessions.find(({ agent }) => agent === "codex").argv; }],
  ["wrong answer participant", /answer has wrong participant identity/u, (x) => { x.answers[0].agent = "unknown"; }],
  ["duplicate answer", /duplicate answer identity/u, (x) => { x.answers[1] = structuredClone(x.answers[0]); }],
  ["wrong session question", /session has wrong question identity/u, (x) => { x.sessions[0].questionId = "Q99"; }],
  ["wrong session participant", /session has wrong participant identity/u, (x) => { x.sessions[0].agent = "unknown"; }],
  ["wrong session role", /session has wrong role/u, (x) => { x.sessions[0].role = "other"; }],
  ["failed session", /session failed or timed out/u, (x) => { x.sessions[0].status = "failed"; }],
  ["empty session result text", /session result text is missing/u, (x) => { x.sessions[0].resultText = ""; }],
  ["missing Codex prompt request", /session transcript has no Codex prompt request/u, (x) => removeSessionTranscriptEvent(x, ({ agent }) => agent === "codex", ({ eventType }) => eventType === "codex_prompt")],
  ["missing Codex retained result", /session transcript has no retained agent result/u, (x) => removeSessionTranscriptEvent(x, ({ agent }) => agent === "codex", ({ eventType }) => eventType === "agent_result")],
  ["missing relay tools call request", /session transcript has no relay tools\/call request/u, (x) => removeSessionTranscriptEvent(x, ({ agent }) => agent === "claude", ({ direction, payload }) => direction === "request" && payload?.method === "tools/call")],
  ["session high effort", /session effort is not medium/u, (x) => { x.sessions[0].effort = "high"; }],
  ["duplicate session identity", /duplicate session identity/u, (x) => { x.sessions[1].questionId = x.sessions[0].questionId; x.sessions[1].agent = x.sessions[0].agent; x.sessions[1].role = x.sessions[0].role; }],
  ["review session has two judgments", /review session must judge the other three agents/u, (x) => { x.sessions.find(({ role }) => role === "review").judgments.pop(); }],
  ["judgment wrong question identity", /judgment has wrong question identity/u, (x) => { x.judgments[0].questionId = "Q99"; }],
  ["incomplete transcript flag", /session transcript is incomplete/u, (x) => { x.sessions[0].transcriptComplete = false; }],
  ["transcript identity mismatch", /session transcript identity does not match/u, (x) => mutateSessionTranscript(x, () => true, () => true, (event) => { event.sessionId = "wrong"; })],
  ["transcript missing response", /relay tools\/call request has no matched response/u, (x) => { const session = x.sessions[0]; x.files[session.transcriptPath] = x.files[session.transcriptPath].split(/\r?\n/u).filter(Boolean).filter((line) => JSON.parse(line).direction !== "response").map((line) => `${line}\n`).join(""); }],
  ["transcript missing exit", /session transcript has no exit event/u, (x) => { const session = x.sessions[0]; x.files[session.transcriptPath] = x.files[session.transcriptPath].split(/\r?\n/u).filter(Boolean).filter((line) => JSON.parse(line).eventType !== "session_exit").map((line) => `${line}\n`).join(""); }],
  ["relay write tool", /did not use the agent read-only tool/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "claude", ({ payload }) => payload?.method === "tools/call", (event) => { event.payload.params.name = "ask_claude_write"; })],
  ["relay swapped read tool", /did not use the agent read-only tool/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "grok", ({ payload }) => payload?.method === "tools/call", (event) => { event.payload.params.name = "ask_cline"; })],
  ["Codex missing read-only sandbox", /does not use the read-only sandbox/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "codex", ({ eventType }) => eventType === "codex_prompt", (event) => { event.payload.argv = event.payload.argv.filter((value) => !["--sandbox", "read-only"].includes(value)); })],
  ["Codex prompt differs from retained question", /Codex session prompt does not match the exact question and rubric/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "codex", ({ eventType }) => eventType === "codex_prompt", (event) => { event.payload.prompt = "substituted prompt"; })],
  ["Codex result differs from retained result", /Codex session transcript result differs from retained result text/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "codex", ({ eventType }) => eventType === "agent_result", (event) => { event.payload.text = "substituted result"; })],
  ["altered answer question prompt", /relay session prompt does not match the exact question and rubric/u, (x) => mutateSessionTranscript(x, ({ agent, role }) => agent === "claude" && role === "answer", ({ payload }) => payload?.method === "tools/call", (event) => { event.payload.params.arguments.prompt = event.payload.params.arguments.prompt.replace("Question:", "Changed question:"); })],
  ["altered review rubric prompt", /relay session prompt does not match the exact question and rubric/u, (x) => mutateSessionTranscript(x, ({ agent, role }) => agent === "grok" && role === "review", ({ payload }) => payload?.method === "tools/call", (event) => { event.payload.params.arguments.prompt = event.payload.params.arguments.prompt.replace("Canonical rubric:", "Changed rubric:"); })],
  ["relay response id mismatch", /no matched response/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "cline", ({ direction, payload }) => direction === "response" && payload?.id === 2, (event) => { event.payload.id = 99; })],
  ["relay response reports an error", /relay tools\/call response is an error/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "claude", ({ direction }) => direction === "response", (event) => { event.payload.result.isError = true; })],
  ["relay result differs from retained result", /relay session transcript result differs from retained result text/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "grok" && x.sessions.find(({ agent: candidate, role }) => candidate === "grok" && role === "answer"), ({ direction }) => direction === "response", (event) => { event.payload.result.content[0].text = "substituted result"; })],
  ["parsed review result differs from retained judgments", /parsed judgments differ from the session transcript result/u, (x) => { const session = x.sessions.find(({ role }) => role === "review"); session.resultText = "[]"; mutateSessionTranscript(x, ({ sessionId }) => sessionId === session.sessionId, ({ direction }) => direction === "response", (event) => { event.payload.result.content[0].text = "[]"; }); }],
  ["Cline requested provider drift", /Cline requested identity drifted/u, (x) => { x.sessions.find(({ agent }) => agent === "cline").requestedConfiguration.provider = "different-provider"; }],
  ["Cline requested model drift", /Cline requested identity drifted/u, (x) => { x.sessions.find(({ agent }) => agent === "cline").requestedConfiguration.model = "different-model"; }],
  ["Cline relay provider drift", /Cline relay provider was substituted/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "cline", ({ direction }) => direction === "request", (event) => { event.payload.params.arguments.provider = "different-provider"; })],
  ["Cline relay model drift", /Cline relay model was substituted/u, (x) => mutateSessionTranscript(x, ({ agent }) => agent === "cline", ({ direction }) => direction === "request", (event) => { event.payload.params.arguments.model = "different-model"; })],
  ["retained answer differs from transcript", /retained answer differs from its session transcript result/u, (x) => { x.answers[0].answer = "different answer"; }],
  ["session exit code one", /exit code is not zero/u, (x) => mutateSessionTranscript(x, () => true, ({ eventType }) => eventType === "session_exit", (event) => { event.payload.code = 1; })],
  ["self-review", /self-review is forbidden/u, (x) => { x.judgments[0].reviewerAgent = x.judgments[0].subjectAgent; }],
  ["duplicate subject reviewer pair", /duplicate subject\/reviewer pair/u, (x) => { x.judgments[1] = structuredClone(x.judgments[0]); }],
  ["unknown judgment subject", /judgment subject is unknown/u, (x) => { x.judgments[0].subjectAgent = "unknown"; }],
  ["unknown judgment reviewer", /judgment reviewer is unknown/u, (x) => { x.judgments[0].reviewerAgent = "unknown"; }],
  ["malformed score", /accuracy must be an integer/u, (x) => { x.judgments[0].accuracy = "80"; }],
  ["out-of-range score", /accuracy is out of range/u, (x) => { x.judgments[0].accuracy = 101; }],
  ["score of 49", /peer accuracy is below 50/u, (x) => { x.judgments[0].accuracy = 49; }],
  ["empty judgment rationale", /judgment rationale is empty/u, (x) => { x.judgments[0].rationale = ""; }],
  ["missing rubric findings", /rubric findings are missing/u, (x) => { x.judgments[0].rubricFindings = []; }],
  ["judgment does not match review session", /reviewer judgments do not match the review session/u, (x) => { const session = x.sessions.find(({ role }) => role === "review"); session.judgments[0] = { ...session.judgments[0], accuracy: 79 }; }],
  ["answer sessionId mismatch", /answer sessionId does not match its session/u, (x) => { x.answers[0].sessionId = "wrong"; }],
  ["agent failure", /answer agent failed or timed out/u, (x) => { x.answers[0].status = "failed"; }],
  ["agent timeout", /answer agent failed or timed out/u, (x) => { x.answers[0].status = "timeout"; }],
  ["empty answer", /answer is empty/u, (x) => { x.answers[0].answer = ""; }],
  ["incomplete orchestration JSONL", /orchestration conversation is incomplete/u, (x) => { x.orchestration.pop(); }],
  ["retained orchestration drift", /retained orchestration differs from asserted events/u, (x) => { x.files["orchestration.jsonl"] = x.files["orchestration.jsonl"].replace("answer_prompt", "wrong_event"); }],
  ["orchestration pair is incomplete", /orchestration request\/response pair is incomplete/u, (x) => rewriteOrchestration(x, (events) => { events[0].questionId = "Q02"; })],
  ["orchestration direction is incomplete", /orchestration request\/response direction is incomplete/u, (x) => rewriteOrchestration(x, (events) => { events.find(({ questionId, phase, agent, direction }) => questionId === "Q01" && phase === "answer" && agent === "claude" && direction === "response").direction = "request"; })],
  ["orchestration timestamps are reversed", /orchestration request timestamp is after its response/u, (x) => rewriteOrchestration(x, (events) => { events.find(({ questionId, phase, agent, direction }) => questionId === "Q01" && phase === "answer" && agent === "claude" && direction === "request").timestamp = "2026-11-07T09:00:00"; })],
  ["missing session transcript", /session transcript is missing/u, (x) => { delete x.files[x.sessions[0].transcriptPath]; }],
  ["retained questions drift", /retained questions differ from the canonical fixture/u, (x) => { x.files["questions.json"] = "{}\n"; }],
  ["retained answers drift", /retained answers differ from asserted answers/u, (x) => { x.files["answers.json"] = "[]\n"; }],
  ["retained judgments drift", /retained judgments differ from asserted judgments/u, (x) => { x.files["peer-judgments.json"] = "[]\n"; }],
  ["retained sessions drift", /retained sessions differ from asserted sessions/u, (x) => { x.files["sessions.json"] = "[]\n"; }],
  ["retained summary count drift", /retained summary counts are wrong/u, (x) => { const summary = JSON.parse(x.files["summary.json"]); summary.counts.sessions = 39; x.files["summary.json"] = `${JSON.stringify(summary)}\n`; }],
  ["manifest size mismatch", /manifest size mismatch/u, (x) => { x.manifest.entries[0].size += 1; }],
  ["manifest hash mismatch", /manifest hash mismatch/u, (x) => { x.manifest.entries[0].sha256 = "0".repeat(64); }],
  ["manifest effort mismatch", /manifest effort is not medium/u, (x) => { x.manifest.effort = "high"; }],
  ["target effort mismatch", /manifest effort is not medium/u, (x) => { x.manifest.targets.claude.effort = "high"; }],
  ["target version missing", /executable version is missing/u, (x) => { x.manifest.targets.claude.version = ""; }],
  ["missing tested source file", /tested source file is missing/u, (x) => { delete x.sourceFiles[x.manifest.sourceFiles[0].path]; }],
  ["tested source size mismatch", /tested source size mismatch/u, (x) => { x.manifest.sourceFiles[0].size += 1; }],
  ["tested source hash mismatch", /tested source hash mismatch/u, (x) => { x.sourceFiles[x.manifest.sourceFiles[0].path] = "y"; }],
  ["duplicate manifest path", /duplicate manifest path/u, (x) => { x.manifest.entries[1].path = x.manifest.entries[0].path; }],
  ["manifest missing retained file", /manifest does not cover every retained file/u, (x) => { x.files["unexpected.txt"] = "unexpected"; }],
  ["manifest entry missing file", /manifest path is missing: stderr\/relay\.log/u, (x) => { delete x.files["stderr/relay.log"]; }],
  ["missing tested source validation", /archive receipt checks are incomplete/u, (x) => { x.archive.validationReceipt.checks.pop(); }],
  ["archive receipt predates manifest completion", /archive receipt predates the completed manifest/u, (x) => { x.archive.validationReceipt.validatedAt = "2026-11-07T07:59:59"; }],
  ["unreadable archive", /archive is unreadable/u, (x) => { x.archive.readable = false; }],
  ["invalid archive SHA-256", /archive SHA-256 is invalid/u, (x) => { x.archive.sha256 = "invalid"; }],
  ["duplicate archive member", /archive contains duplicate members/u, (x) => { x.archive.members.push(x.archive.members[0]); }],
  ["missing archive member", /archive member is missing/u, (x) => { x.archive.members = x.archive.members.filter((path) => path !== "questions.json"); }],
  ["archive receipt hash mismatch", /archive receipt hash mismatch/u, (x) => { x.archive.validationReceipt.zipSha256 = "B".repeat(64); }],
  ["archive receipt member count mismatch", /archive receipt member count mismatch/u, (x) => { x.archive.validationReceipt.memberCount += 1; }],
  ["archive receipt member set mismatch", /archive receipt member set mismatch/u, (x) => { x.archive.validationReceipt.members[0] = "unexpected.txt"; }],
  ["archive receipt status mismatch", /archive receipt status mismatch/u, (x) => { x.archive.validationReceipt.status = "failed"; }],
  ["tested source count mismatch", /tested source count mismatch/u, (x) => { x.archive.validationReceipt.sourceFileCount += 1; }],
  ["required JUnit member missing", /required report archive member is missing: reports\/four-agent\.node\.junit\.xml/u, (x) => { delete x.files["reports/four-agent.node.junit.xml"]; }],
  ["required TRX member missing", /required report archive member is missing: reports\/Frenemy\.Relay\.IntegrationTests\.trx/u, (x) => { delete x.files["reports/Frenemy.Relay.IntegrationTests.trx"]; }],
];

test("FourAgentReasoningMockTests every planned negative mutation is rejected", async (t) => {
  for (const [name, expectedMessage, mutate] of negativeControls) {
    await t.test(name, () => {
      const evidence = createScriptedEvidence(fixture);
      mutate(evidence);
      assert.throws(() => assertFourAgentEvidence(evidence), expectedMessage);
    });
  }
});

test("FourAgentReasoningMockTests invalid Q01 evidence prevents any Q02 session request", async () => {
  const evidence = createScriptedEvidence(fixture);
  const requestedQuestions = [];
  await assert.rejects(
    runQuestionSequence(fixture.questions, async (question) => {
      requestedQuestions.push(question.id);
      const judgments = evidence.judgments.filter(({ questionId }) => questionId === question.id).map((judgment) => ({ ...judgment }));
      if (question.id === "Q01") judgments[0].accuracy = 49;
      return {
        answers: evidence.answers.filter(({ questionId }) => questionId === question.id),
        judgments,
        sessions: evidence.sessions.filter(({ questionId }) => questionId === question.id),
        files: evidence.files,
      };
    }),
    /peer accuracy is below 50/u,
  );
  assert.deepStrictEqual(requestedQuestions, ["Q01"]);
});

const sequenceControls = [
  ["missing Q01 answer", /^Q01 answer set is incomplete$/u, ({ answers }) => { answers.pop(); }],
  ["missing Q01 review session", /^Q01 review sessions are incomplete$/u, ({ sessions }) => { const index = sessions.findIndex(({ role }) => role === "review"); sessions.splice(index, 1); }],
  ["only 11 Q01 judgments", /^Q01 judgment set is incomplete$/u, ({ judgments }) => { judgments.pop(); }],
  ["Q01 answer session identity mismatch", /^Q01 answer sessionId does not match its session$/u, ({ answers }) => { answers[0].sessionId = "wrong"; }],
  ["Q01 answer wrong question identity", /^Q01 answer has wrong question identity$/u, ({ answers }) => { answers[0].questionId = "Q99"; }],
  ["Q01 answer high effort", /^Q01 answer effort is not medium$/u, ({ answers }) => { answers[0].effort = "high"; }],
  ["Q01 answer failed status", /^Q01 answer record status is not completed$/u, ({ answers }) => { answers[0].status = "failed"; }],
  ["Q01 empty answer", /^Q01 answer is empty$/u, ({ answers }) => { answers[0].answer = ""; }],
  ["Q01 duplicate answer participant", /^Q01 answer participants are incomplete$/u, ({ answers }) => { answers[1].agent = answers[0].agent; }],
  ["Q01 missing answer session", /^Q01 answer sessions are incomplete$/u, ({ sessions }) => { const index = sessions.findIndex(({ role }) => role === "answer"); sessions.splice(index, 1); }],
  ["Q01 duplicate answer-session participant", /^Q01 answer-session participants are incomplete$/u, ({ sessions }) => { const answerSessions = sessions.filter(({ role }) => role === "answer"); answerSessions[1].agent = answerSessions[0].agent; }],
  ["Q01 duplicate review-session participant", /^Q01 review-session participants are incomplete$/u, ({ sessions }) => { const reviewSessions = sessions.filter(({ role }) => role === "review"); reviewSessions[1].agent = reviewSessions[0].agent; }],
  ["Q01 session wrong question identity", /^Q01 session has wrong question identity$/u, ({ sessions }) => { sessions[0].questionId = "Q99"; }],
  ["Q01 session high effort", /^Q01 session effort is not medium$/u, ({ sessions }) => { sessions[0].effort = "high"; }],
  ["Q01 session failed status", /^Q01 retained session status is not completed$/u, ({ sessions }) => { sessions[0].status = "failed"; }],
];

const loaderControls = [
  ["loader requirement identity", /^wrong fixture requirement identity$/u, (x) => { x.requirementId = "TEST-WRONG"; }],
  ["loader effort", /^fixture effort must be medium$/u, (x) => { x.effort = "high"; }],
  ["loader participants", /^fixture participant identities drifted$/u, (x) => { x.participants.pop(); }],
  ["loader question count", /^fixture must contain five questions$/u, (x) => { x.questions.pop(); }],
  ["loader duplicate question identity", /^question identities must be unique$/u, (x) => { x.questions[1].id = "Q01"; }],
  ["loader invalid question identity", /^invalid question identity$/u, (x) => { x.questions[0].id = "Q99"; }],
  ["loader question AC identity", /^loader question AC identity drifted$/u, (x) => { x.questions[0].acceptanceCriterionId = "AC-WRONG"; }],
  ["loader empty question", /^Q01 question is empty$/u, (x) => { x.questions[0].question = ""; }],
  ["loader empty rubric", /^Q01 rubric is empty$/u, (x) => { x.questions[0].rubric = ""; }],
  ["loader canonical AC hash", /^Q01 loader canonical AC hash drifted$/u, (x) => { x.questions[0].acceptanceCriterionSha256 = "0".repeat(64); }],
  ["loader AC projection hash", /^Q01 loader AC projection hash mismatch$/u, (x) => { x.questions[0].acceptanceCriterionText += " altered"; }],
  ["loader exact question projection", /^Q01 loader exact question is not present in the AC projection$/u, (x) => { x.questions[0].question += " altered"; }],
  ["loader rubric projection", /^Q01 loader rubric drifted from the AC projection$/u, (x) => { x.questions[0].rubric += " altered"; }],
];

const justifiedRedundantAssertionPatterns = [
  { pattern: /canonical rubric is missing/u, reason: "Both loader and core missing-rubric sites are dominated by their preceding expected-hash and computed-hash checks, so changing the projected AC text to remove the rubric is rejected before either site can execute." },
  { pattern: /answer session has no retained answer/u, reason: "The complete answer-set and answer-to-session identity controls cover the same missing relationship." },
  { pattern: /answer has no matching session|reviewer judgment count is wrong/u, reason: "The direct answer-to-session identity and reviewer-session judgment equality controls reject the same missing relationship before advancement." },
  { pattern: /required retained core member is missing/u, reason: "The six core members are required by retained-evidence equality assertions, session-inventory controls, and exact archive-member controls." },
];

function firstAssertionLine(error) {
  return error.message.split("\n", 1)[0];
}

const reachedDirectControlMessages = [];

function assertReachedControl(action, expectedMessage) {
  let observedError;
  try {
    action();
  }
  catch (error) {
    observedError = error;
  }
  assert.ok(observedError, "direct negative control unexpectedly passed");
  const observedMessage = firstAssertionLine(observedError);
  assert.match(observedMessage, expectedMessage);
  reachedDirectControlMessages.push(observedMessage);
}

function reachedMessageMatchesLiteral(reachedMessage, literalMessage) {
  const escapedParts = literalMessage.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  return new RegExp(`^${escapedParts.join(".+")}$`, "u").test(reachedMessage);
}

async function collectReachedControlMessages() {
  const reached = [];
  for (const [, expectedMessage, mutate] of negativeControls) {
    const evidence = createScriptedEvidence(fixture);
    mutate(evidence);
    try {
      assertFourAgentEvidence(evidence);
      assert.fail("negative control unexpectedly passed");
    }
    catch (error) {
      const observedMessage = firstAssertionLine(error);
      assert.match(observedMessage, expectedMessage);
      reached.push(observedMessage);
    }
  }
  for (const [, expectedMessage, mutate] of sequenceControls) {
    const evidence = createScriptedEvidence(fixture);
    const requestedQuestions = [];
    try {
      await runQuestionSequence(fixture.questions, async (question) => {
        requestedQuestions.push(question.id);
        const result = {
          answers: evidence.answers.filter(({ questionId }) => questionId === question.id).map((item) => ({ ...item })),
          judgments: evidence.judgments.filter(({ questionId }) => questionId === question.id).map((item) => ({ ...item })),
          sessions: evidence.sessions.filter(({ questionId }) => questionId === question.id).map((item) => structuredClone(item)),
          files: evidence.files,
        };
        if (question.id === "Q01") mutate(result);
        return result;
      });
      assert.fail("sequence control unexpectedly passed");
    }
    catch (error) {
      const observedMessage = firstAssertionLine(error);
      assert.match(observedMessage, expectedMessage);
      assert.deepStrictEqual(requestedQuestions, ["Q01"]);
      reached.push(observedMessage);
    }
  }
  const loaderDirectory = mkdtempSync(join(tmpdir(), "frenemy-loader-controls-"));
  try {
    for (const [name, expectedMessage, mutate] of loaderControls) {
      const candidate = structuredClone(fixture);
      mutate(candidate);
      const path = join(loaderDirectory, `${name.replaceAll(" ", "-")}.json`);
      writeFileSync(path, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
      try {
        loadQuestionFixture(path);
        assert.fail("loader control unexpectedly passed");
      }
      catch (error) {
        const observedMessage = firstAssertionLine(error);
        assert.match(observedMessage, expectedMessage);
        reached.push(observedMessage);
      }
    }
  }
  finally {
    rmSync(loaderDirectory, { recursive: true, force: true });
  }
  return reached;
}

test("FourAgentReasoningMockTests every incomplete Q01 branch prevents any Q02 session request", async (t) => {
  for (const [name, expectedMessage, mutate] of sequenceControls) {
    await t.test(name, async () => {
      const evidence = createScriptedEvidence(fixture);
      const requestedQuestions = [];
      await assert.rejects(
        runQuestionSequence(fixture.questions, async (question) => {
          requestedQuestions.push(question.id);
          const result = {
            answers: evidence.answers.filter(({ questionId }) => questionId === question.id).map((item) => ({ ...item })),
            judgments: evidence.judgments.filter(({ questionId }) => questionId === question.id).map((item) => ({ ...item })),
            sessions: evidence.sessions.filter(({ questionId }) => questionId === question.id).map((item) => structuredClone(item)),
            files: evidence.files,
          };
          if (question.id === "Q01") mutate(result);
          return result;
        }),
        (error) => {
          assert.match(firstAssertionLine(error), expectedMessage);
          return true;
        },
      );
      assert.deepStrictEqual(requestedQuestions, ["Q01"]);
    });
  }
});

test("FourAgentReasoningMockTests ZIP parser accepts deterministic bytes and rejects corruption", async (t) => {
  const zip = createStoredZip({ "manifest.json": "{}\n", "sessions/claude/Q01/answer.jsonl": "{\"ok\":true}\n" });
  const files = inspectZipArchive(zip);
  assert.deepStrictEqual([...files.keys()], ["manifest.json", "sessions/claude/Q01/answer.jsonl"]);
  assert.equal(files.get("manifest.json").toString("utf8"), "{}\n");

  const deflated = createDeflatedZip({ "manifest.json": "{}\n" });
  assert.equal(inspectZipArchive(deflated).get("manifest.json").toString("utf8"), "{}\n");

  await t.test("non-buffer ZIP input", () => assertReachedControl(() => inspectZipArchive("not-a-buffer"), /ZIP input must be a Buffer/u));
  await t.test("short ZIP buffer", () => assertReachedControl(() => inspectZipArchive(Buffer.alloc(21)), /ZIP is truncated/u));
  await t.test("empty member name", () => assertReachedControl(() => inspectZipArchive(createStoredZip({ "": "empty" })), /ZIP member name is empty/u));
  await t.test("truncated ZIP", () => assertReachedControl(() => inspectZipArchive(zip.subarray(0, zip.length - 22)), /end record is missing/u));
  await t.test("invalid local signature", () => {
    const mutated = Buffer.from(zip);
    mutated.writeUInt32LE(0, 0);
    assertReachedControl(() => inspectZipArchive(mutated), /local signature is invalid/u);
  });
  await t.test("member CRC mismatch", () => {
    const mutated = Buffer.from(zip);
    const contentOffset = 30 + Buffer.byteLength("manifest.json", "utf8");
    mutated[contentOffset] ^= 0x01;
    assertReachedControl(() => inspectZipArchive(mutated), /CRC mismatch/u);
  });
  await t.test("duplicate member name", () => {
    const duplicate = createStoredZip([["same.txt", "one"], ["same.txt", "two"]]);
    assertReachedControl(() => inspectZipArchive(duplicate), /duplicate member/u);
  });
  await t.test("truncated member data", () => {
    const mutated = Buffer.from(zip);
    const endOffset = mutated.length - 22;
    const centralOffset = mutated.readUInt32LE(endOffset + 16);
    mutated.writeUInt32LE(0x7FFFFFFF, centralOffset + 20);
    assertReachedControl(() => inspectZipArchive(mutated), /member is truncated/u);
  });
  await t.test("invalid central directory signature", () => {
    const mutated = Buffer.from(zip);
    const endOffset = mutated.length - 22;
    const centralOffset = mutated.readUInt32LE(endOffset + 16);
    mutated.writeUInt32LE(0, centralOffset);
    assertReachedControl(() => inspectZipArchive(mutated), /central signature is invalid/u);
  });
  await t.test("central directory out of bounds", () => {
    const mutated = Buffer.from(zip);
    const endOffset = mutated.length - 22;
    mutated.writeUInt32LE(mutated.readUInt32LE(endOffset + 12) + 1, endOffset + 12);
    assertReachedControl(() => inspectZipArchive(mutated), /central directory is out of bounds/u);
  });
  await t.test("central entry is truncated", () => {
    const mutated = Buffer.from(zip);
    const endOffset = mutated.length - 22;
    mutated.writeUInt16LE(mutated.readUInt16LE(endOffset + 10) + 1, endOffset + 10);
    assertReachedControl(() => inspectZipArchive(mutated), /central entry is truncated/u);
  });
  await t.test("central entry data is truncated", () => {
    const mutated = Buffer.from(zip);
    const endOffset = mutated.length - 22;
    const centralOffset = mutated.readUInt32LE(endOffset + 16);
    mutated.writeUInt16LE(mutated.readUInt32LE(endOffset + 12), centralOffset + 28);
    assertReachedControl(() => inspectZipArchive(mutated), /central entry data is truncated/u);
  });
  await t.test("local entry is out of bounds", () => {
    const mutated = Buffer.from(zip);
    const endOffset = mutated.length - 22;
    const centralOffset = mutated.readUInt32LE(endOffset + 16);
    mutated.writeUInt32LE(centralOffset, centralOffset + 42);
    assertReachedControl(() => inspectZipArchive(mutated), /local entry is out of bounds/u);
  });
  await t.test("unsupported compression method", () => {
    const mutated = Buffer.from(zip);
    const endOffset = mutated.length - 22;
    const centralOffset = mutated.readUInt32LE(endOffset + 16);
    mutated.writeUInt16LE(99, centralOffset + 10);
    assertReachedControl(() => inspectZipArchive(mutated), /compression method is unsupported/u);
  });
  await t.test("uncompressed size mismatch", () => {
    const mutated = Buffer.from(zip);
    const endOffset = mutated.length - 22;
    const centralOffset = mutated.readUInt32LE(endOffset + 16);
    mutated.writeUInt32LE(mutated.readUInt32LE(centralOffset + 24) + 1, centralOffset + 24);
    assertReachedControl(() => inspectZipArchive(mutated), /member size mismatch/u);
  });
  await t.test("central directory size mismatch", () => {
    const mutated = Buffer.from(zip);
    const endOffset = mutated.length - 22;
    mutated.writeUInt16LE(1, endOffset + 8);
    mutated.writeUInt16LE(1, endOffset + 10);
    assertReachedControl(() => inspectZipArchive(mutated), /central directory size mismatch/u);
  });
});

test("FourAgentReasoningMockTests archive evidence is derived from exact ZIP bytes", async (t) => {
  const correct = createScriptedEvidence(fixture);
  const correctArchive = createArchiveFixture(correct);
  const correctEvidence = deriveArchiveEvidence(correctArchive.bytes, correctArchive.validationReceipt, correct.sourceFiles, fixture);
  assert.doesNotThrow(() => assertFourAgentArchiveEvidence(correctEvidence));

  await t.test("missing manifest.json", () => {
    const bytes = createStoredZip({ "questions.json": "{}\n" });
    assertReachedControl(() => deriveArchiveEvidence(bytes, {}, correct.sourceFiles, fixture), /has no manifest\.json/u);
  });

  await t.test("manifest defines duplicate members", () => {
    const evidence = createScriptedEvidence(fixture);
    evidence.manifest.entries[1].path = evidence.manifest.entries[0].path;
    const archive = createArchiveFixture(evidence);
    assertReachedControl(() => deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture), /manifest defines duplicate archive members/u);
  });

  await t.test("extra ZIP member", () => {
    const archive = createArchiveFixture(correct, [...Object.entries(correct.files), ["unexpected.txt", "extra"]]);
    assertReachedControl(() => deriveArchiveEvidence(archive.bytes, archive.validationReceipt, correct.sourceFiles, fixture), /member set differs/u);
  });

  await t.test("missing ZIP member", () => {
    const entries = Object.entries(correct.files).filter(([path]) => path !== "questions.json");
    const archive = createArchiveFixture(correct, entries);
    assertReachedControl(() => deriveArchiveEvidence(archive.bytes, archive.validationReceipt, correct.sourceFiles, fixture), /member set differs/u);
  });

  await t.test("manifest member size mismatch", () => {
    const evidence = createScriptedEvidence(fixture);
    evidence.manifest.entries[0].size += 1;
    const archive = createArchiveFixture(evidence);
    const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
    assertReachedControl(() => assertFourAgentArchiveEvidence(derived), /manifest size mismatch/u);
  });

  await t.test("passed archive questions differ from canonical fixture", () => {
    const evidence = createScriptedEvidence(fixture);
    const questions = JSON.parse(evidence.files["questions.json"]);
    questions.questions[0].question = "substituted";
    evidence.files["questions.json"] = `${JSON.stringify(questions, null, 2)}\n`;
    rebuildManifestEntries(evidence);
    const archive = createArchiveFixture(evidence);
    const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
    assertReachedControl(() => assertFourAgentArchiveEvidence(derived), /differ from the canonical fixture/u);
  });

  await t.test("passed archive summary counts are exact", () => {
    const evidence = createScriptedEvidence(fixture);
    const summary = JSON.parse(evidence.files["summary.json"]);
    summary.counts.answers = 19;
    evidence.files["summary.json"] = JSON.stringify(summary, null, 2) + "\n";
    rebuildManifestEntries(evidence);
    const archive = createArchiveFixture(evidence);
    const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
    assertReachedControl(() => assertFourAgentArchiveEvidence(derived), /passed archive summary counts are wrong/u);
  });

  await t.test("archive summary status matches manifest", () => {
    const evidence = createScriptedEvidence(fixture);
    const summary = JSON.parse(evidence.files["summary.json"]);
    summary.status = "failed";
    evidence.files["summary.json"] = JSON.stringify(summary, null, 2) + "\n";
    rebuildManifestEntries(evidence);
    const archive = createArchiveFixture(evidence);
    const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
    assertReachedControl(() => assertFourAgentArchiveEvidence(derived), /summary status differs from manifest status/u);
  });

  await t.test("failed archive requires run-failure evidence", () => {
    const evidence = createScriptedEvidence(fixture);
    evidence.manifest.status = "failed";
    const summary = JSON.parse(evidence.files["summary.json"]);
    summary.status = "failed";
    evidence.files["summary.json"] = `${JSON.stringify(summary, null, 2)}\n`;
    rebuildManifestEntries(evidence);
    const archive = createArchiveFixture(evidence);
    const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
    assertReachedControl(() => assertFourAgentArchiveEvidence(derived), /has no run-failure.json/u);
  });

  await t.test("failed archive summary must be failed", () => {
    const evidence = createScriptedEvidence(fixture);
    evidence.manifest.status = "unknown";
    const summary = JSON.parse(evidence.files["summary.json"]);
    summary.status = "unknown";
    evidence.files["summary.json"] = `${JSON.stringify(summary, null, 2)}\n`;
    evidence.files["run-failure.json"] = `${JSON.stringify({ status: "failed", message: "scripted failure" }, null, 2)}\n`;
    rebuildManifestEntries(evidence);
    const archive = createArchiveFixture(evidence);
    const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
    assertReachedControl(() => assertFourAgentArchiveEvidence(derived), /failed archive summary is not failed/u);
  });

  await t.test("failed archive summary session count matches inventory", () => {
    const evidence = createScriptedEvidence(fixture);
    evidence.manifest.status = "failed";
    const summary = JSON.parse(evidence.files["summary.json"]);
    summary.status = "failed";
    summary.counts.sessions -= 1;
    evidence.files["summary.json"] = `${JSON.stringify(summary, null, 2)}\n`;
    evidence.files["run-failure.json"] = `${JSON.stringify({ status: "failed", message: "scripted failure" }, null, 2)}\n`;
    rebuildManifestEntries(evidence);
    const archive = createArchiveFixture(evidence);
    const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
    assertReachedControl(() => assertFourAgentArchiveEvidence(derived), /archive summary session count differs from sessions\.json/u);
  });

  await t.test("failed archive transcript inventory matches sessions.json", () => {
    const evidence = createScriptedEvidence(fixture);
    evidence.manifest.status = "failed";
    const summary = JSON.parse(evidence.files["summary.json"]);
    summary.status = "failed";
    summary.counts.sessions -= 1;
    evidence.files["summary.json"] = `${JSON.stringify(summary, null, 2)}\n`;
    const sessions = JSON.parse(evidence.files["sessions.json"]);
    sessions.pop();
    evidence.files["sessions.json"] = `${JSON.stringify(sessions, null, 2)}\n`;
    evidence.files["run-failure.json"] = `${JSON.stringify({ status: "failed", message: "scripted failure" }, null, 2)}\n`;
    rebuildManifestEntries(evidence);
    const archive = createArchiveFixture(evidence);
    const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
    assertReachedControl(() => assertFourAgentArchiveEvidence(derived), /retained transcript inventory differs from sessions\.json/u);
  });

  for (const [name, direction, expected] of [
    ["failed archive retains orchestration pair", null, /retained session orchestration pair is incomplete/u],
    ["failed archive retains orchestration request", "response", /retained session orchestration request is missing/u],
    ["failed archive retains orchestration result", "request", /retained session orchestration result is missing/u],
  ]) {
    await t.test(name, () => {
      const evidence = createScriptedEvidence(fixture);
      evidence.manifest.status = "failed";
      const summary = JSON.parse(evidence.files["summary.json"]);
      summary.status = "failed";
      evidence.files["summary.json"] = `${JSON.stringify(summary, null, 2)}\n`;
      if (direction === null) evidence.orchestration.shift();
      else if (direction === "response") evidence.orchestration[0].direction = direction;
      else evidence.orchestration[1].direction = direction;
      evidence.files["orchestration.jsonl"] = `${evidence.orchestration.map((item) => JSON.stringify(item)).join("\n")}\n`;
      evidence.files["run-failure.json"] = `${JSON.stringify({ status: "failed", message: "scripted failure" }, null, 2)}\n`;
      rebuildManifestEntries(evidence);
      const archive = createArchiveFixture(evidence);
      const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
      assertReachedControl(() => assertFourAgentArchiveEvidence(derived), expected);
    });
  }

  await t.test("failed archive rejects empty orchestration JSONL", () => {
    const evidence = createScriptedEvidence(fixture);
    evidence.manifest.status = "failed";
    const summary = JSON.parse(evidence.files["summary.json"]);
    summary.status = "failed";
    evidence.files["summary.json"] = `${JSON.stringify(summary, null, 2)}\n`;
    evidence.files["orchestration.jsonl"] = "";
    evidence.files["run-failure.json"] = `${JSON.stringify({ status: "failed", message: "scripted failure" }, null, 2)}\n`;
    rebuildManifestEntries(evidence);
    const archive = createArchiveFixture(evidence);
    const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
    assertReachedControl(() => assertFourAgentArchiveEvidence(derived), /archive orchestration: JSONL has no records/u);
  });

  await t.test("valid failed archive is accepted", () => {
    const evidence = createScriptedEvidence(fixture);
    evidence.manifest.status = "failed";
    const summary = JSON.parse(evidence.files["summary.json"]);
    summary.status = "failed";
    evidence.files["summary.json"] = JSON.stringify(summary, null, 2) + "\n";
    evidence.files["run-failure.json"] = JSON.stringify({ status: "failed", message: "scripted failure" }, null, 2) + "\n";
    rebuildManifestEntries(evidence);
    const archive = createArchiveFixture(evidence);
    const derived = deriveArchiveEvidence(archive.bytes, archive.validationReceipt, evidence.sourceFiles, fixture);
    assert.doesNotThrow(() => assertFourAgentArchiveEvidence(derived));
  });
});

test("FourAgentReasoningMockTests every literal contract assertion has a reached control or documented redundancy", async () => {
  const sources = [
    readFileSync(join(here, "..", "contracts", "four-agent-reasoning.mjs"), "utf8"),
    readFileSync(join(here, "..", "contracts", "zip-archive.mjs"), "utf8"),
  ];
  const messages = sources.flatMap(collectLiteralAssertionMessages);
  assert.ok(messages.length > 0, "assertion-message inventory is empty");
  const remainingReachedMessages = [...await collectReachedControlMessages(), ...reachedDirectControlMessages];
  const uncovered = messages.filter((message) => {
    const reachedIndex = remainingReachedMessages.findIndex((reachedMessage) => reachedMessageMatchesLiteral(reachedMessage, message));
    if (reachedIndex >= 0) {
      remainingReachedMessages.splice(reachedIndex, 1);
      return false;
    }
    return !justifiedRedundantAssertionPatterns.some(({ pattern, reason }) => reason && pattern.test(message));
  });
  assert.deepStrictEqual(uncovered, [], `assertion messages lack reached controls or justified redundancy: ${uncovered.join(" | ")}`);
});
