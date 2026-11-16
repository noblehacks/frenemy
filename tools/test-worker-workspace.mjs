#!/usr/bin/env node
// Tests for worker-workspace.mjs. Run: node tools/test-worker-workspace.mjs
// Plain Node assertions, no test framework. One line per case; exit 0 only when all pass.
// Temp trees are kept for inspection (nothing is removed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as ww from './worker-workspace.mjs';
import lock from '../snitch/extension/lib/joblock.js';

export { ww };
export const WIN = process.platform === 'win32';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOOL = path.join(HERE, 'worker-workspace.mjs');

// Everything this run makes lives under one temp folder, and the home folders point there
// too, so no test can reach the real home.
export const RUN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-test-'));
for (const name of ['HOME', 'USERPROFILE', 'FLEET_DIR']) {
  process.env[name] = path.join(RUN_DIR, name === 'FLEET_DIR' ? 'fleet' : 'home');
  fs.mkdirSync(process.env[name], { recursive: true });
}

/** Thrown by a case that cannot run on this computer (for example a case-sensitive disk). */
export class Skip extends Error {}

export function skip(reason) {
  throw new Skip(reason);
}

export function lexists(target) {
  try { fs.lstatSync(target); return true; } catch { return false; }
}

export function isLink(target) {
  try { return fs.lstatSync(target).isSymbolicLink(); } catch { return false; }
}

export function isFile(target) {
  try { return fs.statSync(target).isFile(); } catch { return false; }
}

export function isDir(target) {
  try { return fs.statSync(target).isDirectory(); } catch { return false; }
}

export function modeOf(target) {
  return fs.statSync(target).mode & 0o7777;
}

/** Make a symlink. A Windows account without that right skips the case instead of failing it. */
export function symlink(target, link) {
  try { fs.symlinkSync(target, link); }
  catch (error) {
    if (WIN && error.code === 'EPERM') skip('this Windows account may not create symlinks');
    throw error;
  }
}

/** Permission bits cannot be set or read on Windows, so those cases are skipped there. */
export function needsModeBits() {
  if (WIN) skip('Windows has no permission bits');
}

