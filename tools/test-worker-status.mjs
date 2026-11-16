#!/usr/bin/env node
// Exercise the relay's job bridge (worker-guard.mjs) without invoking any AI provider.
// Run: node tools/test-worker-status.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HERE, TOOL, RUN_DIR, runCases } from './test-worker-workspace.mjs';

const BRIDGE = `
const {jobCommand} = await import(process.argv[1]);
try {
  process.stdout.write(await jobCommand(...JSON.parse(process.argv[2])));
} catch (error) {
  process.stderr.write(error.stderr || error.message);
  process.exitCode = 1;
}
`;

class StatusCase {
  constructor() {
    this.root = fs.realpathSync(fs.mkdtempSync(path.join(RUN_DIR, 'frenemy-status-test-')));
  }

  call(action = 'status', job = null, stopped = false) {
    return spawnSync(process.execPath,
      ['--input-type=module', '-e', BRIDGE, pathToFileURL(path.join(HERE, 'worker-guard.mjs')).href,
        JSON.stringify([action, this.root, job, stopped])],
      { encoding: 'utf8', timeout: 15000 });
  }

  prepare(filename) {
    const result = spawnSync(process.execPath,
      [TOOL, 'prepare', '--root', this.root, '--agent', 'test', '--files', filename],
      { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split('\n')[0].split(' ')[1];
  }
}

const cases = [
  ['selected and all jobs', c => {
    const first = c.prepare('first.txt');
    const second = c.prepare('second.txt');
    for (const stopped of [false, true]) {
      const selected = c.call('status', first, stopped);
      assert.equal(selected.status, 0, selected.stderr);
      assert.ok(selected.stdout.includes(first));
      assert.equal(selected.stdout.includes(second), false);
    }
    const allJobs = c.call();
    assert.equal(allJobs.status, 0, allJobs.stderr);
    assert.ok(allJobs.stdout.includes(first));
    assert.ok(allJobs.stdout.includes(second));
  }],

  ['unknown and invalid on empty and populated project', c => {
    for (const populated of [false, true]) {
      if (populated) c.prepare('test.txt');
      for (const [job, error] of [['000000000000', 'unknown job'],
        ['../escape', 'invalid job id'],
        ['invalid', 'invalid job id']]) {
        const result = c.call('status', job);
        const where = `populated=${populated} job=${job}`;
        assert.notEqual(result.status, 0, where);
        assert.ok(result.stderr.includes(error), where + ': ' + result.stderr);
      }
    }
  }],

  ['empty project unchanged', c => {
    const result = c.call('status', null, true);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('no state directory; no jobs'));
    assert.deepEqual(fs.readdirSync(c.root), []);
  }],

  ['apply ignores irrelevant stopped flag', c => {
    const job = c.prepare('sentence.txt');
    const staged = path.join(c.root, '.worker-state', 'workspaces', job, 'sentence.txt');
    fs.writeFileSync(staged, 'A safe test sentence.\n');
    const result = c.call('apply', job, true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(c.root, 'sentence.txt'), 'utf8'), 'A safe test sentence.\n');
  }],

  ['abandon still requires stopped', c => {
    const job = c.prepare('sentence.txt');
    const denied = c.call('abandon', job, false);
    assert.notEqual(denied.status, 0);
    const result = c.call('abandon', job, true);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('abandoned'));
  }],
];

await runCases(cases, () => new StatusCase());
