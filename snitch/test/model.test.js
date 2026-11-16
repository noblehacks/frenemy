'use strict';
// Plain node assertions — no test framework, no dependencies. Run: node test/model.test.js
const assert = require('assert');
const fs = require('fs');
const retire = require('./retire');
const os = require('os');
const path = require('path');
const m = require('../extension/lib/model');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

t('formatDur', () => {
  assert.strictEqual(m.formatDur(0), '0s');
  assert.strictEqual(m.formatDur(45), '45s');
  assert.strictEqual(m.formatDur(60), '1m');
  assert.strictEqual(m.formatDur(599), '9m');
  assert.strictEqual(m.formatDur(3900), '1h 05m');
  // An unknown duration prints nothing at all — no dash, no "?", no placeholder.
  assert.strictEqual(m.formatDur(null), '');
  assert.strictEqual(m.formatDur(undefined), '');
});

t('EMA needs 3 timestamps, weights recent steps higher', () => {
  assert.strictEqual(m.emaSecondsPerStep([100, 200]), null);            // 1 delta = not enough
  assert.strictEqual(m.emaSecondsPerStep([0, 10, 10]), 7);              // 2 deltas (10, 0) -> 0.3*0+0.7*10
  const steady = m.emaSecondsPerStep([0, 10, 20, 30]);
  assert.ok(Math.abs(steady - 10) < 0.001, 'steady 10s steps -> 10');
  const slowing = m.emaSecondsPerStep([0, 10, 20, 60]);                 // last step took 40s
  assert.ok(slowing > 10 && slowing < 40, 'recent slowdown pulls EMA up: ' + slowing);
});

t('decorate: percent, eta, stall', () => {
  const now = 1000000;
  const r = m.decorate({ id: 'a', agent: 'claude', state: 'running', step: 5, total: 10,
    started: now - 500, beat: now - 3, stepTimes: [now - 400, now - 300, now - 200, now - 100] }, now, {});
  assert.strictEqual(r.pct, 50);
  assert.strictEqual(r.status, 'running');
  assert.ok(r.etaSec > 400 && r.etaSec < 600, 'eta ~100s/step x 5 left: ' + r.etaSec);

  // Silence only counts against a job that promised a cadence. This one promised 60s.
  const stalled = m.decorate({ id: 'b', state: 'running', step: 1, total: 4, every: 60,
    started: now - 900, beat: now - 400 }, now, {});
  assert.strictEqual(stalled.status, 'quiet');
  assert.strictEqual(stalled.beatAge, 400);
});

t('decorate: unknown total gets NO fake percent', () => {
  const now = 1000;
  const r = m.decorate({ id: 'c', state: 'running', step: 3, started: now - 60, beat: now }, now, {});
  assert.strictEqual(r.pct, null);
  assert.strictEqual(r.etaSec, null);
  assert.strictEqual(r.indeterminate, true);
});

t('decorate: finished job freezes elapsed at its last beat', () => {
  const now = 5000;
  const r = m.decorate({ id: 'd', state: 'done', step: 9, total: 9,
    started: now - 300, beat: now - 100 }, now, {});
  assert.strictEqual(r.status, 'done');
  assert.strictEqual(r.pct, 100);
  assert.strictEqual(r.elapsed, 200, 'elapsed stops when the job stopped');
});

t('buildView: reads real files, ignores junk, sorts stalled first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetview-'));
  const now = Math.floor(Date.now() / 1000);
  const put = (id, o) => fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(o));
  put('run', { id: 'run', agent: 'claude', state: 'running', step: 2, total: 4,
               started: now - 100, beat: now - 1 });
  put('old', { id: 'old', agent: 'agy', state: 'running', step: 1, total: 4, every: 60,
               started: now - 900, beat: now - 500 });
  put('gone', { id: 'gone', state: 'done', step: 4, total: 4, started: now - 9000, beat: now - 5000 });
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ "id": "half-writ');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore me');

  const v = m.buildView(dir, now, { hideDoneAfter: 600 });
  assert.strictEqual(v.rows.length, 2, 'broken + stale-done + .txt excluded');
  assert.strictEqual(v.rows[0].id, 'old', 'stalled sorts to the top');
  assert.strictEqual(v.rows[0].status, 'quiet');
  assert.strictEqual(v.stalled, 1);
  assert.strictEqual(v.running, 1);
  assert.strictEqual(v.active, 2);
  retire(dir, { recursive: true, force: true });
});

