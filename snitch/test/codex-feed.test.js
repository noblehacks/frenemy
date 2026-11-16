'use strict';
// Regression tests for snitch/extension/lib/codex-feed.js and its
// publish-codex-event.js publisher. Run with: node snitch/test/codex-feed.test.js
// Temp dirs are intentionally retained (no cleanup) per assignment instructions.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Wrap the publisher the feed calls. codex-feed.js calls it as a property of
// the module each time, so this counts real publish attempts without
// altering their behavior.
const publisher = require('../extension/lib/publish-codex-event.js');
const realPublish = publisher.publish;
let publishCount = 0;
publisher.publish = (...args) => { publishCount++; return realPublish(...args); };

const { CodexFeed } = require('../extension/lib/codex-feed.js');

function mkroot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `codex-feed-${prefix}-`));
}

function setup(prefix) {
  const root = mkroot(prefix);
  const sessionsDir = path.join(root, 'sessions');
  const jobsDir = path.join(root, 'jobs');
  fs.mkdirSync(sessionsDir, { recursive: true });
  return { root, sessionsDir, jobsDir };
}

function writeLines(file, lines) {
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
}

function appendLines(file, lines) {
  fs.appendFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
}

function iso(baseMs, offsetMs) {
  return new Date(baseMs + offsetMs).toISOString();
}

function readJob(jobsDir, id) {
  return JSON.parse(fs.readFileSync(path.join(jobsDir, `${id}.json`), 'utf8'));
}

function readTrail(jobsDir, id) {
  return fs.readFileSync(path.join(jobsDir, `${id}.trail`), 'utf8');
}

function computeId(sessionId, cwd) {
  const session = String(sessionId).replace(/[^A-Za-z0-9]/g, '');
  const folder = path.basename(cwd);
  const slug = folder.replace(/ /g, '-').replace(/[^A-Za-z0-9._-]/g, '') || 'codex';
  return `codex-${slug}-${session.slice(-6)}`;
}

test('session_meta (source vscode, id, cwd) + task_started/task_complete publishes a done job', () => {
  const { sessionsDir, jobsDir } = setup('meta-basic');
  const base = Date.now();
  const cwd = '/tmp/codex-feed-fixture/myproj';
  const sessionId = 'abcdef0123456789';
  const file = path.join(sessionsDir, 'rollout-a.jsonl');
  writeLines(file, [
    { type: 'session_meta', timestamp: iso(base, 0), payload: { source: 'vscode', id: sessionId, cwd } },
    { type: 'event_msg', timestamp: iso(base, 10), payload: { type: 'task_started' } },
    { type: 'event_msg', timestamp: iso(base, 20), payload: { type: 'task_complete' } },
  ]);

  const feed = new CodexFeed(sessionsDir, jobsDir);
  feed.update(file);

  const id = computeId(sessionId, cwd);
  const row = readJob(jobsDir, id);
  assert.equal(row.agent, 'codex');
  assert.equal(row.title, 'myproj');
  assert.equal(row.cwd, cwd);
  assert.equal(row.state, 'done');
  assert.equal(row.session_id, sessionId);
  assert.equal(row.source, 'codex-ide-events');
});

test('task_started publishes running/active before task_complete flips to done', () => {
  const { sessionsDir, jobsDir } = setup('task-transitions');
  const base = Date.now();
  const cwd = '/tmp/codex-feed-fixture/transitions';
  const sessionId = 'session-transitions-1';
  const file = path.join(sessionsDir, 'rollout-a.jsonl');
  writeLines(file, [
    { type: 'session_meta', timestamp: iso(base, 0), payload: { source: 'vscode', id: sessionId, cwd } },
    { type: 'event_msg', timestamp: iso(base, 10), payload: { type: 'task_started' } },
  ]);

  const feed = new CodexFeed(sessionsDir, jobsDir);
  feed.update(file);
  const id = computeId(sessionId, cwd);
  let row = readJob(jobsDir, id);
  assert.equal(row.state, 'running');
  assert.equal(row.note, 'Working in the IDE');

  appendLines(file, [{ type: 'event_msg', timestamp: iso(base, 20), payload: { type: 'task_complete' } }]);
  feed.update(file);
  row = readJob(jobsDir, id);
  assert.equal(row.state, 'done');
  assert.equal(row.note, 'Idle — waiting for you');
});

