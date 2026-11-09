/**
 * @file Shared four-agent reasoning fixture, evidence, and validation contract.
 * @change 2026-11-07 FR-FRENEMY-117, TR-FRENEMY-ORCH-121,
 * TEST-FRENEMY-117, AC-FRENEMY-117-01 through AC-FRENEMY-117-05,
 * AC-TR-FRENEMY-ORCH-121-01 through AC-TR-FRENEMY-ORCH-121-06, and
 * AC-TEST-FRENEMY-117-Q01 through Q05 and AC-TEST-FRENEMY-117-06 through 08:
 * Added the canonical question projection, independent scripted evidence,
 * strict peer-judgment gate, session inventory, and review-archive contract.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-08: Compare
 * archive receipt members as an exact set so ZIP enumeration order is irrelevant.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 through 08:
 * Bind per-question advancement to complete judgment and transcript evidence,
 * and derive exact archive evidence from validated ZIP bytes.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06: Bind Cline
 * relay requests to the configured provider and model so substituted execution
 * settings are rejected by the same transcript contract.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-06 through 08:
 * Bind every retained transcript to session inventory, orchestration evidence,
 * and summary counts for passed and failed archives.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inspectZipArchive } from "./zip-archive.mjs";

export const PARTICIPANTS = Object.freeze(["claude", "codex", "grok", "cline"]);
export const EXPECTED_COUNTS = Object.freeze({ questions: 5, answers: 20, sessions: 40, judgments: 60 });
export const EXPECTED_AC_SHA256 = Object.freeze({
  Q01: "187C6F9D3D571E4E4642ADC0F5441B8719852322FDBC952ABC8F672F2DD7ED89",
  Q02: "20B47268ADD6F2A2F269B660F16A5548429599A1ACCABD6E2A09924C9DD19ACB",
  Q03: "D636555339A80AE68F1C461B46C59B96AAC4065B1F5ED41FEB8041999D6BFFA0",
  Q04: "7B55E71719FD2CB41CDFDFC71480EC1F39B0A7EFEE300F0235B885F732F765C5",
  Q05: "1F8A281A2D98D6A41B5BE0933EBAD955D4294ED0A80265B5EB331E868A47386B",
});
const READ_ONLY_TOOLS = Object.freeze({ claude: "ask_claude", grok: "ask_grok", cline: "ask_cline" });

/** Return an uppercase SHA-256 digest for UTF-8 text. */
export function sha256(value) {
  return createHash("sha256").update(value, typeof value === "string" ? "utf8" : undefined).digest("hex").toUpperCase();
}

