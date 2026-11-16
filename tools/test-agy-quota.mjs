// Recorded provider failure -> wrapper shutdown -> relay -> Snitch.
// No provider requests. Temporary evidence is retained. The fixture is the actual 2026-09-10
// agy diagnostic, not an invented provider payload.
// Run: node tools/test-agy-quota.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { PKG, NODE, t, finish, sleep, tempRoot, alive, stopHard, fakeApp, safeEnv, run, talk } from './test-relay-kit.mjs';

const root = tempRoot('frenemy-quota-regression-');
fs.copyFileSync(path.join(PKG, 'tools', 'test-fixtures', 'agy-quota.txt'), path.join(root, 'error.txt'));
const pidFile = path.join(root, 'pid.txt'), modeFile = path.join(root, 'mode.txt');

// The fake agy: in "quota" mode it writes the recorded failure to its log and hangs, the way
// the real one did; otherwise it answers, quoting the same words inside its answer.
const binary = fakeApp(path.join(root, 'home', '.local', 'bin'), 'agy',
  'const fs = require("fs"), path = require("path");\n' +
  'const root = ' + JSON.stringify(root) + ';\n' +
  'const args = process.argv.slice(2);\n' +
  'const log = args[args.indexOf("--log-file") + 1];\n' +
  'fs.writeFileSync(path.join(root, "pid.txt"), String(process.pid));\n' +
  'if (fs.readFileSync(path.join(root, "mode.txt"), "utf8") === "quota") {\n' +
  '  fs.writeFileSync(log, fs.readFileSync(path.join(root, "error.txt"), "utf8"));\n' +
  '  setTimeout(() => {}, 60000);\n' +
  '} else {\n' +
  '  fs.writeFileSync(log, "normal invocation\\n");\n' +
  '  console.log("Quoted example: Individual quota reached. Successful answer.");\n' +
  '}\n');
const env = safeEnv(root, { AGY_BIN: binary, FRENEMY_DRIVER: 'codex', AGY_TIMEOUT: '20' });
const project = path.join(root, 'project');
fs.mkdirSync(project);

// The fake app is seen to be gone on two looks a moment apart.
async function stopped() {
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  for (let look = 0; look < 2; look++) {
    assert.strictEqual(alive(pid), false, 'the fake agy (pid ' + pid + ') is still running');
    await sleep(150);
  }
}

function lastPid() {
  try { return Number(fs.readFileSync(pidFile, 'utf8')); } catch { return null; }
}

for (const script of ['ask-agy.mjs', 'tools/ask-agy-consult.mjs']) {
  for (const mode of ['quota', 'success']) {
    await t(script + ', ' + mode + ': ' + (mode === 'quota' ? 'exit 75 with the quota line, app stopped' : 'quoted words do not trip it'), async () => {
      fs.writeFileSync(modeFile, mode);
      try {
        const done = await run(NODE, [path.join(PKG, ...script.split('/'))], { input: 'test', env, timeoutMs: 10000 });
        assert.strictEqual(done.timedOut, false, 'the wrapper did not end');
        assert.strictEqual(done.code, mode === 'quota' ? 75 : 0, done.stderr);
        if (mode === 'quota') assert.ok(done.stderr.includes('Google quota exhausted'), done.stderr);
        else assert.ok(done.stdout.includes('Successful answer'), done.stdout);
        await stopped();
      } finally { stopHard(lastPid()); }
    });
  }
}

for (const tool of ['ask_agy', 'ask_agy_write']) {
  await t(tool + ' through the relay: the answer and the Snitch row both say the quota ran out', async () => {
    fs.writeFileSync(modeFile, 'quota');
    const write = tool.endsWith('_write');
    const fleet = path.join(root, tool);
    const relay = talk(NODE, [path.join(PKG, 'tools', 'ask-agy-mcp.mjs')], { env: { ...env, FLEET_DIR: fleet } });
    try {
      const args = { prompt: 'test quota', working_directory: project };
      if (write) args.allowed_files = ['result.txt'];
      relay.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });
      const response = (await relay.receive(15000, 'the relay did not answer')).result;
      assert.strictEqual(response.isError, true);
      const answer = response.content[0].text;
      assert.ok(answer.includes('Google quota exhausted'), answer);
      const wrapper = write ? 'ask-agy.mjs' : 'ask-agy-consult.mjs';
      assert.ok(answer.includes(wrapper + ' exited 75'), answer);
      const jobs = path.join(fleet, 'jobs');
      const first = fs.existsSync(jobs) ? fs.readdirSync(jobs).find(name => name.endsWith('.json')) : null;
      assert.ok(first, 'no job row was written under ' + jobs);
      const row = JSON.parse(fs.readFileSync(path.join(jobs, first), 'utf8'));
      assert.strictEqual(row.title, 'codex → agy ' + (write ? 'work' : 'consult'));
      assert.strictEqual(row.state, 'failed');
      assert.ok(String(row.note).includes('Google quota exhausted'), String(row.note));
      assert.strictEqual(fs.realpathSync(row.cwd), fs.realpathSync(project));
      assert.ok(fs.readFileSync(row.watch, 'utf8').includes('Individual quota reached'));
      const check = await run(NODE, ['-e',
        'const m=require(process.argv[1]);const rows=m.buildView(process.argv[2],Date.now()/1000,{}).rows;' +
        'if(!rows[0]?.quota.includes("quota ran out"))process.exit(1);',
        path.join(PKG, 'snitch', 'extension', 'lib', 'model.js'), jobs], { env, timeoutMs: 10000 });
      assert.strictEqual(check.code, 0, check.stderr);
      relay.child.stdin.end();
      await relay.exited(5000);
      await stopped();
    } finally {
      await relay.close();
      stopHard(lastPid());
    }
  });
}

console.log('Evidence: ' + root);
finish('agy quota tests');