test('incremental response_item tool call/output builds the trail across separate update() calls', () => {
  const { sessionsDir, jobsDir } = setup('trail-incremental');
  const base = Date.now();
  const cwd = '/tmp/codex-feed-fixture/trailproj';
  const sessionId = 'session-trail-1';
  const file = path.join(sessionsDir, 'rollout-a.jsonl');
  writeLines(file, [
    { type: 'session_meta', timestamp: iso(base, 0), payload: { source: 'vscode', id: sessionId, cwd } },
    { type: 'event_msg', timestamp: iso(base, 10), payload: { type: 'task_started' } },
    { type: 'response_item', timestamp: iso(base, 20), payload: { type: 'function_call', call_id: 'call-1', name: 'apply_patch' } },
  ]);
  const feed = new CodexFeed(sessionsDir, jobsDir);
  const id = computeId(sessionId, cwd);
  feed.update(file);
  // Call started but not yet returned: no trail entry published yet.
  let state = feed.files.get(file);
  assert.equal(state.calls.get('call-1'), 'apply_patch');
  assert.equal(state.trail.length, 0);

  appendLines(file, [
    { type: 'response_item', timestamp: iso(base, 30), payload: { type: 'function_call_output', call_id: 'call-1' } },
  ]);
  feed.update(file);
  const row = readJob(jobsDir, id);
  assert.equal(row.state, 'running');
  const trail = readTrail(jobsDir, id);
  assert.match(trail, /\tEdited files\n$/);
  state = feed.files.get(file);
  assert.equal(state.calls.has('call-1'), false);
});

test('unchanged file on rescan does not re-invoke the publisher (no phantom heartbeat)', () => {
  const { sessionsDir, jobsDir } = setup('no-heartbeat');
  const base = Date.now();
  const cwd = '/tmp/codex-feed-fixture/heartbeat';
  const sessionId = 'session-heartbeat-1';
  const file = path.join(sessionsDir, 'rollout-a.jsonl');
  writeLines(file, [
    { type: 'session_meta', timestamp: iso(base, 0), payload: { source: 'vscode', id: sessionId, cwd } },
    { type: 'event_msg', timestamp: iso(base, 10), payload: { type: 'task_started' } },
    { type: 'event_msg', timestamp: iso(base, 20), payload: { type: 'task_complete' } },
  ]);
  const feed = new CodexFeed(sessionsDir, jobsDir);
  feed.update(file);
  const before = publishCount;
  feed.update(file);
  feed.scan();
  assert.equal(publishCount, before, 'no publish attempt should happen when stat.size === offset');
});

test('non-vscode session_meta source (e.g. CLI "exec") is excluded entirely', () => {
  const { sessionsDir, jobsDir } = setup('exclude-cli');
  const base = Date.now();
  const cwd = '/tmp/codex-feed-fixture/cliproj';
  const sessionId = 'session-cli-1';
  const file = path.join(sessionsDir, 'rollout-a.jsonl');
  writeLines(file, [
    { type: 'session_meta', timestamp: iso(base, 0), payload: { source: 'exec', id: sessionId, cwd } },
    { type: 'event_msg', timestamp: iso(base, 10), payload: { type: 'task_started' } },
    { type: 'event_msg', timestamp: iso(base, 20), payload: { type: 'task_complete' } },
  ]);
  const feed = new CodexFeed(sessionsDir, jobsDir);
  const before = publishCount;
  feed.update(file);
  const state = feed.files.get(file);
  assert.equal(state.meta.source, 'exec');
  assert.equal(state.started, 0);
  assert.equal(state.beat, 0);
  assert.equal(publishCount, before, 'CLI-sourced sessions must never publish');
  const id = computeId(sessionId, cwd);
  assert.equal(fs.existsSync(path.join(jobsDir, `${id}.json`)), false);
});