/** Load and validate the version-controlled projection of TEST-FRENEMY-117. */
export function loadQuestionFixture(path) {
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(fixture.requirementId, "TEST-FRENEMY-117", "wrong fixture requirement identity");
  assert.equal(fixture.effort, "medium", "fixture effort must be medium");
  assert.deepStrictEqual(fixture.participants, PARTICIPANTS, "fixture participant identities drifted");
  assert.equal(fixture.questions.length, EXPECTED_COUNTS.questions, "fixture must contain five questions");
  assert.equal(new Set(fixture.questions.map(({ id }) => id)).size, EXPECTED_COUNTS.questions, "question identities must be unique");
  for (const question of fixture.questions) {
    assert.match(question.id, /^Q0[1-5]$/u, "invalid question identity");
    assert.equal(question.acceptanceCriterionId, `AC-TEST-FRENEMY-117-${question.id}`, "loader question AC identity drifted");
    assert.ok(question.question.trim(), `${question.id} question is empty`);
    assert.ok(question.rubric.trim(), `${question.id} rubric is empty`);
    assert.equal(question.acceptanceCriterionSha256, EXPECTED_AC_SHA256[question.id], `${question.id} loader canonical AC hash drifted`);
    assert.equal(sha256(question.acceptanceCriterionText), question.acceptanceCriterionSha256, `${question.id} loader AC projection hash mismatch`);
    assert.ok(question.acceptanceCriterionText.includes(`\"${question.question}\"`), `${question.id} loader exact question is not present in the AC projection`);
    const canonicalRubric = question.acceptanceCriterionText.match(/ Canonical rubric: (.+)$/u)?.[1];
    assert.ok(canonicalRubric, `${question.id} loader canonical rubric is missing from the AC projection`);
    assert.equal(canonicalRubric.toLocaleLowerCase("en-US"), question.rubric.toLocaleLowerCase("en-US"), `${question.id} loader rubric drifted from the AC projection`);
  }
  return fixture;
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

/** Build the exact answer prompt retained by both scripted and live sessions. */
export function answerPrompt(agent, question) {
  return [
    `You are the ${agent} participant in a controlled four-agent reasoning integration test.`,
    "Use medium reasoning effort. This question is self-contained.",
    "Do not inspect the workspace, browse, invoke tools, delegate, or modify files.",
    `Question ID: ${question.id}`,
    `Acceptance criterion: ${question.acceptanceCriterionId}`,
    `Subject: ${question.subject}`,
    `Question: ${question.question}`,
    "Return a concise answer with enough reasoning to make the calculation or causal argument reviewable.",
  ].join("\n");
}

/** Build the exact peer-review prompt retained by both scripted and live sessions. */
export function reviewPrompt(reviewerAgent, question, answers) {
  const subjects = answers.filter(({ agent }) => agent !== reviewerAgent).map(({ agent, answer }) => ({ subjectAgent: agent, answer }));
  return [
    `You are the ${reviewerAgent} peer reviewer in a controlled four-agent reasoning integration test.`,
    "Use medium reasoning effort. Do not inspect the workspace, browse, invoke tools, delegate, or modify files.",
    `Question ID: ${question.id}`,
    `Acceptance criterion: ${question.acceptanceCriterionId}`,
    `Question: ${question.question}`,
    `Canonical rubric: ${question.rubric}`,
    `Answers to review: ${JSON.stringify(subjects)}`,
    "Return only a JSON array of exactly three objects, with no markdown or surrounding text.",
    "Each object must contain questionId, subjectAgent, reviewerAgent, integer accuracy from 0 through 100, nonempty rationale, and nonempty rubricFindings array.",
    `Every reviewerAgent must be ${JSON.stringify(reviewerAgent)} and no subjectAgent may be ${JSON.stringify(reviewerAgent)}.`,
  ].join("\n");
}

function buildTranscript(runId, question, agent, role, payload, prompt) {
  const sessionId = `${runId}-${question.id}-${agent}-${role}`;
  const base = { runId, questionId: question.id, phase: role, agent, sessionId };
  const resultText = role === "answer" ? payload.answer : JSON.stringify(payload);
  const request = agent === "codex"
    ? { ...base, timestamp: "2026-11-07T08:00:00", direction: "request", eventType: "codex_prompt", payload: { prompt, argv: ["exec", "--sandbox", "read-only", "--json", "-c", "model_reasoning_effort=medium", "-"] } }
    : { ...base, timestamp: "2026-11-07T08:00:00", direction: "request", eventType: "relay_jsonrpc", payload: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: READ_ONLY_TOOLS[agent], arguments: { prompt, effort: "medium", ...(agent === "cline" ? { provider: "openai-codex", model: "gpt-5.6-luna" } : {}) } } } };
  return [
    request,
    agent === "codex"
      ? { ...base, timestamp: "2026-11-07T08:00:01", direction: "response", eventType: "agent_result", payload: { text: resultText } }
      : { ...base, timestamp: "2026-11-07T08:00:01", direction: "response", eventType: "relay_jsonrpc", payload: { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: resultText }], isError: false } } },
    { ...base, timestamp: "2026-11-07T08:00:02", direction: "internal", eventType: "session_exit", payload: { code: 0, signal: null } },
  ].map(jsonLine).join("");
}