t('buildView: overall percent averages only jobs that have a denominator', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetview2-'));
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(
    { id: 'a', state: 'running', step: 1, total: 4, started: now - 10, beat: now }));   // 25%
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(
    { id: 'b', state: 'running', step: 3, total: 4, started: now - 10, beat: now }));   // 75%
  fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify(
    { id: 'c', state: 'running', step: 9, started: now - 10, beat: now }));             // no total
  const v = m.buildView(dir, now, {});
  assert.strictEqual(v.overallPct, 50, 'the unmeasurable job does not distort the average');
  retire(dir, { recursive: true, force: true });
});

t('silence is graded: running -> quiet -> dead, and dead is reapable', () => {
  const now = 1000000;
  const mk = age => m.decorate({ id: 'x', state: 'running', step: 1, total: 4, every: 60,
    started: now - 5000, beat: now - age }, now, {});
  assert.strictEqual(mk(60).status, 'running');
  assert.strictEqual(mk(400).status, 'quiet');
  assert.strictEqual(mk(1200).status, 'dead');
  // A dead job stops claiming an ETA — it is not coming back.
  assert.strictEqual(mk(1200).etaSec, null);
});

t('a job that declared its cadence is judged against that, not the generic default', () => {
  const now = 1000000;
  // --beat-every 300: 3x = 900s before it is quiet, so 400s of silence is still fine,
  // whereas the generic 180s default would already have flagged it.
  const slow = m.decorate({ id: 's', state: 'running', step: 1, total: 4, every: 300,
    started: now - 5000, beat: now - 400 }, now, {});
  assert.strictEqual(slow.status, 'running', 'a slow-cadence job is not maligned');
  assert.strictEqual(slow.cadence, 300);
  const reallyGone = m.decorate({ id: 's', state: 'running', step: 1, total: 4, every: 300,
    started: now - 9000, beat: now - 3100 }, now, {});
  assert.strictEqual(reallyGone.status, 'dead', '10x cadence = dead');
});

t('a fresh heartbeat with a stuck step is slow, not dead', () => {
  const now = 1000000;
  const r = m.decorate({ id: 'z', state: 'running', step: 3, total: 9, beat: now - 4,
    started: now - 900, stepTimes: [now - 800, now - 700, now - 600] }, now, {});
  assert.strictEqual(r.status, 'running', 'still checking in');
  assert.ok(r.stepAge >= 600, 'but this step has been going 10m: ' + r.stepAge);
});

t('machine sleep does not condemn the fleet: grace suspends judgement', () => {
  const now = 1000000;
  const job = { id: 'g', state: 'running', step: 1, total: 4, every: 60,
                started: now - 5000, beat: now - 1200 };
  assert.strictEqual(m.decorate(job, now, {}).status, 'dead');
  assert.strictEqual(m.decorate(job, now, { graceUntil: now + 60 }).status, 'running',
    'inside the grace window after a wake-up, silence proves nothing');
});

t('NO silence verdict without evidence of the job\'s rhythm', () => {
  const now = 1000000;
  // A builder that steps every ten minutes and never heartbeats. The old flat 180s rule
  // called this "not responding" while it was working perfectly (2026-08-13, his screenshot).
  const working = m.decorate({ id: 'w', state: 'running', step: 1, total: 3,
    started: now - 500, beat: now - 480 }, now, { stallAfter: 180, deadAfter: 900 });
  assert.strictEqual(working.status, 'running', 'silence proves nothing about an unknown rhythm');
  assert.strictEqual(working.quietAfter, Infinity, 'it can never be called quiet');
  // It is still not immortal: two hours of nothing is archived rather than believed.
  const abandoned = m.decorate({ id: 'w', state: 'running', step: 1, total: 3,
    started: now - 20000, beat: now - 8000 }, now, {});
  assert.strictEqual(abandoned.status, 'dead', 'the backstop still catches abandoned work');
});

