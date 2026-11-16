// Archive transactions and the job tool putting a cleared job's identity back, on isolated
// records. Run: node snitch/test/archive.test.mjs
// Temp folders are kept as evidence, never deleted.
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = path.join(ROOT, 'snitch', 'extension', 'lib');
const { archive } = require(path.join(LIB, 'archive-jobs.js'));
const lock = require(path.join(LIB, 'joblock.js'));
const FLEET = path.join(ROOT, 'snitch', 'bin', 'fleet.mjs');

// Nothing here may reach the real home or the real job folder.
const SAFE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'snitch-archive-home-'));
process.env.HOME = SAFE_HOME;
process.env.USERPROFILE = SAFE_HOME;
process.env.FLEET_DIR = path.join(SAFE_HOME, 'fleet');

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

// A fresh record for every case, as the original did before each test.
function setUp() {
  const c = {};
  c.root = fs.mkdtempSync(path.join(os.tmpdir(), 'snitch-archive-test-'));
  c.jobs = path.join(c.root, 'jobs');
  fs.mkdirSync(c.jobs);
  c.target = path.join(c.jobs, 'sample.json');
  c.row = { id: 'sample', agent: 'kimi', driver: 'codex', title: 'original title',
    state: 'running', started: 10, beat: 20, every: 30, maxsilence: 660,
    watch: path.join(os.tmpdir(), 'audit-log'), cwd: path.join(os.tmpdir(), 'original-project'),
    by: 'original', pid: 123, step: 4, total: 8 };
  fs.writeFileSync(c.target, JSON.stringify(c.row));
  c.candidate = { id: 'sample', hash: sha256(fs.readFileSync(c.target)) };
  c.archive = (checked = false) => archive(c.jobs, [c.candidate], checked);
  c.dismissed = path.join(c.root, 'dismissed', 'sample.json');
  return c;
}

function fleet(c, ...args) {
  const run = spawnSync(process.execPath, [FLEET, ...args], {
    env: { ...process.env, FLEET_DIR: c.root }, encoding: 'utf8', timeout: 10000 });
  assert.strictEqual(run.status, 0, 'job tool ' + args.join(' ') + ' failed: ' +
    (run.error ? run.error.message : run.stderr));
}

// Make one move fail, the way a denied file move fails, for the length of one call.
async function withFailingMove(source, message, fn) {
  const original = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (path.resolve(String(from)) === path.resolve(source)) {
      throw Object.assign(new Error(message), { code: 'EPERM' });
    }
    return original(from, to);
  };
  try { return await fn(); } finally { fs.renameSync = original; }
}

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (error) { fail++; console.log('  FAIL  ' + name + '\n        ' + String(error && error.message || error).split('\n').join('\n        ')); }
}

await t('archive all sidecars and rehydrate metadata', async () => {
  const c = setUp();
  for (const part of ['steps', 'trail', 'tasks']) fs.writeFileSync(path.join(c.jobs, 'sample.' + part), 'original\n');
  const result = await c.archive();
  assert.deepStrictEqual(result, { cleared: 1, skipped: 0, errors: [] });
  assert.ok(!fs.existsSync(c.target));
  const trash = path.join(c.root, 'trash');
  const saved = [];
  for (const folder of fs.readdirSync(trash)) {
    for (const name of fs.readdirSync(path.join(trash, folder))) if (name.startsWith('sample.')) saved.push(name);
  }
  assert.strictEqual(saved.length, 4);
  fleet(c, 'beat', 'sample');
  const actual = read(c.target);
  for (const key of ['agent', 'driver', 'title', 'started', 'every', 'maxsilence', 'watch', 'cwd', 'by', 'pid', 'step', 'total']) {
    assert.deepStrictEqual(actual[key], c.row[key], key);
  }
  assert.ok(!fs.existsSync(c.dismissed));
});

