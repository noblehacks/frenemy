// Replay captured event shapes from Codex and Kimi through the shipping reporter and row writer.
// Plain Node, no test framework. Run: node snitch/test/native-hooks.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SNITCH = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOOK = path.join(SNITCH, 'hooks', 'agent-beat.mjs');
const FIXTURES = path.join(SNITCH, 'test', 'fixtures', 'native');

let pass = 0, fail = 0;
const t = (name, body) => {
  try { body(); pass++; console.log('  ok  ' + name); }
  catch (error) { fail++; console.log('  FAIL ' + name); console.log('       ' + String(error && error.stack ? error.stack : error).split('\n').join('\n       ')); }
};

const tempRoot = prefix => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const cleanEnv = (root, extra) => {
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extra };
  for (const name of ['FRENEMY_RELAY_JOB', 'ANTIGRAVITY_CONVERSATION_ID', 'SNITCH_CAPTURE']) delete env[name];
  return env;
};
const beat = (agent, mode, data, env, cwd) => spawnSync(process.execPath, [HOOK, agent, mode],
  { input: JSON.stringify(data), encoding: 'utf8', env, cwd, timeout: 10000 });
const rowFiles = jobs => fs.readdirSync(jobs).filter(name => name.endsWith('.json')).map(name => path.join(jobs, name));
const readRow = file => JSON.parse(fs.readFileSync(file, 'utf8'));

t('captured codex and kimi lifecycle', () => {
  const root = tempRoot('snitch-native-replay-');
  for (const agent of ['codex', 'kimi']) {
    const store = path.join(root, agent);
    const env = cleanEnv(root, { FLEET_DIR: store, FRENEMY_DRIVER: '' });
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']) {
      const fixture = path.join(FIXTURES, agent + '-' + event + '.json');
      if (!fs.existsSync(fixture)) continue;   // Kimi SessionEnd was not captured.
      const data = JSON.parse(fs.readFileSync(fixture, 'utf8'));
      data.cwd = root;
      data.transcript_path = path.join(root, 'absent-transcript.jsonl');
      const mode = ['SessionStart', 'Stop', 'SessionEnd'].includes(event) ? 'done' : 'beat';
      const result = beat(agent, mode, data, env, root);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, '', 'native hook must not pollute the reply');
      const rows = rowFiles(path.join(store, 'jobs'));
      assert.strictEqual(rows.length, 1);
      const row = readRow(rows[0]);
      assert.strictEqual(row.agent, agent);
      assert.strictEqual(row.cwd, root);
      assert.strictEqual(row.state, mode === 'done' ? 'done' : 'running', agent + ' ' + event);
    }
  }
  console.log('      Retained native replay: ' + root);
});

t('captured kimi account refusal is named', () => {
  // Captured 2026-11-15 from a real refused Kimi run. The provider's own words must
  // reach the row. Its text does not say whether the sign-in or the plan is at fault,
  // so the row must not claim that anything "ran out".
  const root = tempRoot('snitch-native-failure-');
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'kimi-StopFailure.json'), 'utf8'));
  data.cwd = root;
  const jobs = path.join(root, 'fleet', 'jobs');
  const env = cleanEnv(root, { FLEET_DIR: path.join(root, 'fleet'), FRENEMY_DRIVER: '' });
  const result = beat('kimi', 'fail', data, env, root);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '');
  const rows = rowFiles(jobs);
  assert.strictEqual(rows.length, 1);
  const row = readRow(rows[0]);
  assert.strictEqual(row.state, 'failed');
  assert.ok(row.note.startsWith('Account refused (sign-in or plan): 403 Your current subscription does not have access'), row.note);
  assert.ok(!row.note.includes('ran out'));
  // A failure with no provider text keeps the plain wording and claims nothing.
  const bare = {};
  for (const [key, value] of Object.entries(data)) if (!key.startsWith('error')) bare[key] = value;
  bare.session_id = 'session_00000000-0000-0000-0000-00000000bare';
  beat('kimi', 'fail', bare, env, root);
  const notes = rowFiles(jobs).map(file => readRow(file).note).sort();
  assert.ok(notes.includes('Session stopped with an error'), JSON.stringify(notes));
});

console.log('');
console.log(pass + '/' + (pass + fail) + ' native hook tests passed');
process.exit(fail === 0 ? 0 : 1);