/** Build deterministic correct evidence without invoking the relay or any agent CLI. */
export function createScriptedEvidence(sourceFixture, runId = "mock-four-agent-run") {
  const fixture = structuredClone(sourceFixture);
  const answers = [];
  const judgments = [];
  const sessions = [];
  const orchestration = [];
  const files = {};

  for (const question of fixture.questions) {
    for (const agent of PARTICIPANTS) {
      const answer = {
        questionId: question.id,
        agent,
        sessionId: `${runId}-${question.id}-${agent}-answer`,
        effort: "medium",
        status: "completed",
        answer: `${agent} scripted answer for ${question.id}`,
      };
      answers.push(answer);
      const path = `sessions/${agent}/${question.id}/answer.jsonl`;
      const prompt = answerPrompt(agent, question);
      files[path] = buildTranscript(runId, question, agent, "answer", answer, prompt);
      sessions.push({
        questionId: question.id,
        agent,
        role: "answer",
        sessionId: answer.sessionId,
        effort: "medium",
        status: "completed",
        transcriptPath: path,
        transcriptComplete: true,
        resultText: answer.answer,
        ...(agent === "codex" ? { argv: ["exec", "--sandbox", "read-only", "--json", "-c", "model_reasoning_effort=medium", "-"] } : {}),
        requestedConfiguration: agent === "cline" ? { effort: "medium", provider: "openai-codex", model: "gpt-5.6-luna" } : { effort: "medium" },
        ...(agent === "cline" ? { observedIdentities: [{ provider: "openai-codex", model: "gpt-5.6-luna" }] } : {}),
      });
      orchestration.push(
        { runId, questionId: question.id, phase: "answer", agent, sessionId: answer.sessionId, timestamp: "2026-11-07T08:00:00", direction: "request", eventType: "answer_prompt", payload: { effort: "medium" } },
        { runId, questionId: question.id, phase: "answer", agent, sessionId: answer.sessionId, timestamp: "2026-11-07T08:00:01", direction: "response", eventType: "answer_result", payload: answer },
      );
    }
    for (const reviewerAgent of PARTICIPANTS) {
      const reviewJudgments = PARTICIPANTS.filter((subjectAgent) => subjectAgent !== reviewerAgent).map((subjectAgent) => ({
        questionId: question.id,
        subjectAgent,
        reviewerAgent,
        accuracy: 80,
        rationale: `${reviewerAgent} found ${subjectAgent}'s answer materially accurate.`,
        rubricFindings: ["Matches the canonical rubric."],
      }));
      judgments.push(...reviewJudgments);
      const sessionId = `${runId}-${question.id}-${reviewerAgent}-review`;
      const path = `sessions/${reviewerAgent}/${question.id}/review.jsonl`;
      const prompt = reviewPrompt(reviewerAgent, question, answers.filter(({ questionId }) => questionId === question.id));
      files[path] = buildTranscript(runId, question, reviewerAgent, "review", reviewJudgments, prompt);
      sessions.push({
        questionId: question.id,
        agent: reviewerAgent,
        role: "review",
        sessionId,
        effort: "medium",
        status: "completed",
        transcriptPath: path,
        transcriptComplete: true,
        resultText: JSON.stringify(reviewJudgments),
        judgments: reviewJudgments,
        ...(reviewerAgent === "codex" ? { argv: ["exec", "--sandbox", "read-only", "--json", "-c", "model_reasoning_effort=medium", "-"] } : {}),
        requestedConfiguration: reviewerAgent === "cline" ? { effort: "medium", provider: "openai-codex", model: "gpt-5.6-luna" } : { effort: "medium" },
        ...(reviewerAgent === "cline" ? { observedIdentities: [{ provider: "openai-codex", model: "gpt-5.6-luna" }] } : {}),
      });
      orchestration.push(
        { runId, questionId: question.id, phase: "review", agent: reviewerAgent, sessionId, timestamp: "2026-11-07T08:00:02", direction: "request", eventType: "review_prompt", payload: { effort: "medium", subjects: reviewJudgments.map(({ subjectAgent }) => subjectAgent) } },
        { runId, questionId: question.id, phase: "review", agent: reviewerAgent, sessionId, timestamp: "2026-11-07T08:00:03", direction: "response", eventType: "review_result", payload: reviewJudgments },
      );
    }
  }

  files["questions.json"] = `${JSON.stringify(fixture, null, 2)}\n`;
  files["orchestration.jsonl"] = orchestration.map(jsonLine).join("");
  files["answers.json"] = `${JSON.stringify(answers, null, 2)}\n`;
  files["peer-judgments.json"] = `${JSON.stringify(judgments, null, 2)}\n`;
  files["sessions.json"] = `${JSON.stringify(sessions, null, 2)}\n`;
  files["summary.json"] = `${JSON.stringify({ runId, status: "passed", counts: EXPECTED_COUNTS }, null, 2)}\n`;
  files["reports/four-agent.node.junit.xml"] = "<testsuite tests=\"1\" failures=\"0\" skipped=\"0\" />\n";
  files["reports/Frenemy.Relay.IntegrationTests.trx"] = "<TestRun><ResultSummary outcome=\"Completed\" /></TestRun>\n";
  files["stderr/relay.log"] = "";

  const manifestEntries = Object.entries(files).map(([path, content]) => ({ path, size: Buffer.byteLength(content, "utf8"), sha256: sha256(content) }));
  const sourceFiles = { "tests/contracts/four-agent-reasoning.mjs": "x" };
  const manifest = {
    runId,
    gitHead: "mock-head",
    host: "mock-host",
    participants: PARTICIPANTS,
    effort: "medium",
    targets: Object.fromEntries(PARTICIPANTS.map((agent) => [agent, { version: `mock-${agent}-1.0`, effort: "medium" }])),
    status: "passed",
    startedAt: "2026-11-07T08:00:00",
    completedAt: "2026-11-07T08:00:04",
    sourceFiles: Object.entries(sourceFiles).map(([path, content]) => ({ path, size: Buffer.byteLength(content, "utf8"), sha256: sha256(content) })),
    entries: manifestEntries,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const zipSha256 = "A".repeat(64);
  const validationReceipt = {
    manifestSha256: sha256(manifestText),
    zipSha256,
    memberCount: manifestEntries.length + 1,
    members: [...Object.keys(files), "manifest.json"],
    status: "passed",
    checks: ["zip-readable", "member-set-exact", "manifest-hash", "member-size", "member-sha256", "tested-source-hash"],
    sourceFileCount: manifest.sourceFiles.length,
    validatedAt: "2026-11-07T08:00:05",
  };

  return {
    runId,
    fixture,
    participants: [...PARTICIPANTS],
    answers,
    judgments,
    sessions,
    orchestration,
    files,
    sourceFiles,
    manifest,
    archive: {
      readable: true,
      path: `${runId}-four-agent-reasoning-review.zip`,
      sha256: zipSha256,
      members: [...Object.keys(files), "manifest.json"],
      validationReceipt,
    },
  };
}

function assertJsonLines(content, message) {
  const lines = content.split(/\r?\n/u).filter(Boolean);
  assert.ok(lines.length > 0, `${message}: JSONL has no records`);
  for (const line of lines) JSON.parse(line);
}

function parseJsonLines(content, message) {
  assertJsonLines(content, message);
  return content.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function assertJudgment(judgment, judgmentKeys) {
  assert.ok(PARTICIPANTS.includes(judgment.subjectAgent), "judgment subject is unknown");
  assert.ok(PARTICIPANTS.includes(judgment.reviewerAgent), "judgment reviewer is unknown");
  assert.notEqual(judgment.subjectAgent, judgment.reviewerAgent, "self-review is forbidden");
  assert.ok(Number.isInteger(judgment.accuracy), "accuracy must be an integer");
  assert.ok(judgment.accuracy >= 0 && judgment.accuracy <= 100, "accuracy is out of range");
  assert.ok(judgment.accuracy >= 50, "peer accuracy is below 50");
  assert.ok(judgment.rationale.trim(), "judgment rationale is empty");
  assert.ok(Array.isArray(judgment.rubricFindings) && judgment.rubricFindings.length > 0, "rubric findings are missing");
  const key = `${judgment.questionId}:${judgment.subjectAgent}:${judgment.reviewerAgent}`;
  assert.ok(!judgmentKeys.has(key), "duplicate subject/reviewer pair");
  judgmentKeys.add(key);
}

function assertSessionTranscript({ question, answers, judgments, session, files }) {
  assert.equal(session.transcriptComplete, true, "session transcript is incomplete");
  assert.ok(Object.hasOwn(files, session.transcriptPath), "session transcript is missing");
  const transcript = parseJsonLines(files[session.transcriptPath], "session transcript is empty");
  assert.ok(transcript.every((item) => item.questionId === session.questionId && item.agent === session.agent && item.sessionId === session.sessionId), "session transcript identity does not match its session");
  const exit = transcript.find((item) => item.eventType === "session_exit");
  assert.ok(exit, "session transcript has no exit event");
  assert.equal(exit.payload?.code, 0, "session transcript exit code is not zero");

  const expectedPrompt = session.role === "answer"
    ? answerPrompt(session.agent, question)
    : reviewPrompt(session.agent, question, answers);
  assert.ok(typeof session.resultText === "string" && session.resultText.trim(), "session result text is missing");

  if (session.agent === "codex") {
    const request = transcript.find((item) => item.direction === "request" && item.eventType === "codex_prompt");
    assert.ok(request, "session transcript has no Codex prompt request");
    assert.equal(request.payload?.prompt, expectedPrompt, "Codex session prompt does not match the exact question and rubric");
    const sandboxIndex = request.payload?.argv?.indexOf("--sandbox") ?? -1;
    assert.ok(sandboxIndex >= 0 && request.payload.argv[sandboxIndex + 1] === "read-only", "Codex argv does not use the read-only sandbox");
    assert.ok(request.payload.argv.includes("model_reasoning_effort=medium"), "Codex argv does not request medium effort");
    const result = transcript.find((item) => item.direction === "response" && item.eventType === "agent_result");
    assert.ok(result, "session transcript has no retained agent result");
    assert.equal(result.payload?.text, session.resultText, "Codex session transcript result differs from retained result text");
  } else {
    const request = transcript.find((item) => item.direction === "request" && item.eventType === "relay_jsonrpc" && item.payload?.method === "tools/call");
    assert.ok(request, "session transcript has no relay tools/call request");
    assert.equal(request.payload.params?.name, READ_ONLY_TOOLS[session.agent], "relay request did not use the agent read-only tool");
    assert.equal(request.payload.params?.arguments?.prompt, expectedPrompt, "relay session prompt does not match the exact question and rubric");
    assert.equal(request.payload.params?.arguments?.effort, "medium", "relay request effort is not medium");
    if (session.agent === "cline") {
      assert.equal(request.payload.params?.arguments?.provider, "openai-codex", "Cline relay provider was substituted");
      assert.equal(request.payload.params?.arguments?.model, "gpt-5.6-luna", "Cline relay model was substituted");
    }
    const response = transcript.find((item) => item.direction === "response" && item.eventType === "relay_jsonrpc" && item.payload?.id === request.payload.id);
    assert.ok(response, "relay tools/call request has no matched response");
    assert.equal(response.payload.result?.isError, false, "relay tools/call response is an error");
    assert.equal(response.payload.result?.content?.[0]?.text, session.resultText, "relay session transcript result differs from retained result text");
  }

  if (session.role === "answer") {
    const answer = answers.find(({ agent }) => agent === session.agent);
    assert.ok(answer, "answer session has no retained answer");
    assert.equal(answer.answer, session.resultText, "retained answer differs from its session transcript result");
  } else {
    const expected = judgments.filter(({ reviewerAgent }) => reviewerAgent === session.agent);
    assert.deepStrictEqual(JSON.parse(session.resultText), expected, "parsed judgments differ from the session transcript result");
  }
}

/** Validate the agent/session contract shared by the mock and live providers. */
export function assertFourAgentCoreEvidence(evidence) {
  const fixture = evidence.fixture;
  assert.equal(fixture.questions.length, EXPECTED_COUNTS.questions, "wrong question count");
  assert.equal(new Set(fixture.questions.map(({ id }) => id)).size, EXPECTED_COUNTS.questions, "duplicate question identity");
  for (const question of fixture.questions) {
    assert.equal(question.acceptanceCriterionId, `AC-TEST-FRENEMY-117-${question.id}`, "core question AC identity drifted");
    assert.equal(question.acceptanceCriterionSha256, EXPECTED_AC_SHA256[question.id], `${question.id} core canonical AC hash drifted`);
    assert.equal(sha256(question.acceptanceCriterionText), question.acceptanceCriterionSha256, `${question.id} core AC projection hash mismatch`);
    assert.ok(question.acceptanceCriterionText.includes(`\"${question.question}\"`), `${question.id} core exact question is not present in the AC projection`);
    const canonicalRubric = question.acceptanceCriterionText.match(/ Canonical rubric: (.+)$/u)?.[1];
    assert.ok(canonicalRubric, `${question.id} core canonical rubric is missing from the AC projection`);
    assert.equal(canonicalRubric.toLocaleLowerCase("en-US"), question.rubric.toLocaleLowerCase("en-US"), `${question.id} core rubric drifted from the AC projection`);
  }
  assert.deepStrictEqual(evidence.participants, PARTICIPANTS, "missing or reordered participant");

  assert.equal(evidence.answers.length, EXPECTED_COUNTS.answers, "missing answer");
  const answerKeys = new Set();
  for (const answer of evidence.answers) {
    assert.ok(fixture.questions.some(({ id }) => id === answer.questionId), "answer has wrong question identity");
    assert.ok(PARTICIPANTS.includes(answer.agent), "answer has wrong participant identity");
    assert.equal(answer.effort, "medium", "answer effort is not medium");
    assert.equal(answer.status, "completed", "answer agent failed or timed out");
    assert.ok(answer.answer.trim(), "answer is empty");
    const key = `${answer.questionId}:${answer.agent}`;
    assert.ok(!answerKeys.has(key), "duplicate answer identity");
    answerKeys.add(key);
  }

  assert.equal(evidence.sessions.length, EXPECTED_COUNTS.sessions, "missing session");
  const sessionKeys = new Set();
  for (const session of evidence.sessions) {
    assert.ok(fixture.questions.some(({ id }) => id === session.questionId), "session has wrong question identity");
    assert.ok(PARTICIPANTS.includes(session.agent), "session has wrong participant identity");
    assert.ok(["answer", "review"].includes(session.role), "session has wrong role");
    assert.equal(session.effort, "medium", "session effort is not medium");
    assert.equal(session.status, "completed", "session failed or timed out");
    const key = `${session.questionId}:${session.agent}:${session.role}`;
    assert.ok(!sessionKeys.has(key), "duplicate session identity");
    sessionKeys.add(key);
    assert.equal(session.requestedConfiguration?.effort, "medium", "session requested configuration is not medium");
    if (session.agent === "codex") assert.ok(session.argv?.includes("model_reasoning_effort=medium"), "Codex session argv is not retained");
    if (session.agent === "cline") {
      assert.deepStrictEqual(session.requestedConfiguration, { effort: "medium", provider: "openai-codex", model: "gpt-5.6-luna" }, "Cline requested identity drifted");
      assert.ok(Array.isArray(session.observedIdentities) && session.observedIdentities.length > 0, "Cline observed identity is missing");
      for (const identity of session.observedIdentities) {
        assert.equal(identity.provider, "openai-codex", "Cline observed provider was substituted");
        assert.equal(identity.model, "gpt-5.6-luna", "Cline observed model was substituted");
      }
    }
    if (session.role === "review") assert.equal(session.judgments.length, 3, "review session must judge the other three agents");
  }

  assert.equal(evidence.judgments.length, EXPECTED_COUNTS.judgments, "missing judgment");
  const judgmentKeys = new Set();
  for (const judgment of evidence.judgments) {
    assert.ok(fixture.questions.some(({ id }) => id === judgment.questionId), "judgment has wrong question identity");
    assertJudgment(judgment, judgmentKeys);
  }

  for (const question of fixture.questions) {
    assertQuestionEvidence({
      question,
      answers: evidence.answers.filter((answer) => answer.questionId === question.id),
      judgments: evidence.judgments.filter((judgment) => judgment.questionId === question.id),
      sessions: evidence.sessions.filter((session) => session.questionId === question.id),
      files: evidence.files,
    });
  }

  assert.equal(evidence.orchestration.length, 80, "orchestration conversation is incomplete");
  const retainedOrchestration = parseJsonLines(evidence.files["orchestration.jsonl"], "orchestration JSONL is empty");
  assert.deepStrictEqual(retainedOrchestration, evidence.orchestration, "retained orchestration differs from asserted events");
  for (const question of fixture.questions) {
    for (const phase of ["answer", "review"]) {
      for (const agent of PARTICIPANTS) {
        const pair = evidence.orchestration.filter((item) => item.questionId === question.id && item.phase === phase && item.agent === agent);
        assert.equal(pair.length, 2, "orchestration request/response pair is incomplete");
        const request = pair.find(({ direction }) => direction === "request");
        const response = pair.find(({ direction }) => direction === "response");
        assert.ok(request && response, "orchestration request/response direction is incomplete");
        assert.ok(request.timestamp <= response.timestamp, "orchestration request timestamp is after its response");
      }
    }
  }
  assert.deepStrictEqual(JSON.parse(evidence.files["questions.json"]), fixture, "retained questions differ from the canonical fixture");
  assert.deepStrictEqual(JSON.parse(evidence.files["answers.json"]), evidence.answers, "retained answers differ from asserted answers");
  assert.deepStrictEqual(JSON.parse(evidence.files["peer-judgments.json"]), evidence.judgments, "retained judgments differ from asserted judgments");
  assert.deepStrictEqual(JSON.parse(evidence.files["sessions.json"]), evidence.sessions, "retained sessions differ from asserted sessions");
  const summary = JSON.parse(evidence.files["summary.json"]);
  assert.deepStrictEqual(summary.counts, EXPECTED_COUNTS, "retained summary counts are wrong");
  const requiredFiles = ["questions.json", "orchestration.jsonl", "answers.json", "peer-judgments.json", "sessions.json", "summary.json"];
  for (const path of requiredFiles) assert.ok(Object.hasOwn(evidence.files, path), `required retained core member is missing: ${path}`);
}

/** Validate one completed question before orchestration advances to the next. */
export function assertQuestionEvidence({ question, answers, judgments, sessions, files }) {
  assert.equal(answers.length, PARTICIPANTS.length, `${question.id} answer set is incomplete`);
  assert.deepStrictEqual(new Set(answers.map(({ agent }) => agent)), new Set(PARTICIPANTS), `${question.id} answer participants are incomplete`);
  for (const answer of answers) {
    assert.equal(answer.questionId, question.id, `${question.id} answer has wrong question identity`);
    assert.equal(answer.effort, "medium", `${question.id} answer effort is not medium`);
    assert.equal(answer.status, "completed", `${question.id} answer record status is not completed`);
    assert.ok(answer.answer.trim(), `${question.id} answer is empty`);
  }
  assert.equal(judgments.length, PARTICIPANTS.length * (PARTICIPANTS.length - 1), `${question.id} judgment set is incomplete`);
  const judgmentKeys = new Set();
  for (const judgment of judgments) assertJudgment(judgment, judgmentKeys);
  const answerSessions = sessions.filter(({ role }) => role === "answer");
  const reviewSessions = sessions.filter(({ role }) => role === "review");
  assert.equal(answerSessions.length, PARTICIPANTS.length, `${question.id} answer sessions are incomplete`);
  assert.equal(reviewSessions.length, PARTICIPANTS.length, `${question.id} review sessions are incomplete`);
  assert.deepStrictEqual(new Set(answerSessions.map(({ agent }) => agent)), new Set(PARTICIPANTS), `${question.id} answer-session participants are incomplete`);
  assert.deepStrictEqual(new Set(reviewSessions.map(({ agent }) => agent)), new Set(PARTICIPANTS), `${question.id} review-session participants are incomplete`);
  for (const answer of answers) {
    const session = answerSessions.find(({ agent }) => agent === answer.agent);
    assert.ok(session, `${question.id} answer has no matching session`);
    assert.equal(answer.sessionId, session.sessionId, `${question.id} answer sessionId does not match its session`);
  }
  for (const session of reviewSessions) {
    const expected = judgments.filter(({ reviewerAgent }) => reviewerAgent === session.agent);
    assert.equal(expected.length, PARTICIPANTS.length - 1, `${question.id} reviewer judgment count is wrong`);
    assert.deepStrictEqual(session.judgments, expected, `${question.id} reviewer judgments do not match the review session`);
  }
  for (const session of sessions) {
    assert.equal(session.questionId, question.id, `${question.id} session has wrong question identity`);
    assert.equal(session.effort, "medium", `${question.id} session effort is not medium`);
    assert.equal(session.status, "completed", `${question.id} retained session status is not completed`);
    assertSessionTranscript({ question, answers, judgments, session, files });
  }
}

/** Execute questions sequentially and reject invalid evidence before advancing. */
export async function runQuestionSequence(questions, executeQuestion) {
  for (const question of questions) {
    const evidence = await executeQuestion(question);
    assertQuestionEvidence({ question, ...evidence });
  }
}

/** Derive archive evidence from ZIP bytes rather than trusting receipt membership. */
export function deriveArchiveEvidence(zipBytes, validationReceipt, sourceFiles, fixture) {
  const archiveFiles = inspectZipArchive(zipBytes);
  assert.ok(archiveFiles.has("manifest.json"), "four-agent archive has no manifest.json");
  const manifest = JSON.parse(archiveFiles.get("manifest.json").toString("utf8"));
  const expectedMembers = [...manifest.entries.map(({ path }) => path), "manifest.json"];
  assert.equal(new Set(expectedMembers).size, expectedMembers.length, "manifest defines duplicate archive members");
  assert.deepStrictEqual(
    new Set(archiveFiles.keys()),
    new Set(expectedMembers),
    "ZIP member set differs from manifest entries plus manifest.json",
  );
  const files = Object.fromEntries([...archiveFiles.entries()]
    .filter(([path]) => path !== "manifest.json")
    .map(([path, content]) => [path, content.toString("utf8")]));
  return {
    files,
    sourceFiles,
    fixture,
    manifest,
    archive: {
      readable: true,
      sha256: sha256(zipBytes),
      members: [...archiveFiles.keys()],
      validationReceipt,
    },
  };
}

/** Validate the finalized manifest and archive receipt after real archive creation. */
export function assertFourAgentArchiveEvidence(evidence) {
  const requiredFiles = ["reports/four-agent.node.junit.xml", "reports/Frenemy.Relay.IntegrationTests.trx"];
  for (const path of requiredFiles) assert.ok(Object.hasOwn(evidence.files, path), `required report archive member is missing: ${path}`);
  const manifestPaths = new Set();
  assert.equal(evidence.manifest.effort, "medium", "manifest effort is not medium");
  for (const agent of PARTICIPANTS) {
    assert.equal(evidence.manifest.targets[agent].effort, "medium", `${agent} manifest effort is not medium`);
    assert.ok(evidence.manifest.targets[agent].version.trim(), `${agent} executable version is missing`);
  }
  for (const sourceFile of evidence.manifest.sourceFiles) {
    assert.ok(Object.hasOwn(evidence.sourceFiles, sourceFile.path), `tested source file is missing: ${sourceFile.path}`);
    assert.equal(sourceFile.size, Buffer.byteLength(evidence.sourceFiles[sourceFile.path], "utf8"), `tested source size mismatch: ${sourceFile.path}`);
    assert.equal(sourceFile.sha256, sha256(evidence.sourceFiles[sourceFile.path]), `tested source hash mismatch: ${sourceFile.path}`);
  }
  for (const entry of evidence.manifest.entries) {
    assert.ok(!manifestPaths.has(entry.path), "duplicate manifest path");
    manifestPaths.add(entry.path);
    assert.ok(Object.hasOwn(evidence.files, entry.path), `manifest path is missing: ${entry.path}`);
    assert.equal(entry.size, Buffer.byteLength(evidence.files[entry.path], "utf8"), `manifest size mismatch: ${entry.path}`);
    assert.equal(entry.sha256, sha256(evidence.files[entry.path]), `manifest hash mismatch: ${entry.path}`);
  }
  assert.equal(manifestPaths.size, Object.keys(evidence.files).length, "manifest does not cover every retained file");
  assert.equal(evidence.archive.readable, true, "archive is unreadable");
  assert.match(evidence.archive.sha256, /^[A-F0-9]{64}$/u, "archive SHA-256 is invalid");
  assert.equal(new Set(evidence.archive.members).size, evidence.archive.members.length, "archive contains duplicate members");
  for (const path of [...Object.keys(evidence.files), "manifest.json"]) assert.ok(evidence.archive.members.includes(path), `archive member is missing: ${path}`);
  assert.equal(evidence.archive.validationReceipt.zipSha256, evidence.archive.sha256, "archive receipt hash mismatch");
  assert.equal(evidence.archive.validationReceipt.memberCount, evidence.archive.members.length, "archive receipt member count mismatch");
  assert.deepStrictEqual(
    [...evidence.archive.validationReceipt.members].sort(),
    [...evidence.archive.members].sort(),
    "archive receipt member set mismatch",
  );
  assert.equal(evidence.archive.validationReceipt.status, evidence.manifest.status, "archive receipt status mismatch");
  assert.deepStrictEqual(
    evidence.archive.validationReceipt.checks,
    ["zip-readable", "member-set-exact", "manifest-hash", "member-size", "member-sha256", "tested-source-hash"],
    "archive receipt checks are incomplete",
  );
  assert.equal(evidence.archive.validationReceipt.sourceFileCount, evidence.manifest.sourceFiles.length, "tested source count mismatch");
  assert.ok(evidence.archive.validationReceipt.validatedAt >= evidence.manifest.completedAt, "archive receipt predates the completed manifest");
  const summary = JSON.parse(evidence.files["summary.json"]);
  assert.equal(summary.status, evidence.manifest.status, "archive summary status differs from manifest status");
  const retainedSessions = JSON.parse(evidence.files["sessions.json"]);
  const transcriptPaths = Object.keys(evidence.files).filter((path) => /^sessions\/(claude|codex|grok|cline)\/Q0[1-5]\/(answer|review)\.jsonl$/u.test(path));
  assert.equal(summary.counts.sessions, retainedSessions.length, "archive summary session count differs from sessions.json");
  assert.deepStrictEqual(new Set(transcriptPaths), new Set(retainedSessions.map(({ transcriptPath }) => transcriptPath)), "retained transcript inventory differs from sessions.json");
  const orchestration = parseJsonLines(evidence.files["orchestration.jsonl"], "archive orchestration");
  for (const session of retainedSessions) {
    const pair = orchestration.filter(({ sessionId }) => sessionId === session.sessionId);
    assert.equal(pair.length, 2, `retained session orchestration pair is incomplete: ${session.sessionId}`);
    assert.ok(pair.some(({ direction }) => direction === "request"), `retained session orchestration request is missing: ${session.sessionId}`);
    assert.ok(pair.some(({ direction }) => direction === "response"), `retained session orchestration result is missing: ${session.sessionId}`);
  }
  if (evidence.manifest.status === "passed") {
    const questions = JSON.parse(evidence.files["questions.json"]);
    assert.deepStrictEqual(questions, evidence.fixture, "passed archive questions differ from the canonical fixture");
    assert.deepStrictEqual(summary.counts, EXPECTED_COUNTS, "passed archive summary counts are wrong");
  } else {
    assert.ok(Object.hasOwn(evidence.files, "run-failure.json"), "failed archive has no run-failure.json");
    assert.equal(summary.status, "failed", "failed archive summary is not failed");
  }
}

/** Validate the complete deterministic test-side contract. */
export function assertFourAgentEvidence(evidence) {
  assertFourAgentCoreEvidence(evidence);
  assertFourAgentArchiveEvidence(evidence);
}