await t('start does not inherit dismissed identity', async () => {
  const c = setUp();
  await c.archive();
  fleet(c, 'start', 'sample', '--agent', 'claude', '--title', 'new');
  const row = read(c.target);
  assert.strictEqual(row.title, 'new');
  assert.strictEqual(row.agent, 'claude');
  assert.strictEqual(row.driver, '');
  assert.strictEqual(row.step, 0);
});

await t('checked skip but explicit clear accepts fresh beat', async () => {
  const c = setUp();
  c.row.beat = 30;
  fs.writeFileSync(c.target, JSON.stringify(c.row));
  assert.strictEqual((await c.archive(true)).skipped, 1);
  assert.ok(fs.existsSync(c.target));
  assert.strictEqual((await c.archive(false)).cleared, 1);
});

await t('json move error leaves visible record', async () => {
  const c = setUp();
  const result = await withFailingMove(c.target, 'injected denied move', () => c.archive());
  assert.strictEqual(result.cleared, 0);
  assert.strictEqual(result.errors.length, 1);
  assert.deepStrictEqual(read(c.target), c.row);
  assert.ok(!fs.existsSync(c.dismissed));
});

await t('sidecar error rolls back json and prior dismissal', async () => {
  const c = setUp();
  const side = path.join(c.jobs, 'sample.steps');
  fs.writeFileSync(side, 'original');
  fs.mkdirSync(path.join(c.root, 'dismissed'));
  const previous = '{"old":true}';
  fs.writeFileSync(c.dismissed, previous);
  const result = await withFailingMove(side, 'injected sidecar denial', () => c.archive());
  assert.strictEqual(result.cleared, 0);
  assert.ok(result.errors.length > 0);
  assert.deepStrictEqual(read(c.target), c.row);
  assert.strictEqual(fs.readFileSync(c.dismissed, 'utf8'), previous);
});

await t('lock is shared and wait is bounded', async () => {
  const c = setUp();
  const locks = path.join(c.root, '.writer-locks');
  fs.mkdirSync(locks);
  // The same lock every writer of this job's row takes.
  const held = lock.acquireSync(locks, lock.keyFor('sample'), { wait: false });
  assert.ok(held, 'the test could take the job lock');
  let result;
  const began = Date.now();
  try { result = await c.archive(); } finally { held.release(); }
  assert.strictEqual(result.cleared, 0);
  assert.ok(result.errors[0].error.includes('busy'), result.errors[0].error);
  assert.ok(fs.existsSync(c.target));
  assert.ok(Date.now() - began < 10000, 'the wait for a busy job is bounded');
});

await t('publisher drops same second replay, accepts new event', async () => {
  const c = setUp();
  await c.archive();
  const marker = read(c.dismissed);
  const row = { ...c.row, source: 'codex-ide-events', session_id: 'session' };
  const publish = at => {
    const payload = { row: { ...row, beat: Math.trunc(at / 1000) }, trail: [], cursor: 10, eventAt: at };
    const run = spawnSync(process.execPath, [path.join(LIB, 'publish-codex-event.js'), c.jobs],
      { input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000 });
    assert.strictEqual(run.status, 0, run.error ? run.error.message : run.stderr);
  };
  publish(marker.cutoff - 0.1);
  assert.ok(!fs.existsSync(c.target));
  publish(marker.cutoff + 1);
  assert.ok(fs.existsSync(c.target));
});

// Not in the original: the same archive, asked for from outside the extension.
await t('command-line entry reads the request on stdin and prints the result', async () => {
  const c = setUp();
  const run = spawnSync(process.execPath, [path.join(LIB, 'archive-jobs.js'), c.jobs],
    { input: JSON.stringify({ jobs: [c.candidate], checked: true }), encoding: 'utf8', timeout: 10000 });
  assert.strictEqual(run.status, 0, run.error ? run.error.message : run.stderr);
  assert.strictEqual(run.stdout, '{"cleared": 1, "skipped": 0, "errors": []}\n');
  assert.ok(!fs.existsSync(c.target));
  assert.deepStrictEqual(read(c.dismissed).row, c.row);
});

console.log('\n' + pass + '/' + (pass + fail) + ' archive tests passed');
process.exit(fail ? 1 : 0);
