#!/usr/bin/env node
// Adversarial tests for worker-workspace.mjs.
//
// Run: node tools/test-worker-adversarial.mjs
//
// Reuses the GuardCase helpers from test-worker-workspace.mjs. Only the cases
// defined in this file run here; the base suite is not run again.
// Temp trees are kept for inspection (nothing is removed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ww, WIN, runCases, symlink, lexists, isLink, isDir, isFile, modeOf } from './test-worker-workspace.mjs';

// -- helpers ---------------------------------------------------------

function stage(c, job, rel, data) {
  return c.write(path.join(c.workspace(job), rel), data);
}

function backup(c, job, rels) {
  const backupDir = path.join(c.root, '.worker-state', 'backups', job.id);
  for (const rel of rels) {
    const src = path.join(c.root, rel);
    const dst = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    if (!WIN) fs.chmodSync(dst, modeOf(src));
  }
  return backupDir;
}

function jobIds(c) {
  const dir = path.join(c.root, '.worker-state', 'jobs');
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();
}

function events(c, jobId) {
  const file = path.join(c.root, '.worker-state', 'journal', jobId + '.jsonl');
  if (!isFile(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line).event);
}

function baseline(root) {
  return JSON.stringify([...ww.treeBaseline(root).entries()]);
}

function assertGuardError(run, pattern) {
  assert.throws(run, error => error instanceof ww.GuardError && pattern.test(error.message));
}

