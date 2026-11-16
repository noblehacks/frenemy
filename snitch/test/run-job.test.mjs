// Tests for run-job.mjs, the part of the job tool that watches over one command.
// Plain Node, no test framework. Run: node snitch/test/run-job.test.mjs
//
// Every test but the first uses a pretend recorder (never the real job tool), and the first
// writes to a temp folder, so nothing here touches the real ~/.fleet. Temp folders are left on
// disk on purpose, as evidence. Every process a test starts is stopped again when the test
// ends, pass or fail, so nothing is left running.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WIN = process.platform === 'win32';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN_JOB = path.join(HERE, '..', 'bin', 'run-job.mjs');
const FLEET = path.join(HERE, '..', 'bin', 'fleet.mjs');
const NODE = process.execPath;
const SIGTERM = os.constants.signals.SIGTERM;

const FAKE_FLEET_SRC = `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const log = path.join(path.dirname(fileURLToPath(import.meta.url)), 'calls.log');
fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(0);
`;

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, timeout = 10000, interval = 100) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(interval);
  }
  return predicate();
}

// What one test may use: its own temp folder, its own pretend recorder, and a list of
// everything it started so that all of it can be stopped afterwards.
function setUp() {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'run-job-test-'));
  const tmpDir = WIN ? fs.realpathSync.native(made) : made;
  const home = path.join(tmpDir, 'home');
  fs.mkdirSync(home);
  const t = {
    tmpDir,
    fakeFleet: path.join(tmpDir, 'fake-fleet.mjs'),
    fleetLog: path.join(tmpDir, 'calls.log'),
    env: { ...process.env, HOME: home, USERPROFILE: home, FLEET_DIR: path.join(tmpDir, 'unused-fleet') },
    procs: [],
    pidFiles: [],
  };
  delete t.env.FRENEMY_RELAY_JOB;
  delete t.env.FLEET_SERIALIZED_PID;
  fs.writeFileSync(t.fakeFleet, FAKE_FLEET_SRC);
  // Start a process, collecting what it prints; `done` resolves with {code, signal, out, err}.
  t.spawn = (args, options = {}) => {
    const child = spawn(args[0], args.slice(1), { env: t.env, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    const record = { child, out: '', err: '', exited: false };
    if (child.stdout) { child.stdout.setEncoding('utf8'); child.stdout.on('data', text => { record.out += text; }); }
    if (child.stderr) { child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { record.err += text; }); }
    record.done = new Promise(resolve => {
      child.once('error', error => { record.exited = true; resolve({ code: null, signal: null, error, out: record.out, err: record.err }); });
      child.once('close', (code, signal) => { record.exited = true; resolve({ code, signal, out: record.out, err: record.err }); });
    });
    t.procs.push(record);
    return record;
  };
  t.communicate = (record, timeout = 20000) => Promise.race([record.done,
    sleep(timeout).then(() => { throw new Error('process did not end within ' + timeout / 1000 + 's'); })]);
  t.fleetCalls = () => {
    if (!fs.existsSync(t.fleetLog)) return [];
    return fs.readFileSync(t.fleetLog, 'utf8').split('\n').map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
  };
  t.runJob = (jobId, every, command, { title = 'T', agent = 'shell', total = '0', note = 'n' } = {}) =>
    t.spawn([NODE, RUN_JOB, t.fakeFleet, jobId, String(every), title, agent, total, note, '--', ...command]);
  return t;
}

