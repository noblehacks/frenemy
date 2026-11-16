// All four reporters share the relay's row for the life of a relayed job. No AI app is called.
// Plain Node, no test framework. Run: node snitch/test/relay-session.test.mjs
//
// For each app: a worker started by the relay calls the app's reporter (a tool call, then the
// end of its turn) and must find the relay's row still "running"; the relay alone closes the
// row, as done when the worker answers and as failed when it runs out of time; a reporter
// that calls in late changes nothing; and an ordinary chat's row beside it is left alone.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const HOOKS = path.join(ROOT, 'snitch', 'hooks');
const RELAY = path.join(ROOT, 'tools', 'relay-core.mjs');
const NODE = process.execPath;

let pass = 0, fail = 0;
const check = (name, body) => {
  try { body(); pass++; console.log('  ok  ' + name); return true; }
  catch (error) { fail++; console.log('  FAIL ' + name); console.log('       ' + String(error && error.stack ? error.stack : error).split('\n').join('\n       ')); return false; }
};

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'snitch-relay-session-')));
const home = path.join(root, 'home');
fs.mkdirSync(home);

for (const agent of ['claude', 'codex', 'agy', 'kimi']) {
  const project = path.join(root, agent);
  fs.mkdirSync(project);
  const store = path.join(project, 'fleet');
  const hook = path.join(HOOKS, agent === 'claude' ? 'claude-beat.mjs' : 'agent-beat.mjs');
  const args = [NODE, hook, ...(agent === 'claude' ? [] : [agent])];
  const env = { ...process.env, HOME: home, USERPROFILE: home, FLEET_DIR: store, FRENEMY_DRIVER: 'codex' };
  for (const name of ['FRENEMY_RELAY_JOB', 'ANTIGRAVITY_CONVERSATION_ID', 'CLAUDE_PROJECT_DIR', 'SNITCH_CAPTURE']) delete env[name];
  const rows = () => {
    const found = {};
    let names = [];
    try { names = fs.readdirSync(path.join(store, 'jobs')); } catch { names = []; }
    for (const name of names) if (name.endsWith('.json')) found[name.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(store, 'jobs', name), 'utf8'));
    return found;
  };
  const report = (payload, extraEnv = {}) => {
    const result = spawnSync(args[0], args.slice(1), { input: JSON.stringify(payload), encoding: 'utf8', env: { ...env, ...extraEnv }, cwd: project, timeout: 8000 });
    assert.strictEqual(result.status, 0, result.stderr);
  };

  let ordinaryId;
  if (!check(agent + ': an ordinary chat opens its own row', () => {
    report({ session_id: 'unrelated-' + agent, cwd: project });
    ordinaryId = Object.keys(rows())[0];
    assert.ok(ordinaryId, 'no row was written');
  })) continue;

  // The worker the relay starts. It reports a tool call and then the end of its turn, the way
  // the app itself would, and checks that the relay's row is still running afterwards.
  const worker = path.join(project, 'worker.mjs');
  fs.writeFileSync(worker, `import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const args = ${JSON.stringify(args)};
const payload = JSON.stringify({ session_id: 'native-linked', cwd: process.cwd(), tool_name: 'Read', tool_input: { file_path: 'input.txt' } });
for (const mode of [[], ['done']]) {
  const result = spawnSync(args[0], [...args.slice(1), ...mode], { input: payload, encoding: 'utf8', timeout: 8000 });
  if (result.status !== 0) throw new Error('reporter failed: ' + result.stderr);
}
const row = JSON.parse(fs.readFileSync(path.join(process.env.FLEET_DIR, 'jobs', process.env.FRENEMY_RELAY_JOB + '.json'), 'utf8'));
if (row.state !== 'running') throw new Error(JSON.stringify(row));
fs.writeFileSync('stop-' + process.env.TEST_MODE, JSON.stringify(row));
if (process.env.TEST_MODE === 'timeout') await new Promise(resolve => setTimeout(resolve, 30000));
console.log('worker actually finished');
`);
  const bridge = path.join(project, 'bridge.mjs');
  fs.writeFileSync(bridge, 'import { runWrapper } from ' + JSON.stringify(pathToFileURL(RELAY).href) + ';\n' +
    'const r = await runWrapper({ script: ' + JSON.stringify(worker) + ', cwd: ' + JSON.stringify(project) +
    ', timeoutMs: process.env.TEST_MODE === "timeout" ? 3000 : 10000, maxOutput: 10000, label: "fixture", exitMeaning: {}, ' +
    'env: { TEST_MODE: process.env.TEST_MODE }, fleet: { agent: ' + JSON.stringify(agent) + ', driver: "codex", title: "actual assigned task" } }, "prompt");\n' +
    'process.stdout.write(JSON.stringify(r));\n');

  for (const mode of ['success', 'timeout']) {
    check(agent + ': relayed job, ' + mode + ', then a late reporter call', () => {
      const before = rows();
      const result = spawnSync(NODE, [bridge], { env: { ...env, TEST_MODE: mode }, cwd: project, encoding: 'utf8', timeout: 15000 });
      assert.strictEqual(result.status, 0, result.stderr);
      const outcome = JSON.parse(result.stdout);
      assert.strictEqual(outcome.ok, mode === 'success', JSON.stringify(outcome));
      assert.ok(fs.existsSync(path.join(project, 'stop-' + mode)), 'worker must reach its end-of-turn report before the timeout');
      const after = rows();
      const fresh = Object.keys(after).filter(id => !(id in before));
      assert.strictEqual(fresh.length, 1, JSON.stringify(fresh));
      const jid = fresh[0], row = after[jid];
      assert.strictEqual(row.state, mode === 'success' ? 'done' : 'failed');
      assert.strictEqual(row.title, 'actual assigned task');
      assert.strictEqual(row.cwd, project);
      assert.ok(fs.readFileSync(path.join(store, 'jobs', jid + '.trail'), 'utf8').includes('Read'));
      const snapshot = rows();
      report({ session_id: 'native-linked', cwd: project, tool_name: 'Read' }, { FRENEMY_RELAY_JOB: jid });
      assert.deepStrictEqual(rows(), snapshot, 'late native callback changed completed relay state');
      assert.strictEqual(rows()[ordinaryId].state, 'running');
    });
  }
}
console.log('      Retained evidence: ' + root);

if (fail) {
  let source = '';
  try { source = fs.readFileSync(RELAY, 'utf8'); } catch { source = ''; }
  if (/spawn\(\s*["']\/bin\/bash["']/.test(source)) {
    console.log('      Note: tools/relay-core.mjs still starts its workers through /bin/bash, which cannot run');
    console.log('      the Node worker this test hands it. The relayed cases wait for the relay to start Node workers.');
  }
}

console.log('');
console.log(pass + '/' + (pass + fail) + ' relay session tests passed');
process.exit(fail === 0 ? 0 : 1);