test('a partial line with no trailing newline is buffered, not parsed, until completed', () => {
  const { sessionsDir, jobsDir } = setup('partial-line');
  const base = Date.now();
  const cwd = '/tmp/codex-feed-fixture/partial';
  const sessionId = 'session-partial-1';
  const file = path.join(sessionsDir, 'rollout-a.jsonl');
  const fullLine = JSON.stringify({ type: 'session_meta', timestamp: iso(base, 0), payload: { source: 'vscode', id: sessionId, cwd } });
  fs.writeFileSync(file, fullLine.slice(0, Math.floor(fullLine.length * 0.6)));

  const feed = new CodexFeed(sessionsDir, jobsDir);
  feed.update(file);
  let state = feed.files.get(file);
  assert.equal(state.meta, null, 'incomplete line must not be parsed yet');
  assert.ok(state.pending.length > 0);

  fs.appendFileSync(file, fullLine.slice(Math.floor(fullLine.length * 0.6)) + '\n');
  feed.update(file);
  state = feed.files.get(file);
  assert.equal(state.meta.cwd, cwd);
  assert.equal(state.pending, '');
});

test('a multi-byte UTF-8 character split across two update() reads decodes correctly', () => {
  const { sessionsDir, jobsDir } = setup('utf8-split');
  const base = Date.now();
  const cwd = '/tmp/codex-feed-fixture/utf8-中文proj';
  const sessionId = 'session-utf8-1';
  const file = path.join(sessionsDir, 'rollout-a.jsonl');
  const fullLine = JSON.stringify({ type: 'session_meta', timestamp: iso(base, 0), payload: { source: 'vscode', id: sessionId, cwd } });
  const buf = Buffer.from(fullLine, 'utf8');
  const charIndex = fullLine.indexOf('中');
  assert.ok(charIndex > 0, 'fixture must contain the multi-byte marker character');
  const byteOffset = Buffer.byteLength(fullLine.slice(0, charIndex), 'utf8');
  const splitAt = byteOffset + 1; // land inside the 3-byte UTF-8 sequence for 中

  fs.writeFileSync(file, buf.subarray(0, splitAt));
  const feed = new CodexFeed(sessionsDir, jobsDir);
  feed.update(file);
  let state = feed.files.get(file);
  assert.equal(state.meta, null, 'line spanning a split multi-byte char must stay pending');

  fs.appendFileSync(file, buf.subarray(splitAt));
  fs.appendFileSync(file, '\n');
  feed.update(file);
  state = feed.files.get(file);
  assert.equal(state.meta.cwd, cwd, 'the split multi-byte character must reassemble exactly');
});

test('same-second tie: a native (non-IDE) job with equal beat is not overwritten by an IDE event', () => {
  const { jobsDir } = setup('tie-native');
  fs.mkdirSync(jobsDir, { recursive: true });
  const cwd = '/tmp/codex-feed-fixture/tieproj';
  const sessionId = 'session-tie-1';
  const id = computeId(sessionId, cwd);
  const tieBeat = 1893456000; // arbitrary fixed epoch-seconds value
  fs.writeFileSync(path.join(jobsDir, `${id}.json`), JSON.stringify({ id, source: 'native-hook', state: 'running', beat: tieBeat }));

  const feed = new CodexFeed('/nonexistent', jobsDir);
  feed.publish({
    meta: { source: 'vscode', id: sessionId, cwd },
    started: tieBeat * 1000 - 5000,
    beat: tieBeat * 1000, // Math.floor(beat/1000) === tieBeat, exact tie
    offset: 100,
    published: 0,
    dirty: true,
    active: false,
    status: 'done',
    trail: [],
  });

  const row = readJob(jobsDir, id);
  assert.equal(row.source, 'native-hook', 'a same-second tie must leave the native hook record untouched');
  assert.equal(row.state, 'running');
});