// Heat discipline: never leave a started process behind, pass or fail.
async function tearDown(t) {
  for (const record of t.procs) if (!record.exited) { try { record.child.kill('SIGTERM'); } catch { /* already gone */ } }
  const deadline = Date.now() + 5000;
  for (const record of t.procs) {
    if (record.exited) continue;
    await Promise.race([record.done, sleep(Math.max(100, deadline - Date.now()))]);
    if (!record.exited) {
      try { record.child.kill('SIGKILL'); } catch { /* already gone */ }
      await Promise.race([record.done, sleep(3000)]);
    }
  }
  // Safety net for tests about processes the job tool itself is supposed to stop: if a check
  // failed partway, whatever pid was recorded is force-stopped here so nothing survives the test.
  for (const pidFile of t.pidFiles) {
    let pid;
    try { pid = Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch { continue; }
    if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  }
}

const tests = [];
const test = (name, body, options = {}) => tests.push({ name, body, ...options });
const js = value => JSON.stringify(String(value));

test('real fleet command records default arguments', async t => {
  const store = path.join(t.tmpDir, 'actual-store');
  const proc = t.spawn([NODE, FLEET, 'run', 'actual-job', '--', NODE, '-e', 'console.log("actual argv command")'],
    { env: { ...t.env, FLEET_DIR: store } });
  const result = await t.communicate(proc);
  assert.strictEqual(result.code, 0, result.err);
  assert.ok(result.out.includes('actual argv command'));
  const row = JSON.parse(fs.readFileSync(path.join(store, 'jobs', 'actual-job.json'), 'utf8'));
  assert.strictEqual(row.state, 'done');
  assert.strictEqual(row.agent, 'shell');
  assert.strictEqual(row.every, 30);
});

// -- success -------------------------------------------------------
test('success records start and done, preserves argv', async t => {
  const weirdArg = '$(touch ' + path.join(t.tmpDir, 'pwned') + '); echo hi';
  const proc = t.runJob('job-success', 1, [NODE, '-e', 'console.log(process.argv[1]); process.exit(0)', weirdArg]);
  const result = await t.communicate(proc);
  assert.strictEqual(result.code, 0, result.err);
  assert.strictEqual(result.out.trim(), weirdArg);   // argv preserved, nothing interpreted by a shell
  assert.ok(!fs.existsSync(path.join(t.tmpDir, 'pwned')));

  const calls = t.fleetCalls();
  assert.ok(calls.length >= 2);
  assert.deepStrictEqual(calls[0].slice(0, 2), ['start', 'job-success']);
  assert.deepStrictEqual(calls[calls.length - 1].slice(0, 2), ['done', 'job-success']);
  assert.ok(calls[calls.length - 1].includes('finished'));
});

// -- nonzero exit ----------------------------------------------------
test('nonzero exit records fail and preserves exit code', async t => {
  const proc = t.runJob('job-nonzero', 1, [NODE, '-e', 'process.exit(7)']);
  const result = await t.communicate(proc);
  assert.strictEqual(result.code, 7);
  const calls = t.fleetCalls();
  assert.deepStrictEqual(calls[calls.length - 1].slice(0, 2), ['fail', 'job-nonzero']);
  assert.ok(calls[calls.length - 1].includes('exited 7'));
});

// -- launch failure ----------------------------------------------------
test('launch failure records fail with truthful note', async t => {
  const missing = path.join(t.tmpDir, 'no-such-binary');
  const proc = t.runJob('job-launch-fail', 1, [missing]);
  const result = await t.communicate(proc);
  assert.notStrictEqual(result.code, 0);
  const calls = t.fleetCalls();
  assert.deepStrictEqual(calls[0].slice(0, 2), ['start', 'job-launch-fail']);
  const last = calls[calls.length - 1];
  assert.deepStrictEqual(last.slice(0, 2), ['fail', 'job-launch-fail']);
  assert.ok(last[last.indexOf('--note') + 1].includes('launch failed'));
  const kinds = calls.map(call => call[0]);
  assert.ok(!kinds.includes('done'));
  assert.ok(!kinds.includes('beat'));
});

// -- invalid interval --------------------------------------------------
test('zero or invalid interval is rejected before any fleet call', async t => {
  for (const badEvery of ['0', '-1', 'abc', '1.5', '+1', ' 1', String.fromCharCode(0x0661)]) {
    const proc = t.runJob('job-bad-' + badEvery, badEvery, [NODE, '-e', '0']);
    const result = await t.communicate(proc);
    assert.notStrictEqual(result.code, 0, 'accepted ' + JSON.stringify(badEvery));
  }
  assert.deepStrictEqual(t.fleetCalls(), []);
});

test('missing command is rejected before any fleet call', async t => {
  const proc = t.spawn([NODE, RUN_JOB, t.fakeFleet, 'job-no-cmd', '1', 'T', 'a', '0', 'n', '--']);
  const result = await t.communicate(proc);
  assert.notStrictEqual(result.code, 0);
  assert.deepStrictEqual(t.fleetCalls(), []);
});

// -- cancellation: whole tree, including a grandchild in a process group of its own.
// A stop that only reached the direct child's own group would miss that grandchild. ----
test('cancellation kills child and separate-group grandchild', async t => {
  const heartbeat = path.join(t.tmpDir, 'heartbeat');
  const childPidFile = path.join(t.tmpDir, 'child.pid');
  const grandchildPidFile = path.join(t.tmpDir, 'grandchild.pid');
  const grandchildScript = path.join(t.tmpDir, 'grandchild.mjs');
  const childScript = path.join(t.tmpDir, 'child.mjs');

  fs.writeFileSync(grandchildScript, `import fs from 'node:fs';
fs.writeFileSync(${js(grandchildPidFile)}, String(process.pid));
setInterval(() => fs.writeFileSync(${js(heartbeat)}, String(Date.now() / 1000)), 200);
`);
  // detached: this grandchild gets its OWN process group, separate from its parent's.
  fs.writeFileSync(childScript, `import fs from 'node:fs';
import { spawn } from 'node:child_process';
fs.writeFileSync(${js(childPidFile)}, String(process.pid));
spawn(process.execPath, [${js(grandchildScript)}], { detached: true, stdio: 'ignore' });
setInterval(() => {}, 200);
`);

  t.pidFiles.push(childPidFile, grandchildPidFile);
  const proc = t.runJob('job-cancel', 1, [NODE, childScript]);

  assert.ok(await waitFor(() => fs.existsSync(heartbeat), 10000));
  const childPid = Number(fs.readFileSync(childPidFile, 'utf8').trim());
  const grandchildPid = Number(fs.readFileSync(grandchildPidFile, 'utf8').trim());
  assert.ok(pidAlive(childPid));
  assert.ok(pidAlive(grandchildPid));

  proc.child.kill('SIGTERM');
  const result = await t.communicate(proc);
  assert.strictEqual(result.code, 128 + SIGTERM, result.err);

  assert.ok(await waitFor(() => !pidAlive(childPid), 10000));
  assert.ok(await waitFor(() => !pidAlive(grandchildPid), 10000));

  const calls = t.fleetCalls();
  const last = calls[calls.length - 1];
  assert.deepStrictEqual(last.slice(0, 2), ['fail', 'job-cancel']);
  assert.ok(last[last.indexOf('--note') + 1].includes('SIGTERM'));
}, { needsStopSignal: true });

test('cancel during initial recorder does not launch command', async t => {
  const recorderPid = path.join(t.tmpDir, 'recorder.pid');
  const commandMarker = path.join(t.tmpDir, 'command-started');
  t.pidFiles.push(recorderPid);
  fs.writeFileSync(t.fakeFleet, `import fs from 'node:fs';
if (process.argv[2] === 'start') {
  const p = ${js(recorderPid)};
  fs.writeFileSync(p + '.ready', String(process.pid));
  fs.renameSync(p + '.ready', p);
  setTimeout(() => {}, 60000);
}
`);
  const proc = t.runJob('job-early-cancel', 1, [NODE, '-e', `require('fs').writeFileSync(${js(commandMarker)}, 'launched')`]);
  assert.ok(await waitFor(() => fs.existsSync(recorderPid)));
  const pid = Number(fs.readFileSync(recorderPid, 'utf8'));
  proc.child.kill('SIGTERM');
  const result = await t.communicate(proc, 15000);
  assert.strictEqual(result.code, 143, result.err);
  assert.ok(!fs.existsSync(commandMarker));
  for (let i = 0; i < 2; i++) {
    assert.ok(!pidAlive(pid));
    await sleep(100);
  }
}, { needsStopSignal: true });

// -- no unrelated process is ever touched -------------------------------
test('cancellation never kills unrelated process', async t => {
  const sentinel = t.spawn([NODE, '-e', 'setTimeout(() => {}, 60000)']);
  assert.ok(await waitFor(() => pidAlive(sentinel.child.pid), 5000));

  const proc = t.runJob('job-unrelated', 1, [NODE, '-e', 'setTimeout(() => {}, 60000)']);
  await sleep(1000);   // let the job's own child actually start

  proc.child.kill('SIGTERM');
  await t.communicate(proc);

  assert.ok(pidAlive(sentinel.child.pid));   // untouched by the job's own clean-up
  assert.ok(!sentinel.exited);
}, { needsStopSignal: true });

let pass = 0, fail = 0, skipped = 0;
for (const { name, body, needsStopSignal } of tests) {
  if (needsStopSignal && WIN) {
    // Windows ends a process outright; there is no stop request a program can answer.
    skipped++;
    console.log('  skip ' + name + ' (Windows has no stop signal a program can catch)');
    continue;
  }
  const t = setUp();
  try {
    await body(t);
    pass++;
    console.log('  ok  ' + name);
  } catch (error) {
    fail++;
    console.log('  FAIL ' + name);
    console.log('       ' + String(error && error.stack ? error.stack : error).split('\n').join('\n       '));
  } finally {
    await tearDown(t);
  }
}

console.log('');
console.log(pass + '/' + (pass + fail) + ' run-job tests passed' + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exit(fail === 0 ? 0 : 1);