/** Run the tool inside this process, the way the Python tests called ww.main(). */
export async function runMain(argv) {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...parts) => out.push(parts.join(' '));
  console.error = (...parts) => err.push(parts.join(' '));
  try {
    const rc = await ww.main(argv);
    return { rc, out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

export class GuardCase {
  constructor() {
    this.tmp = fs.mkdtempSync(path.join(RUN_DIR, 'case-'));
    this.root = path.join(this.tmp, 'proj');
    fs.mkdirSync(this.root);
    this.seed();
  }

  // -- helpers ---------------------------------------------------------

  seed() {
    this.write('a.txt', 'alpha\n');
    this.write('b.txt', 'bravo\n');
    this.write('c.txt', 'charlie\n');
    this.write('bin/tool.sh', '#!/bin/sh\necho hi\n', 0o755);
    fs.mkdirSync(path.join(this.root, 'sub'));
    this.write('sub/s.txt', 'sub\n');
  }

  write(rel, data, mode = null, base = null) {
    const full = path.resolve(base || this.root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data, 'utf8');
    if (mode !== null) fs.chmodSync(full, mode);
    return full;
  }

  read(rel) {
    return fs.readFileSync(path.join(this.root, rel), 'utf8');
  }

  async run(argv) {
    return runMain(argv);
  }

  async prepare(agent, files, rc = 0) {
    const got = await this.run(['prepare', '--root', this.root, '--agent', agent, '--files', ...files]);
    assert.equal(got.rc, rc, got.err);
    if (rc !== 0) return null;
    return this.load(this.lastJobId());
  }

  lastJobId() {
    const jobsDir = path.join(this.root, '.worker-state', 'jobs');
    const ids = fs.readdirSync(jobsDir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
    assert.ok(ids.length, 'expected at least one job');
    // Newest by prepare timestamp recorded in the job file.
    const created = id => JSON.parse(fs.readFileSync(path.join(jobsDir, id + '.json'), 'utf8')).created || 0;
    return ids.reduce((best, id) => (created(id) > created(best) ? id : best));
  }

  jobPath(jobId) {
    return path.join(this.root, '.worker-state', 'jobs', jobId + '.json');
  }

  load(jobId) {
    return JSON.parse(fs.readFileSync(this.jobPath(jobId), 'utf8'));
  }

  save(job) {
    fs.writeFileSync(this.jobPath(job.id), JSON.stringify(job), 'utf8');
  }

  async apply(jobId, rc = 0) {
    const got = await this.run(['apply', '--root', this.root, '--job', jobId]);
    assert.equal(got.rc, rc, got.err);
    return got.rc;
  }

  async recover(jobId, rc = 0) {
    const got = await this.run(['recover', '--root', this.root, '--job', jobId, '--stopped']);
    assert.equal(got.rc, rc, got.err);
    return got.rc;
  }

  workspace(job) {
    return path.join(this.root, job.workspace);
  }

  marker(jobId) {
    return path.join(this.root, '.worker-state', 'locks', `interrupted-${jobId}.lock`);
  }

  /** Rewrite job state to what a killed process would leave behind in the middle of an apply. */
  simulateSigkillResidue(job, replacedRels = []) {
    job.status = 'applying';
    job.intended = {};
    for (const rel of Object.keys(job.files)) {
      const staged = path.join(this.workspace(job), rel);
      job.intended[rel] = isFile(staged) ? ww.sha256File(staged) : ww.ABSENT;
    }
    this.save(job);
    for (const rel of replacedRels) {
      const src = path.join(this.workspace(job), rel);
      const dst = path.join(this.root, rel);
      fs.copyFileSync(src, dst);
      if (!WIN) fs.chmodSync(dst, modeOf(src));
    }
    fs.writeFileSync(this.marker(job.id), 'pid=999999 ts=0\n');
  }
}

/** Run the cases one after another. Each gets a fresh project from `setUp`. */
export async function runCases(cases, setUp = () => new GuardCase()) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const [name, body] of cases) {
    try {
      await body(setUp());
      passed++;
      console.log('  ok  ' + name);
    } catch (error) {
      if (error instanceof Skip) {
        skipped++;
        console.log('  skip  ' + name + ' (' + error.message + ')');
      } else {
        failed++;
        console.log('  FAIL  ' + name);
        console.log(String(error && error.stack ? error.stack : error).replace(/^/gm, '        '));
      }
    }
  }
  console.log('retained test artifacts: ' + RUN_DIR);
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exitCode = failed ? 1 : 0;
}

export function startedDirectly(metaUrl) {
  try { return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(metaUrl)); }
  catch { return false; }
}

