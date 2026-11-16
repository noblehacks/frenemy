#!/usr/bin/env node
// Regression cases for filesystem aliases, permissions and commit recovery.
// Run: node tools/test-worker-repairs.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ww, TOOL, runCases, skip, symlink, needsModeBits, isLink, modeOf } from './test-worker-workspace.mjs';

// A second Node process runs one command and stops dead (no cleanup at all) right after the
// named step. `step` is 'saveJob' (stop once a job is saved with status `when`) or 'journal'
// (stop once the journal line `when` is written). The Python suite raised SystemExit here.
const CRASH_CODE = 97;
const CRASH_SCRIPT = `
const ww = await import(process.argv[1]);
const spec = JSON.parse(process.argv[2]);
const original = ww.seams[spec.step];
ww.seams[spec.step] = (root, ...rest) => {
  original(root, ...rest);
  const reached = spec.step === 'saveJob' ? rest[0].status : rest[1];
  if (reached === spec.when) process.exit(${CRASH_CODE});
};
process.exitCode = await ww.main(spec.argv);
`;

function crashAfter(step, when, argv) {
  const result = spawnSync(process.execPath,
    ['--input-type=module', '-e', CRASH_SCRIPT, pathToFileURL(TOOL).href, JSON.stringify({ step, when, argv })],
    { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, CRASH_CODE, 'the simulated abrupt exit did not happen: ' + result.stderr);
}

async function commitCrash(c) {
  const job = await c.prepare('codex', ['a.txt']);
  c.write(path.join(c.workspace(job), 'a.txt'), 'committed\n');
  // Abrupt exit after the committed state is on disk.
  crashAfter('saveJob', 'applied', ['apply', '--root', c.root, '--job', job.id]);
  return job;
}

const cases = [
  ['case alias claim and correct apply', async c => {
    if (!fs.existsSync(path.join(c.root, 'A.TXT'))) skip('case-sensitive volume');
    const job = await c.prepare('codex', ['A.TXT']);
    assert.ok(Object.keys(job.files).includes('a.txt'));
    await c.prepare('kimi', ['a.txt'], 1);
    c.write(path.join(c.workspace(job), 'a.txt'), 'valid edit\n');
    await c.apply(job.id);
    assert.equal(c.read('a.txt'), 'valid edit\n');
  }],

  ['new aliases conflict and sensitive keys stay distinct', async c => {
    await c.prepare('codex', ['NewFile']);
    if (ww.pathRules(c.root)[0]) await c.prepare('kimi', ['newfile'], 1);
    assert.notEqual(ww.scopeKey(c.root, 'NewFile', [false, false]), ww.scopeKey(c.root, 'newfile', [false, false]));
  }],

  ['unicode existing spelling is canonical', async c => {
    c.write('café.txt', 'coffee\n');
    if (!fs.existsSync(path.join(c.root, 'café.txt'))) skip('volume distinguishes normalization forms');
    const job = await c.prepare('codex', ['café.txt']);
    await c.prepare('kimi', ['café.txt'], 1);
    const rel = Object.keys(job.files)[0];
    c.write(path.join(c.workspace(job), rel), 'edited\n');
    await c.apply(job.id);
    assert.equal(c.read('café.txt'), 'edited\n');
  }],

  ['distinct existing unicode names are not folded together', async c => {
    c.write('straße.txt', 'one\n');
    c.write('strasse.txt', 'two\n');
    const one = fs.statSync(path.join(c.root, 'straße.txt'), { bigint: true });
    const two = fs.statSync(path.join(c.root, 'strasse.txt'), { bigint: true });
    if (one.dev === two.dev && one.ino === two.ino) skip('volume aliases these names');
    await c.prepare('codex', ['straße.txt']);
    await c.prepare('kimi', ['strasse.txt']);
  }],

  ['applied marker recovers idempotently without undo', async c => {
    const job = await commitCrash(c);
    await c.prepare('kimi', ['b.txt'], 1);
    for (let round = 0; round < 2; round++) {
      assert.equal((await c.run(['recover', '--root', c.root, '--job', job.id, '--stopped'])).rc, 0);
    }
    assert.equal(c.read('a.txt'), 'committed\n');
    assert.equal(c.load(job.id).status, 'applied');
    await c.prepare('kimi', ['b.txt']);
  }],

  ['committed recovery keeps owner drift and symlinks', async c => {
    const job = await commitCrash(c);
    fs.renameSync(path.join(c.root, 'a.txt'), path.join(c.tmp, 'committed-aside'));
    const outside = path.join(c.tmp, 'owner-file');
    fs.writeFileSync(outside, 'owner\n');
    symlink(outside, path.join(c.root, 'a.txt'));
    assert.equal((await c.run(['recover', '--root', c.root, '--job', job.id, '--stopped'])).rc, 0);
    assert.ok(isLink(path.join(c.root, 'a.txt')));
    assert.equal(fs.readFileSync(outside, 'utf8'), 'owner\n');
    await c.prepare('kimi', ['b.txt']);
  }],

  ['owner chmod is not overwritten', async c => {
    needsModeBits();
    const job = await c.prepare('codex', ['bin/tool.sh']);
    fs.chmodSync(path.join(c.root, 'bin/tool.sh'), 0o600);
    await c.apply(job.id, 1);
    assert.equal(modeOf(path.join(c.root, 'bin/tool.sh')), 0o600);
  }],

  ['worker chmod owned allowed nonowned rejected', async c => {
    needsModeBits();
    const job = await c.prepare('codex', ['a.txt']);
    fs.chmodSync(path.join(c.workspace(job), 'b.txt'), 0o700);
    await c.apply(job.id, 1);
    fs.chmodSync(path.join(c.workspace(job), 'b.txt'), job.staging_modes['b.txt']);
    fs.chmodSync(path.join(c.workspace(job), 'a.txt'), 0o700);
    await c.apply(job.id);
    assert.equal(modeOf(path.join(c.root, 'a.txt')), 0o700);
  }],

  ['interrupted recovery rejects new permission change', async c => {
    needsModeBits();
    const job = await c.prepare('codex', ['a.txt']);
    c.write(path.join(c.workspace(job), 'a.txt'), 'changed\n');
    // Crash after the first replace.
    crashAfter('journal', 'replace', ['apply', '--root', c.root, '--job', job.id]);
    fs.chmodSync(path.join(c.root, 'a.txt'), 0o700);
    assert.equal((await c.run(['recover', '--root', c.root, '--job', job.id, '--stopped'])).rc, 1);
    assert.equal(c.read('a.txt'), 'changed\n');
  }],

  ['legacy apply refused but interrupted recovery remains', async c => {
    const job = await c.prepare('codex', ['a.txt']);
    delete job.modes;
    delete job.staging_modes;
    c.save(job);
    await c.apply(job.id, 1);
    c.simulateSigkillResidue(job);
    assert.equal((await c.run(['recover', '--root', c.root, '--job', job.id, '--stopped'])).rc, 0);
  }],
];

await runCases(cases);
