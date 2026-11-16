// Closing the rows of background commands only on the app's own final exit line.
// Plain Node, no test framework. Run: node snitch/test/close-background.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WIN = process.platform === 'win32';
const SNITCH = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let pass = 0, fail = 0;
const t = (name, body) => {
  try { body(); pass++; console.log('  ok  ' + name); }
  catch (error) { fail++; console.log('  FAIL ' + name); console.log('       ' + String(error && error.stack ? error.stack : error).split('\n').join('\n       ')); }
};

t('escaped paths and only final harness stamp', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snitch-close-test-'));
  const store = path.join(root, 'fleet');
  const jobs = path.join(store, 'jobs');
  const home = path.join(root, 'home');
  fs.mkdirSync(jobs, { recursive: true });
  fs.mkdirSync(home);
  // A file name that must be escaped inside JSON. Windows allows neither a quote nor a
  // backslash in a file name, so there the folder separators do that job.
  const awkward = WIN ? "quoted'path " : 'quoted"path\\';
  for (const [suffix, text] of [['done', 'output\n[exited with code 0]\n'],
    ['negative', 'output\n[exited with code -15]\n'],
    ['quoted', 'example: [exited with code 0]\nmore work\n']]) {
    const watch = path.join(root, awkward + suffix + '.output');
    fs.writeFileSync(watch, text);
    const row = { id: 'bg-' + suffix, state: 'running', watch, started: 100, beat: 100 };
    fs.writeFileSync(path.join(jobs, row.id + '.json'), JSON.stringify(row));
  }
  const env = { ...process.env, FLEET_DIR: store, HOME: home, USERPROFILE: home };
  delete env.FRENEMY_RELAY_JOB;
  const code = 'import { closeBackground } from ' + JSON.stringify(pathToFileURL(path.join(SNITCH, 'hooks', 'beat-lib.mjs')).href) + '; closeBackground();';
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 15000, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  for (const [suffix, expected] of [['done', 'done'], ['negative', 'failed'], ['quoted', 'running']]) {
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(jobs, 'bg-' + suffix + '.json'), 'utf8')).state, expected, suffix);
  }
});

console.log('');
console.log(pass + '/' + (pass + fail) + ' background close tests passed');
process.exit(fail === 0 ? 0 : 1);