const cases = [
  // -- ownership / overlap ---------------------------------------------

  ['real overlap rejected', async c => {
    const j = await c.prepare('codex', ['a.txt', 'b.txt']);
    const got = await c.run(['prepare', '--root', c.root, '--agent', 'claude', '--files', 'b.txt', 'c.txt']);
    assert.equal(got.rc, 1);
    assert.equal(c.load(j.id).status, 'prepared');
  }],

  ['scope conflict and directory claim rejected', async c => {
    assert.equal((await c.run(['prepare', '--root', c.root, '--agent', 'x', '--files', 'sub', 'a.txt'])).rc, 1);
    assert.equal((await c.run(['prepare', '--root', c.root, '--agent', 'x', '--files', 'sub', 'sub/s.txt'])).rc, 1);
  }],

  // -- disjoint merge ---------------------------------------------------

  ['disjoint apply allowed despite original changes', async c => {
    const j1 = await c.prepare('codex', ['a.txt']);
    const j2 = await c.prepare('claude', ['b.txt']);
    // Another legitimate worker's change lands in a nonowned original
    // between j2's prepare and apply. Only staging is compared, so j2 must apply cleanly.
    c.write('c.txt', 'charlie edited by someone else\n');
    c.write(path.join(c.workspace(j2), 'b.txt'), 'bravo v2\n');
    await c.apply(j2.id);
    assert.equal(c.read('b.txt'), 'bravo v2\n');
    assert.equal(c.read('c.txt'), 'charlie edited by someone else\n');
    // j1 still applies afterwards even though b.txt changed.
    c.write(path.join(c.workspace(j1), 'a.txt'), 'alpha v2\n');
    await c.apply(j1.id);
    assert.equal(c.read('a.txt'), 'alpha v2\n');
  }],

  ['stale owned rejected and stays prepared', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    c.write('a.txt', 'changed under us\n');
    c.write(path.join(c.workspace(j), 'a.txt'), 'alpha v2\n');
    assert.equal(await c.apply(j.id, 1), 1);
    assert.equal(c.load(j.id).status, 'prepared');
    assert.equal(c.read('a.txt'), 'changed under us\n');
  }],

  ['staged out of scope rejected', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    c.write(path.join(c.workspace(j), 'a.txt'), 'alpha v2\n');
    c.write(path.join(c.workspace(j), 'c.txt'), 'rogue\n');
    assert.equal(await c.apply(j.id, 1), 1);
    assert.equal(c.load(j.id).status, 'prepared');
    assert.equal(c.read('c.txt'), 'charlie\n');
  }],

  ['staged out of scope delete rejected', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    c.write(path.join(c.workspace(j), 'a.txt'), 'alpha v2\n');
    fs.renameSync(path.join(c.workspace(j), 'c.txt'), path.join(c.tmp, 'retired-c.txt'));
    assert.equal(await c.apply(j.id, 1), 1);
    assert.equal(c.read('c.txt'), 'charlie\n');
  }],

  // -- new files, modes, symlinks ---------------------------------------

  ['new file created', async c => {
    const j = await c.prepare('codex', ['new.txt']);
    assert.equal(j.files['new.txt'], ww.ABSENT);
    c.write(path.join(c.workspace(j), 'new.txt'), 'fresh\n', 0o755);
    await c.apply(j.id);
    assert.equal(c.read('new.txt'), 'fresh\n');
    if (!WIN) assert.ok(modeOf(path.join(c.root, 'new.txt')) & 0o100);
  }],

  ['new file absent uses equality not identity', async c => {
    const j = await c.prepare('codex', ['new.txt']);
    // The ABSENT word must survive a round trip through JSON.
    assert.equal(j.files['new.txt'], 'ABSENT');
    c.write(path.join(c.workspace(j), 'new.txt'), 'fresh\n');
    await c.apply(j.id);
    assert.equal(c.read('new.txt'), 'fresh\n');
  }],

  ['chmod preserved on existing file', async c => {
    needsModeBits();
    const j = await c.prepare('codex', ['bin/tool.sh']);
    const wsBin = path.join(c.workspace(j), 'bin', 'tool.sh');
    assert.ok(modeOf(wsBin) & 0o100);
    c.write(wsBin, '#!/bin/sh\necho v2\n', 0o755);
    // An intentional staged mode is retained when the original is unchanged.
    c.write(wsBin, '#!/bin/sh\necho v2\n', 0o700);
    await c.apply(j.id);
    assert.ok(modeOf(path.join(c.root, 'bin', 'tool.sh')) & 0o100);
  }],

  ['staging symlink rejected', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    const ws = c.workspace(j);
    c.write(path.join(ws, 'a.txt'), 'alpha v2\n');
    symlink('a.txt', path.join(ws, 'evil.txt'));
    assert.equal(await c.apply(j.id, 1), 1);
    assert.equal(lexists(path.join(c.root, 'evil.txt')), false);
  }],

  ['ignored dirs not staged', async c => {
    c.write('.git/config', 'secret\n');
    c.write('pkg/node_modules/lib.js', 'x\n');
    c.write('deep/.attic/old.txt', 'y\n');
    const j = await c.prepare('codex', ['a.txt']);
    const ws = c.workspace(j);
    assert.equal(fs.existsSync(path.join(ws, '.git')), false);
    assert.equal(fs.existsSync(path.join(ws, 'pkg', 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(ws, 'deep', '.attic')), false);
  }],

  ['source symlink not followed into staging', async c => {
    symlink('a.txt', path.join(c.root, 'link.txt'));
    const j = await c.prepare('codex', ['a.txt']);
    assert.equal(lexists(path.join(c.workspace(j), 'link.txt')), false);
    c.write(path.join(c.workspace(j), 'a.txt'), 'alpha v2\n');
    assert.equal(await c.apply(j.id), 0);
    assert.ok(isLink(path.join(c.root, 'link.txt')));
  }],

  // -- ids / traversal ---------------------------------------------------

  ['job id validation', async c => {
    assert.equal((await c.run(['apply', '--root', c.root, '--job', '../../etc/passwd'])).rc, 1);
    assert.equal((await c.run(['apply', '--root', c.root, '--job', 'NOTHEXID123'])).rc, 1);
    assert.equal((await c.run(['recover', '--root', c.root, '--job', '../x', '--stopped'])).rc, 1);
  }],

  ['state dir symlink rejected', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    fs.renameSync(path.join(c.root, '.worker-state', 'backups'), path.join(c.root, '.worker-state', 'backups-real'));
    symlink('backups-real', path.join(c.root, '.worker-state', 'backups'));
    assert.equal(await c.apply(j.id, 1), 1);
    assert.equal(c.read('a.txt'), 'alpha\n');
  }],

  // -- interrupted recovery / handoff ------------------------------------

  ['sigkill blocks other jobs until recovery', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    c.simulateSigkillResidue(j);
    // Another prepare is globally blocked.
    assert.equal((await c.run(['prepare', '--root', c.root, '--agent', 'claude', '--files', 'b.txt'])).rc, 1);
    // The stuck job itself can be recovered.
    assert.equal((await c.run(['recover', '--root', c.root, '--job', j.id, '--stopped'])).rc, 0);
    assert.equal(c.load(j.id).status, 'recovered');
    // Marker cleared: other jobs flow again.
    const j2 = await c.prepare('claude', ['b.txt']);
    assert.notEqual(j2, null);
  }],

  ['recover restores original from backup', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    const ws = c.workspace(j);
    c.write(path.join(ws, 'a.txt'), 'alpha v2\n');
    // Simulate: backups taken, one replace done, then the process is killed.
    const backupDir = path.join(c.root, '.worker-state', 'backups', j.id);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(path.join(c.root, 'a.txt'), path.join(backupDir, 'a.txt'));
    c.simulateSigkillResidue(j, ['a.txt']);
    assert.equal(c.read('a.txt'), 'alpha v2\n');
    assert.equal((await c.run(['recover', '--root', c.root, '--job', j.id, '--stopped'])).rc, 0);
    assert.equal(c.read('a.txt'), 'alpha\n');
    // Backup retained.
    assert.ok(isFile(path.join(backupDir, 'a.txt')));
  }],

  ['recover moves new file to artifacts', async c => {
    const j = await c.prepare('codex', ['new.txt']);
    c.write(path.join(c.workspace(j), 'new.txt'), 'fresh\n');
    c.simulateSigkillResidue(j, ['new.txt']);
    assert.equal((await c.run(['recover', '--root', c.root, '--job', j.id, '--stopped'])).rc, 0);
    assert.equal(fs.existsSync(path.join(c.root, 'new.txt')), false);
    const moved = path.join(c.root, '.worker-state', 'recovered', j.id, 'new.txt');
    assert.ok(fs.readdirSync(path.dirname(moved)).some(name => name.startsWith('new.txt.')));
  }],

  ['recover refuses tampered target', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    c.simulateSigkillResidue(j, ['a.txt']);
    // Someone else edited the half-written target: neither baseline nor
    // applied hash. Recover must refuse without overwriting.
    c.write('a.txt', 'third party edit\n');
    assert.equal((await c.run(['recover', '--root', c.root, '--job', j.id, '--stopped'])).rc, 1);
    assert.equal(c.read('a.txt'), 'third party edit\n');
    assert.equal(c.load(j.id).status, 'applying');
  }],

  ['recover requires stopped flag', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    c.simulateSigkillResidue(j);
    assert.equal((await c.run(['recover', '--root', c.root, '--job', j.id])).rc, 1);
  }],

  ['abandon refuses applying until recover', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    c.simulateSigkillResidue(j);
    assert.equal((await c.run(['abandon', '--root', c.root, '--job', j.id, '--stopped'])).rc, 1);
    assert.equal((await c.run(['recover', '--root', c.root, '--job', j.id, '--stopped'])).rc, 0);
    assert.equal((await c.run(['abandon', '--root', c.root, '--job', j.id, '--stopped'])).rc, 0);
    assert.equal(c.load(j.id).status, 'abandoned');
  }],

  // -- added for the Node version (the Python suite had no case for these) --

  ['added: Ctrl+C during apply leaves the job interrupted and locked until recover', async c => {
    if (WIN) skip('a process cannot send itself Ctrl+C on Windows');
    const j = await c.prepare('codex', ['a.txt', 'b.txt']);
    c.write(path.join(c.workspace(j), 'a.txt'), 'alpha v2\n');
    c.write(path.join(c.workspace(j), 'b.txt'), 'bravo v2\n');
    const journal = ww.seams.journal;
    ww.seams.journal = (root, jobId, event, fields) => {
      journal(root, jobId, event, fields);
      if (event === 'replace') process.kill(process.pid, 'SIGINT');   // after the first file is replaced
    };
    let got;
    try { got = await c.run(['apply', '--root', c.root, '--job', j.id]); }
    finally { ww.seams.journal = journal; }
    assert.equal(got.rc, 2, got.err);
    assert.equal(got.err, 'apply interrupted; job stays locked for explicit recovery');
    assert.equal(c.load(j.id).status, 'interrupted');
    assert.equal(c.read('a.txt'), 'alpha v2\n');
    assert.equal(c.read('b.txt'), 'bravo\n');
    assert.ok(fs.existsSync(c.marker(j.id)));
    await c.prepare('claude', ['c.txt'], 1);   // globally blocked
    await c.recover(j.id);
    assert.equal(c.read('a.txt'), 'alpha\n');
    assert.equal(c.load(j.id).status, 'recovered');
    assert.notEqual(await c.prepare('claude', ['c.txt']), null);
  }],

  ['added: a command waits while another process holds the project lock', async c => {
    await c.prepare('codex', ['a.txt']);
    const jobsDir = path.join(c.root, '.worker-state', 'jobs');
    const count = () => fs.readdirSync(jobsDir).filter(name => name.endsWith('.json')).length;
    const handle = lock.acquireSync(path.join(c.root, '.worker-state', 'locks'), 'global', { timeoutMs: 5000 });
    const child = spawn(process.execPath, [TOOL, 'prepare', '--root', c.root, '--agent', 'claude', '--files', 'b.txt'],
      { stdio: 'ignore' });
    const ended = new Promise(resolve => child.on('exit', code => resolve(code)));
    try {
      const early = await Promise.race([ended, new Promise(resolve => setTimeout(() => resolve('waiting'), 700))]);
      assert.equal(early, 'waiting');
      assert.equal(count(), 1);
      handle.release();
      const code = await Promise.race([ended, new Promise(resolve => setTimeout(() => resolve('stuck'), 10000))]);
      assert.equal(code, 0);
      assert.equal(count(), 2);
    } finally {
      handle.release();
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }],
];

if (startedDirectly(import.meta.url)) await runCases(cases);