const cases = [
  // -- cross-job ancestor / descendant claims on NEW paths ---------------

  ['second job cannot claim descendant of claimed new path', async c => {
    const j1 = await c.prepare('codex', ['newdir']);   // absent; will become a file
    assert.equal(j1.files.newdir, ww.ABSENT);
    await c.prepare('claude', ['newdir/file.txt'], 1);
    assert.deepEqual(jobIds(c), [j1.id]);
    const wsDir = path.join(c.root, '.worker-state', 'workspaces');
    assert.deepEqual(fs.readdirSync(wsDir), [j1.id]);   // no staging leaked
  }],

  ['second job cannot claim ancestor of claimed new path', async c => {
    const j1 = await c.prepare('codex', ['newdir/file.txt']);
    await c.prepare('claude', ['newdir'], 1);
    assert.deepEqual(jobIds(c), [j1.id]);
    // A true sibling under the same new directory is NOT a conflict.
    const j2 = await c.prepare('claude', ['newdir/other.txt']);
    assert.notEqual(j2, null);
  }],

  ['second job cannot claim path under existing owned file', async c => {
    const j1 = await c.prepare('codex', ['a.txt']);
    await c.prepare('claude', ['a.txt/child.txt'], 1);
    assert.deepEqual(jobIds(c), [j1.id]);
  }],

  // -- staged directory symlinks -----------------------------------------

  ['staged nonowned directory symlink rejected', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    const ws = c.workspace(j);
    stage(c, j, 'a.txt', 'alpha v2\n');
    const outside = path.join(c.tmp, 'outside');
    c.write(path.join(outside, 'planted.txt'), 'planted\n');
    symlink(outside, path.join(ws, 'vendor'));   // points outside tree
    symlink(c.root, path.join(ws, 'loop'));      // points at originals
    assertGuardError(() => ww.verifyBeforeWrite(c.root, c.load(j.id)), /symlink directory in staging: vendor/);
    await c.apply(j.id, 1);
    assert.equal(c.load(j.id).status, 'prepared');
    assert.equal(c.read('a.txt'), 'alpha\n');
    assert.equal(lexists(path.join(c.root, 'vendor')), false);
    assert.equal(lexists(path.join(c.root, 'loop')), false);
    assert.equal(lexists(path.join(c.root, 'planted.txt')), false);
  }],

  ['staged owned parent directory symlink rejected', async c => {
    const j = await c.prepare('codex', ['sub/s.txt']);
    const ws = c.workspace(j);
    const outside = path.join(c.tmp, 'outside-sub');
    c.write(path.join(outside, 's.txt'), 'sub v2 via symlink\n');
    fs.renameSync(path.join(ws, 'sub'), path.join(c.tmp, 'staged-sub.aside'));
    symlink(outside, path.join(ws, 'sub'));   // owned path now behind a link
    assertGuardError(() => ww.verifyBeforeWrite(c.root, c.load(j.id)), /symlink directory in staging: sub/);
    await c.apply(j.id, 1);
    assert.equal(c.read('sub/s.txt'), 'sub\n');
    assert.equal(c.load(j.id).status, 'prepared');
  }],

  ['staged owned file symlink to original rejected', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    const ws = c.workspace(j);
    fs.renameSync(path.join(ws, 'a.txt'), path.join(c.tmp, 'staged-a.aside'));
    symlink(path.join(c.root, 'b.txt'), path.join(ws, 'a.txt'));
    assertGuardError(() => ww.verifyBeforeWrite(c.root, c.load(j.id)), /symlink in staging: a.txt/);
    await c.apply(j.id, 1);
    assert.equal(c.read('a.txt'), 'alpha\n');
    assert.equal(isLink(path.join(c.root, 'a.txt')), false);
  }],

  // -- recovery: immutable applied hash, full preflight ------------------

  ['recovery hash immune to staging mutation', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    stage(c, j, 'a.txt', 'alpha v2\n');
    backup(c, j, ['a.txt']);
    c.simulateSigkillResidue(j, ['a.txt']);
    const frozen = c.load(j.id).intended['a.txt'];
    assert.equal(frozen, ww.sha256File(path.join(c.root, 'a.txt')));
    // Worker keeps editing staging after the crash.
    stage(c, j, 'a.txt', 'alpha v3\n');
    assert.equal(c.load(j.id).intended['a.txt'], frozen);
    await c.recover(j.id);
    assert.equal(c.read('a.txt'), 'alpha\n');
    assert.equal(c.load(j.id).intended['a.txt'], frozen);
    assert.equal(c.load(j.id).status, 'recovered');
  }],

  ['recovery rejects target matching mutated staging', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    stage(c, j, 'a.txt', 'alpha v2\n');
    backup(c, j, ['a.txt']);
    c.simulateSigkillResidue(j, ['a.txt']);
    // Attacker rewrites staging AND the half-written target to the same
    // content, hoping recovery re-derives "intended" from staging.
    stage(c, j, 'a.txt', 'alpha v3\n');
    c.write('a.txt', 'alpha v3\n');
    await c.recover(j.id, 1);
    assert.equal(c.read('a.txt'), 'alpha v3\n');
    assert.equal(c.load(j.id).status, 'applying');
    assert.ok(fs.existsSync(c.marker(j.id)));
    await c.prepare('claude', ['b.txt'], 1);   // still globally blocked
  }],

  ['recovery preflight leaves earlier targets untouched', async c => {
    const j = await c.prepare('codex', ['a.txt', 'b.txt']);
    stage(c, j, 'a.txt', 'alpha v2\n');
    stage(c, j, 'b.txt', 'bravo v2\n');
    backup(c, j, ['a.txt', 'b.txt']);
    c.simulateSigkillResidue(j, ['a.txt', 'b.txt']);
    c.write('b.txt', 'third party\n');   // later target (sorted after a) tampered
    await c.recover(j.id, 1);
    assert.equal(c.read('a.txt'), 'alpha v2\n');   // a.txt NOT restored
    assert.equal(c.read('b.txt'), 'third party\n');
    assert.equal(c.load(j.id).status, 'applying');
    assert.equal(events(c, j.id).includes('recovered-file'), false);
    assert.ok(fs.existsSync(c.marker(j.id)));
  }],

  ['recovery preflight checks backups before restoring', async c => {
    const j = await c.prepare('codex', ['a.txt', 'b.txt']);
    stage(c, j, 'a.txt', 'alpha v2\n');
    stage(c, j, 'b.txt', 'bravo v2\n');
    const backupDir = backup(c, j, ['a.txt', 'b.txt']);
    c.simulateSigkillResidue(j, ['a.txt', 'b.txt']);
    c.write(path.join(backupDir, 'b.txt'), 'corrupt backup\n');
    await c.recover(j.id, 1);
    assert.equal(c.read('a.txt'), 'alpha v2\n');   // a.txt NOT restored
    assert.equal(c.read('b.txt'), 'bravo v2\n');
    assert.equal(c.load(j.id).status, 'applying');
    assert.equal(events(c, j.id).includes('recovered-file'), false);
  }],

  // -- external edits to originals block apply ---------------------------

  ['externally created file blocks new file apply', async c => {
    const j = await c.prepare('codex', ['new.txt']);
    stage(c, j, 'new.txt', 'worker\n');
    c.write('new.txt', 'owner wrote this first\n');
    await c.apply(j.id, 1);
    assert.equal(c.read('new.txt'), 'owner wrote this first\n');
    assert.equal(c.load(j.id).status, 'prepared');
    assert.equal(isDir(path.join(c.root, '.worker-state', 'backups', j.id)), false);
  }],

  ['externally removed owned original blocks apply', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    stage(c, j, 'a.txt', 'alpha v2\n');
    fs.renameSync(path.join(c.root, 'a.txt'), path.join(c.tmp, 'a.moved'));
    await c.apply(j.id, 1);
    assert.equal(lexists(path.join(c.root, 'a.txt')), false);
    assert.equal(c.load(j.id).status, 'prepared');
  }],

  ['original replaced by symlink blocks apply', async c => {
    const j = await c.prepare('codex', ['a.txt']);
    stage(c, j, 'a.txt', 'alpha v2\n');
    fs.renameSync(path.join(c.root, 'a.txt'), path.join(c.root, 'a-real.txt'));
    symlink('a-real.txt', path.join(c.root, 'a.txt'));   // same content
    await c.apply(j.id, 1);
    assert.ok(isLink(path.join(c.root, 'a.txt')));
    assert.equal(c.read('a-real.txt'), 'alpha\n');
    assert.equal(c.load(j.id).status, 'prepared');
  }],

  ['original parent directory symlink blocks apply', async c => {
    const j = await c.prepare('codex', ['sub/s.txt']);
    stage(c, j, 'sub/s.txt', 'sub v2\n');
    fs.renameSync(path.join(c.root, 'sub'), path.join(c.root, 'sub-real'));
    symlink('sub-real', path.join(c.root, 'sub'));
    await c.apply(j.id, 1);
    assert.equal(c.read('sub-real/s.txt'), 'sub\n');
    assert.equal(c.load(j.id).status, 'prepared');
  }],

  // -- independent disjoint jobs ------------------------------------------

  ['disjoint jobs both apply without reverting each other', async c => {
    const j1 = await c.prepare('codex', ['a.txt', 'feat/one.txt']);
    const j2 = await c.prepare('claude', ['sub/s.txt', 'feat/two.txt']);
    stage(c, j1, 'a.txt', 'alpha v2\n');
    stage(c, j1, 'feat/one.txt', 'one\n');
    stage(c, j2, 'sub/s.txt', 'sub v2\n');
    stage(c, j2, 'feat/two.txt', 'two\n');
    await c.apply(j1.id);
    assert.equal(c.read('a.txt'), 'alpha v2\n');
    // j2's staging still holds the pre-j1 copy of a.txt and no feat/one.txt;
    // applying j2 must neither push that stale copy back nor touch feat/one.
    assert.equal(fs.readFileSync(path.join(c.workspace(j2), 'a.txt'), 'utf8'), 'alpha\n');
    await c.apply(j2.id);
    assert.equal(c.read('a.txt'), 'alpha v2\n');
    assert.equal(c.read('sub/s.txt'), 'sub v2\n');
    assert.equal(c.read('feat/one.txt'), 'one\n');
    assert.equal(c.read('feat/two.txt'), 'two\n');
    assert.equal(c.load(j1.id).status, 'applied');
    assert.equal(c.load(j2.id).status, 'applied');
  }],

  // -- isolation: nothing reaches the originals before apply ------------

  ['no worker change reaches original before apply', async c => {
    const before = baseline(c.root);
    const j = await c.prepare('codex', ['a.txt', 'new.txt']);
    assert.equal(baseline(c.root), before);   // prepare writes nothing
    stage(c, j, 'a.txt', 'alpha v2\n');
    stage(c, j, 'new.txt', 'fresh\n');
    stage(c, j, 'c.txt', 'rogue\n');   // out-of-scope: forces a rejected apply
    assert.equal(baseline(c.root), before);
    await c.apply(j.id, 1);
    assert.equal(baseline(c.root), before);
    assert.equal(lexists(path.join(c.root, 'new.txt')), false);
    assert.equal(isDir(path.join(c.root, '.worker-state', 'backups', j.id)), false);
    assert.deepEqual(fs.readdirSync(c.root).filter(name => name.startsWith('.wwtmp-')), []);
    assert.equal(c.load(j.id).status, 'prepared');
    assert.deepEqual(events(c, j.id), ['prepared']);
    assert.equal((await c.run(['abandon', '--root', c.root, '--job', j.id, '--stopped'])).rc, 0);
    assert.equal(baseline(c.root), before);
  }],
];

await runCases(cases);