t('a rhythm can be DEMONSTRATED by beats, not only declared', () => {
  const now = 1000000;
  // seen/beats are written by bin/fleet as the job runs: an average 20s check-in over 9 beats.
  const base = { id: 'h', state: 'running', step: 1, total: 4, seen: 20, beats: 9,
                 started: now - 5000 };
  assert.strictEqual(m.decorate(Object.assign({}, base, { beat: now - 200 }), now, {}).status,
    'running', 'a 20s rhythm gets a 300s floor before anyone panics');
  assert.strictEqual(m.decorate(Object.assign({}, base, { beat: now - 400 }), now, {}).status,
    'quiet', 'past that floor, silence from a chatty job does mean something');
  // Two beats is a coincidence, not a rhythm.
  const thin = m.decorate({ id: 'h', state: 'running', step: 1, total: 4, seen: 20, beats: 2,
    started: now - 5000, beat: now - 400 }, now, {});
  assert.strictEqual(thin.status, 'running', 'two samples are not evidence');
});

t('a rhythm can be demonstrated by completed steps', () => {
  const now = 1000000;
  // Steps every ~600s. 40 minutes of quiet is normal here; 3 hours is not.
  const steps = [now - 2400, now - 1800, now - 1200, now - 600];
  const ok = m.decorate({ id: 'st', state: 'running', step: 4, total: 9, beat: now - 2000,
    started: now - 3000, stepTimes: steps }, now, {});
  assert.strictEqual(ok.status, 'running');
  assert.strictEqual(ok.quietAfter, 2400, '4x its own 600s step rhythm');
  const late = m.decorate({ id: 'st', state: 'running', step: 4, total: 9, beat: now - 3000,
    started: now - 9000, stepTimes: steps }, now, {});
  assert.strictEqual(late.status, 'quiet');
});

t('a watched file is a sign of life, and the freshest one wins', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetwatch-'));
  const now = Math.floor(Date.now() / 1000);
  const outFile = path.join(dir, 'render.log');
  fs.writeFileSync(outFile, 'still going');       // written just now
  fs.writeFileSync(path.join(dir, 'w.json'), JSON.stringify(
    { id: 'w', agent: 'shell', state: 'running', step: 1, total: 4, every: 60,
      started: now - 5000, beat: now - 3000, watch: outFile }));

  // 50 minutes since the last heartbeat: on the heartbeat alone this job is long dead.
  const v = m.buildView(dir, now, {});
  const r = v.rows.find(x => x.id === 'w');
  assert.strictEqual(r.status, 'running', 'a file that is still changing outranks silence');
  assert.ok(r.beatAge < 5, 'activity is dated from the file: ' + r.beatAge);
  assert.strictEqual(r.watching, 'render.log', 'and the panel can name what vouched for it');

  // A stale file rescues nothing — it is evidence, not an exemption.
  const old = now - 4000;
  fs.utimesSync(outFile, old, old);
  const r2 = m.buildView(dir, now, {}).rows.find(x => x.id === 'w');
  assert.strictEqual(r2.status, 'dead');
  assert.strictEqual(r2.watching, '', 'nothing to name when the file is older than the beat');

  // A missing or unreadable path is ignored, never thrown on.
  fs.writeFileSync(path.join(dir, 'w.json'), JSON.stringify(
    { id: 'w', state: 'running', step: 1, total: 4, every: 60,
      started: now - 5000, beat: now - 100, watch: '/nope/not/here.log' }));
  assert.strictEqual(m.buildView(dir, now, {}).rows[0].status, 'running');
  retire(dir, { recursive: true, force: true });
});

t('--max-silence is a promise the job is held to', () => {
  const now = 1000000;
  const mk = age => m.decorate({ id: 'p', state: 'running', step: 1, total: 4, maxsilence: 300,
    started: now - 9000, beat: now - age }, now, {});
  assert.strictEqual(mk(200).status, 'running');
  assert.strictEqual(mk(400).status, 'quiet', 'past its own promise');
  assert.strictEqual(mk(1000).status, 'dead');
  // It outranks everything else, including a rhythm the job demonstrated.
  const both = m.decorate({ id: 'p', state: 'running', step: 1, total: 4, maxsilence: 120,
    seen: 600, beats: 9, started: now - 9000, beat: now - 200 }, now, {});
  assert.strictEqual(both.status, 'quiet');
  assert.strictEqual(both.quietAfter, 120);
});