test('newer native hook beat wins over a stale IDE publish attempt', () => {
  const { jobsDir } = setup('newer-native');
  fs.mkdirSync(jobsDir, { recursive: true });
  const cwd = '/tmp/codex-feed-fixture/newernative';
  const sessionId = 'session-newer-1';
  const id = computeId(sessionId, cwd);
  const nativeBeat = 1893456999;
  fs.writeFileSync(path.join(jobsDir, `${id}.json`), JSON.stringify({ id, source: 'native-hook', state: 'running', beat: nativeBeat }));

  const feed = new CodexFeed('/nonexistent', jobsDir);
  feed.publish({
    meta: { source: 'vscode', id: sessionId, cwd },
    started: (nativeBeat - 500) * 1000,
    beat: (nativeBeat - 100) * 1000, // strictly older than the native hook's beat
    offset: 100,
    published: 0,
    dirty: true,
    active: false,
    status: 'done',
    trail: [],
  });

  const row = readJob(jobsDir, id);
  assert.equal(row.source, 'native-hook');
  assert.equal(row.state, 'running', 'a newer native hook beat must not be overwritten by an older IDE event');
});

test('an old, separate CodexFeed instance cannot overwrite a later, more-complete published state', () => {
  const { jobsDir } = setup('old-instance');
  fs.mkdirSync(jobsDir, { recursive: true });
  const cwd = '/tmp/codex-feed-fixture/racey';
  const sessionId = 'session-race-1';
  const base = Date.now();
  const id = computeId(sessionId, cwd);

  const feedA = new CodexFeed('/nonexistent', jobsDir); // the fresher instance
  feedA.publish({
    meta: { source: 'vscode', id: sessionId, cwd },
    started: base,
    beat: base + 20000,
    offset: 1000,
    published: 0,
    dirty: true,
    active: false,
    status: 'done',
    trail: [],
  });
  assert.equal(readJob(jobsDir, id).state, 'done');

  const feedB = new CodexFeed('/nonexistent', jobsDir); // a lagging, separate instance
  feedB.publish({
    meta: { source: 'vscode', id: sessionId, cwd },
    started: base,
    beat: base + 5000, // earlier than feedA's beat
    offset: 500, // smaller cursor than feedA's
    published: 0,
    dirty: true,
    active: true,
    status: 'running',
    trail: [],
  });

  const row = readJob(jobsDir, id);
  assert.equal(row.state, 'done', 'the old instance\'s stale, smaller (eventAt, cursor) must not regress the job');
});


test('completion at the exact same timestamp still replaces running state', () => {
  const {sessionsDir, jobsDir} = setup('equal-time');
  const file = path.join(sessionsDir, 'rollout-equal.jsonl');
  const timestamp = new Date().toISOString();
  writeLines(file, [
    {type:'session_meta',payload:{source:'vscode',id:'equal-abc123',cwd:'/tmp/equal'}},
    {type:'event_msg',timestamp,payload:{type:'task_started'}},
  ]);
  const feed = new CodexFeed(sessionsDir,jobsDir);
  feed.update(file);
  assert.equal(readJob(jobsDir,'codex-equal-abc123').state,'running');
  appendLines(file,[{type:'event_msg',timestamp,payload:{type:'task_complete'}}]);
  feed.update(file);
  assert.equal(readJob(jobsDir,'codex-equal-abc123').state,'done');
  const before = publishCount;
  appendLines(file,[{type:'event_msg',timestamp,payload:{type:'token_count'}}]);
  feed.update(file);
  assert.equal(publishCount,before,'unrelated records must not republish a completed turn');
});
