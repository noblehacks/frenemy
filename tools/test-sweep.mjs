// Simulated process tables: never signal real user processes.
// Run: node tools/test-sweep.mjs
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sweep from './sweep.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (error) { fail++; console.log('  FAIL  ' + name + '\n        ' + String(error && error.message || error).split('\n').join('\n        ')); }
}

if (process.platform === 'win32') {
  t('on Windows the tool says it is for Mac and Linux and does nothing', () => {
    const run = spawnSync(process.execPath, [path.join(HERE, 'sweep.mjs'), '--kill'], { encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(run.status, 0, run.stderr);
    assert.strictEqual(run.stdout.trim().split(/\r?\n/).length, 1, run.stdout);
    assert.ok(/Mac and Linux/.test(run.stdout), run.stdout);
  });
  console.log('\n' + pass + '/' + (pass + fail) + ' sweep tests passed (the process-table cases need Mac or Linux)');
  process.exit(fail ? 1 : 0);
}

const uid = process.getuid();
function proc(pid, { ppid = 1, command = 'codex', tty = '??', started = 'Mon Sep 7 12:00:00 2026' } = {}) {
  return sweep.makeProcess(pid, ppid, uid, tty, started, command);
}
const table = rows => new Map(rows.map(row => [row.pid, row]));

t('terminal, IDE, unknown and cyclic ancestry are protected', () => {
  const fixtures = [
    table([proc(2, { tty: 'ttys001' })]),
    table([proc(2, { ppid: 3 }), proc(3, { command: 'Code Helper' })]),
    table([proc(2, { ppid: 9 })]),
    table([proc(2, { ppid: 3 }), proc(3, { ppid: 2 })]),
  ];
  for (const rows of fixtures) assert.strictEqual(sweep.stray(rows.get(2), rows), false);
});

t('orphan family tree is found', () => {
  const rows = table([proc(2), proc(3, { ppid: 2, command: 'node /p/ask-kimi-mcp.mjs' })]);
  assert.strictEqual(sweep.stray(rows.get(3), rows), true);
});

t('new owner or reused pid prevents signalling', () => {
  const original = proc(2);
  for (const rows of [table([proc(2, { tty: 'ttys001' })]), table([proc(2, { started: 'new start' })])]) {
    const signals = [];
    assert.strictEqual(sweep.stopOrphan(original, () => rows, (...x) => signals.push(x), () => {}), false);
    assert.deepStrictEqual(signals, []);
  }
});

t('only the owned tree is signalled, no group kills', () => {
  const rows = table([proc(2), proc(3, { ppid: 2, command: 'sleep 60' }), proc(9, { command: 'user editor' })]);
  const signals = [];
  const send = (pid, signal) => { signals.push([pid, signal]); rows.delete(pid); };
  assert.strictEqual(sweep.stopOrphan(rows.get(2), () => new Map(rows), send, () => {}), true);
  assert.deepStrictEqual(signals, [[3, 'SIGTERM'], [2, 'SIGTERM']]);
  assert.ok(rows.has(9));
});

t('reused pid is never killed after the grace period', () => {
  const rows = table([proc(2)]);
  const signals = [];
  const send = (pid, signal) => { signals.push([pid, signal]); rows.set(pid, proc(pid, { started: 'replacement' })); };
  assert.strictEqual(sweep.stopOrphan(rows.get(2), () => new Map(rows), send, () => {}), true);
  assert.deepStrictEqual(signals, [[2, 'SIGTERM']]);
});

// Not in the original: the real command, which only looks unless told otherwise.
t('a plain run only lists, and says that nothing was signalled', () => {
  const run = spawnSync(process.execPath, [path.join(HERE, 'sweep.mjs')], { encoding: 'utf8', timeout: 20000 });
  assert.strictEqual(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.strictEqual(lines[lines.length - 1], 'Dry run: no processes were signalled.');
  for (const line of lines.slice(0, -1)) assert.ok(/^(STRAY|PROTECTED) pid \d+ /.test(line), line);
});

console.log('\n' + pass + '/' + (pass + fail) + ' sweep tests passed');
process.exit(fail ? 1 : 0);