t('buildView reports which jobs are reapable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetreap-'));
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(dir, 'alive.json'), JSON.stringify(
    { id: 'alive', state: 'running', step: 1, total: 2, started: now - 60, beat: now - 2 }));
  fs.writeFileSync(path.join(dir, 'gone.json'), JSON.stringify(
    { id: 'gone', state: 'running', step: 1, total: 2, every: 60,
      started: now - 9000, beat: now - 2000 }));
  const v = m.buildView(dir, now, {});
  assert.deepStrictEqual(v.reapable, ['gone']);
  assert.strictEqual(v.dead, 1);
  assert.strictEqual(v.running, 1);
  retire(dir, { recursive: true, force: true });
});

t('shell page is self-contained: nonce, CSP, no external references', () => {
  const { renderShell } = require('../extension/lib/render');
  const html = renderShell({ nonce: 'abc123', scriptUri: 'vscode-resource://x/app.js' });
  assert.ok(html.includes("script-src 'nonce-abc123'"), 'script is nonce-gated');
  assert.ok(html.includes("default-src 'none'"), 'nothing loads by default');
  assert.ok(html.includes('id="app"'), 'skeleton the client fills');
  assert.ok(html.indexOf('http://') === -1 && html.indexOf('https://') === -1,
    'no external references in the page itself');
});

t('payload: what the page is told, and what it is NOT told', () => {
  const { buildPayload } = require('../extension/lib/payload');
  const now = 100000;
  const row = m.decorate({ id: 'letters', agent: 'claude', title: 'letters fleet',
    state: 'running', step: 2, total: 4, started: now - 200, beat: now - 5,
    pid: 4242, by: 'bash', cwd: '/Users/x/Downloads/Example Projects/Example Project',
    note: 'letter R' }, now, {});
  row.expanded = true;
  const p = buildPayload({ rows: [row], running: 1, stalled: 0, failed: 0, worstEta: 100 });
  const r = p.rows[0];

  assert.strictEqual(r.pct, 50);
  assert.strictEqual(r.bar, '#D97757', 'carries its brand colour');
  assert.ok(r.mark.indexOf('<svg') === 0, 'carries its brand mark');
  assert.strictEqual(r.folder, 'Example Projects/Example Project', 'folder trimmed to something readable');

  // Time-relative strings are deliberately absent: the page recomputes them from epochs,
  // which is what lets it stay live without the extension doing any work.
  assert.strictEqual(typeof r.beat, 'number');
  assert.strictEqual(typeof r.started, 'number');
  assert.ok(!('beatAge' in r) && !('elapsed' in r), 'no baked-in ages to go stale');

  // Debug material stays out of the panel entirely.
  assert.ok(!('pid' in r) && !('by' in r) && !('cwd' in r), 'pid/by/raw cwd not sent');
});

t('payload: a finished job stops its clock, a live one does not', () => {
  const { buildPayload } = require('../extension/lib/payload');
  const now = 100000;
  const done = m.decorate({ id: 'd', state: 'done', step: 4, total: 4,
    started: now - 300, beat: now - 100 }, now, {});
  const live = m.decorate({ id: 'l', state: 'running', step: 1, total: 4,
    started: now - 60, beat: now - 1 }, now, {});
  const p = buildPayload({ rows: [done, live], running: 1, stalled: 0, failed: 0, worstEta: null });
  assert.strictEqual(p.rows[0].finalElapsed, 200, 'done job keeps the time it took');
  assert.strictEqual(p.rows[1].finalElapsed, null, 'running job keeps counting on the page');
});

t('payload: a job with no total gets no percentage, ever', () => {
  const { buildPayload } = require('../extension/lib/payload');
  const now = 100000;
  const row = m.decorate({ id: 'chat', agent: 'claude', title: 'Example Project',
    state: 'running', step: 0, started: now - 400, beat: now - 3 }, now, {});
  const r = buildPayload({ rows: [row], running: 1, stalled: 0, failed: 0, worstEta: null }).rows[0];
  assert.strictEqual(r.pct, null);
  assert.strictEqual(r.indeterminate, true);
  assert.strictEqual(r.etaSec, null);
});

// ---- who is driving, counted once for the whole panel ----------------------
// The row-level versions of this (a halo, then a second logo per row) were both rejected
// on sight. What survives is one line, so the counting behind it has to be right.
t('drivers: one line naming who launched the work, busiest first', () => {
  const now = 1000;
  const rows = [
    m.decorate({ id: 'a', agent: 'codex', driver: 'claude', state: 'running', beat: now }, now, {}),
    m.decorate({ id: 'b', agent: 'kimi',  driver: 'claude', state: 'running', beat: now }, now, {}),
    m.decorate({ id: 'c', agent: 'agy',   driver: 'codex',  state: 'running', beat: now }, now, {}),
  ];
  assert.deepStrictEqual(m.driversOf(rows),
    [{ agent: 'claude', jobs: 2 }, { agent: 'codex', jobs: 1 }]);
});

t('drivers: a job nobody else launched contributes nothing to the line', () => {
  const now = 1000;
  // A Claude chat doing its own work: worker and driver are the same, so naming the driver
  // would say the same thing twice. decorate() blanks it and the line stays away.
  const own = m.decorate({ id: 'own', agent: 'claude', driver: 'claude',
                           state: 'running', beat: now }, now, {});
  const shell = m.decorate({ id: 'sh', agent: 'shell', state: 'running', beat: now }, now, {});
  assert.strictEqual(own.driver, '');
  assert.deepStrictEqual(m.driversOf([own, shell]), [], 'no driver line at all');
});

t('drivers: the payload carries the line, the row carries only the words', () => {
  const { buildPayload } = require('../extension/lib/payload');
  const now = 1000;
  const row = m.decorate({ id: 'a', agent: 'codex', driver: 'claude', title: 'review',
                           state: 'running', beat: now }, now, {});
  const p = buildPayload({ rows: [row], drivers: m.driversOf([row]),
                           running: 1, stalled: 0, failed: 0, worstEta: null });
  assert.strictEqual(p.drivers.length, 1);
  assert.strictEqual(p.drivers[0].label, 'Claude');
  assert.strictEqual(p.drivers[0].jobs, 1);
  assert.ok(p.drivers[0].mark.indexOf('<svg') === 0, 'the line gets a real brand mark');
  assert.strictEqual(p.drivers[0].bar, '#D97757', 'and the colour to light its chip with');
  assert.strictEqual(p.rows[0].driverLabel, 'Claude', 'the detail block can say who sent it');
  assert.strictEqual(p.rows[0].driverBar, undefined, 'no per-row driver colour is sent');
});

t('drivers: the look he picked travels with the payload, and only the two exist', () => {
  const { buildPayload } = require('../extension/lib/payload');
  const view = { rows: [], drivers: [], running: 0, stalled: 0, failed: 0, worstEta: null };
  assert.strictEqual(buildPayload(view).driverStyle, 'chip', 'the chip is the default');
  assert.strictEqual(buildPayload(view, 'underline').driverStyle, 'underline');
  // A stale or mistyped setting must not blank the line out; it falls back to the default.
  assert.strictEqual(buildPayload(view, 'glowbox').driverStyle, 'chip');
});

// --- what an agent actually did ---------------------------------------------
// The owner watched a row say "Working / Running 44m" for an hour and asked what it was
// doing; nothing on screen could answer him. These four cover the answer.
t('the trail is read newest-last, repeats carry their count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleettrail-'));
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ id: 'a', state: 'running' }));
  fs.writeFileSync(path.join(dir, 'a.trail'),
    '100\t1\tRead model.js\n200\t4\tSearched for note\n300\t1\tEdited app.js\n');
  const job = m.readJobs(dir).find(j => j.id === 'a');
  assert.strictEqual(job.trail.length, 3);
  assert.deepStrictEqual(job.trail[2], { at: 300, times: 1, text: 'Edited app.js' });
  assert.strictEqual(job.trail[1].times, 4, 'a repeated action keeps its count');
  retire(dir, { recursive: true, force: true });
});

t('the plan travels as words AND as its own separate fraction', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetplan-'));
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ id: 'a', state: 'running' }));
  fs.writeFileSync(path.join(dir, 'a.tasks'),
    'completed\tRead the hook\nin_progress\tWrite the trail\npending\tShip it\n');
  const job = m.readJobs(dir).find(j => j.id === 'a');
  const row = m.decorate(job, 1000, {});
  assert.strictEqual(row.tasks.length, 3);
  assert.strictEqual(row.tasks[0].done, true);
  assert.strictEqual(row.tasks[1].active, true);
  // A checklist is never promoted into the job's own step/total — a declared --total keeps
  // its meaning. But by design the plan IS a denominator of its own: the panel
  // shows a live percentage on long chat work, and the checklist is the only one a chat
  // states. It travels separately (planPct), always beside its "N of M" fraction, and may
  // honestly move backwards when the model grows the plan.
  assert.strictEqual(row.total, null);
  assert.strictEqual(row.pct, null);
  assert.strictEqual(row.planCount, 3);
  assert.strictEqual(row.planDone, 1);
  assert.strictEqual(row.planPct, 33);
  assert.strictEqual(row.indeterminate, false, 'a plan is enough to draw the bar');
  retire(dir, { recursive: true, force: true });
});

t('a 20-item plan is counted whole — the display cap must not shape the number', () => {
  // Codex's catch: readTasks() used to keep only the first 12 items, so a 20-item plan
  // with its first 12 done read "100% · 12 of 12" while eight items were still pending.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetplan20-'));
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ id: 'a', state: 'running' }));
  let lines = '';
  for (let i = 0; i < 20; i++) lines += (i < 12 ? 'completed' : 'pending') + '\ttask ' + i + '\n';
  fs.writeFileSync(path.join(dir, 'a.tasks'), lines);
  const row = m.decorate(m.readJobs(dir).find(j => j.id === 'a'), 1000, {});
  assert.strictEqual(row.planCount, 20);
  assert.strictEqual(row.planDone, 12);
  assert.strictEqual(row.planPct, 60);
  // The page still gets a bounded list to draw.
  const { buildPayload } = require('../extension/lib/payload');
  const p = buildPayload({ rows: [row], running: 1, stalled: 0, failed: 0, worstEta: null });
  assert.strictEqual(p.rows[0].tasks.length, 12, 'display capped, count not');
  retire(dir, { recursive: true, force: true });
});

t('the overall percent counts plan-driven jobs too', () => {
  // Both reviewers flagged it: a chat measured only by its checklist contributed nothing
  // to the header/status-bar percent — blank exactly where the live % was ordered.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetoverall-'));
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(
    { id: 'a', state: 'running', step: 3, total: 4, started: now - 10, beat: now }));   // 75%
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(
    { id: 'b', state: 'running', started: now - 10, beat: now }));                      // plan 25%
  fs.writeFileSync(path.join(dir, 'b.tasks'),
    'completed\ta\npending\tb\npending\tc\npending\td\n');
  const v = m.buildView(dir, now, {});
  assert.strictEqual(v.overallPct, 50, 'declared 75 and plan 25 average to 50');
  retire(dir, { recursive: true, force: true });
});

t('no plan and no total still means no number at all', () => {
  const r = m.decorate({ id: 'a', state: 'running', started: 900, beat: 1000 }, 1000, {});
  assert.strictEqual(r.pct, null);
  assert.strictEqual(r.planPct, null);
  assert.strictEqual(r.indeterminate, true);
});

t('a finished job with no total is not called 100%', () => {
  // It used to read "Finished 100% Took 5h 05m". The 100% was invented from the fact that
  // it had stopped, and it told him nothing about what happened.
  const r = m.decorate({ id: 'a', state: 'done', started: 900, beat: 1000 }, 1000, {});
  assert.strictEqual(r.pct, null);
  assert.strictEqual(r.indeterminate, true);
});

t('a proven quota death is named in plain words - and only a proven one', () => {
  // Fixture copied VERBATIM from agy's own conversation db on this machine
  // (~/.gemini/antigravity-cli/conversations/7026676c-*.db) - the fixture law.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetquota-'));
  const out = path.join(dir, 'job.output');
  fs.writeFileSync(out, 'model unreachable: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 29h21m42s.\n\n[exited with code 1]\n');
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ id: 'a', state: 'failed', watch: out }));
  const row = m.decorate(m.readJobs(dir).find(j => j.id === 'a'), 1000, {});
  assert.ok(/quota ran out/.test(row.quota), 'named plainly: ' + row.quota);
  assert.ok(/29h21m42s/.test(row.quota), 'with when it comes back: ' + row.quota);
  // An ordinary failure gets NO quota claim - certainty or nothing.
  fs.writeFileSync(out, 'No prompt provided via stdin.\n[exited with code 1]\n');
  const row2 = m.decorate(m.readJobs(dir).find(j => j.id === 'a'), 1000, {});
  assert.strictEqual(row2.quota, '', 'no signature, no claim');
  retire(dir, { recursive: true, force: true });
});

t('an account failure recorded in the row is named - an ordinary failure is not', () => {
  // The note is what the hook writes from Kimi's real StopFailure payload (2026-11-15).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetsub-'));
  const note = 'Account refused (sign-in or plan): 403 Your current subscription does not have access to Kimi Code right now. U';
  fs.writeFileSync(path.join(dir, 'k.json'), JSON.stringify({ id: 'k', agent: 'kimi', state: 'failed', note }));
  const row = m.decorate(m.readJobs(dir).find(j => j.id === 'k'), 1000, {});
  assert.ok(/refused this account/.test(row.quota), 'named plainly: ' + row.quota);
  assert.ok(!/ran out/.test(row.quota), 'no cause is claimed: ' + row.quota);
  assert.ok(/does not have access to Kimi Code/.test(row.quota), 'with the provider words: ' + row.quota);
  // Usage that really ran out keeps its own wording.
  fs.writeFileSync(path.join(dir, 'k.json'), JSON.stringify({ id: 'k', agent: 'codex', state: 'failed', note: 'Subscription/quota ran out: You have hit your usage limit.' }));
  assert.ok(/subscription or quota ran out/.test(m.decorate(m.readJobs(dir).find(j => j.id === 'k'), 1000, {}).quota));
  fs.writeFileSync(path.join(dir, 'k.json'), JSON.stringify({ id: 'k', agent: 'kimi', state: 'failed', note: 'Stopped with an error: connection reset' }));
  assert.strictEqual(m.decorate(m.readJobs(dir).find(j => j.id === 'k'), 1000, {}).quota, '', 'no proof, no claim');
  // Still running: a note alone never makes a live row a subscription death.
  fs.writeFileSync(path.join(dir, 'k.json'), JSON.stringify({ id: 'k', agent: 'kimi', state: 'running', note }));
  assert.strictEqual(m.decorate(m.readJobs(dir).find(j => j.id === 'k'), 1000, {}).quota, '', 'only a failed row');
  retire(dir, { recursive: true, force: true });
});

t('the last output line skips the harness exit stamp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetout-'));
  const out = path.join(dir, 'job.output');
  // Verbatim from the Codex consult that failed at 8:38 PM on 2026-08-15: the reason sat
  // one line above the harness's own marker, and the panel showed only "code 1".
  fs.writeFileSync(out, 'Reading prompt from stdin...\nNo prompt provided via stdin.\n\n[exited with code 1]\n');
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ id: 'a', state: 'failed', watch: out }));
  const job = m.readJobs(dir).find(j => j.id === 'a');
  assert.strictEqual(job.lastOut, 'No prompt provided via stdin.');
  retire(dir, { recursive: true, force: true });
});

t('unknown driver is not relabelled as shell', () => {
  assert.strictEqual(m.decorate({id:'a', agent:'kimi', driver:'unknown'},1000,{}).driver, '');
  assert.strictEqual(m.decorate({id:'a', agent:'kimi', driver:'codex'},1000,{}).driver, 'codex');
});

t('activity wording is honest and preserves useful descriptions', () => {
  const {rowPayload} = require('../extension/lib/payload');
  const cases = [
    ['Read settings.json', 'Read settings.json'],
    ['Database connection refused', 'Database connection refused'],
    ['answered, 127 chars', 'Returned an answer'],
    ['python3 tools/check-release.py', 'Ran release checks'],
    ['python3 - <<PY print("collaboration.followup_task")', 'Ran a script'],
    ['mcp__kimi__ask_kimi_write', 'Assigned work to Kimi'],
    ['collaboration.wait_agent', 'Checked on the helpers'],
    ['functions.exec', 'Ran a command'],
    ['unknown_tool', 'Used a tool'],
  ];
  for (const [text, expected] of cases) {
    const value = rowPayload({agent:'codex',trail:[{at:10,times:2,text}],note:text});
    assert.strictEqual(value.lastAction.text, expected);
    assert.strictEqual(value.note, expected);
    assert.strictEqual(value.lastAction.at, 10);
    assert.strictEqual(value.lastAction.times, 2);
  }
});

console.log('\n' + pass + '/' + pass + ' model tests passed');
