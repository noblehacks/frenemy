// Inspect Frenemy-family orphans; signal only with explicit --kill.
//
// Unknown ancestry is protected. Full identity and ancestry are rechecked before TERM.
// Escalation targets only the same identities in that owned tree.
//
// This tool is for Mac and Linux. It needs each process's owner, terminal and command line,
// which the shared process list in platform.mjs does not carry, so it reads `ps` itself.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIN, sleepSync } from './platform.mjs';

export const FAMILY = /(?:^|[ /])(agy|kimi|codex)(?: |$)|(?:^|[ /])ask-(?:claude|agy|kimi|codex)[a-z-]*\.(?:sh|mjs)(?: |$)/;

/** One row of the process table. */
export function makeProcess(pid, ppid, uid, tty, started, command) {
  return { pid, ppid, uid, tty, started, command };
}

/** Two rows describe the very same process only when all of these agree. */
export function sameIdentity(a, b) {
  return a.pid === b.pid && a.uid === b.uid && a.started === b.started && a.command === b.command;
}

/** Every process on this computer: Map of pid -> row, in the order `ps` lists them. */
export function snapshot() {
  const raw = execFileSync('ps', ['-Ao', 'pid=,ppid=,uid=,tty=,lstart=,command='],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 * 1024 });
  const rows = new Map();
  for (const line of raw.split(/\r?\n/)) {
    // pid, ppid, uid, tty, five words of start time, then the whole command line.
    const f = /^\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S[\s\S]*)$/.exec(line);
    if (!f) continue;
    if (![f[1], f[2], f[3]].every(n => /^[+-]?\d+$/.test(n))) continue;
    const pid = Number(f[1]);
    rows.set(pid, makeProcess(pid, Number(f[2]), Number(f[3]), f[4], f.slice(5, 10).join(' '), f[10]));
  }
  return rows;
}

/** Is this one of ours, with no terminal, whose whole line of parents is ours and ends at init? */
export function stray(proc, rows) {
  if (proc.uid !== process.getuid() || !FAMILY.test(proc.command)) return false;
  let current = proc;
  const seen = new Set();
  for (;;) {
    if (seen.has(current.pid)) return false;
    seen.add(current.pid);
    if (!['??', '?'].includes(current.tty) || !FAMILY.test(current.command)) return false;
    if (current.ppid === 1) return true;
    if (!rows.has(current.ppid)) return false;
    current = rows.get(current.ppid);
  }
}

/** `root` and everything the same user started beneath it. */
export function descendants(root, rows) {
  const owned = new Map([[root.pid, root]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const proc of rows.values()) {
      if (!owned.has(proc.pid) && owned.has(proc.ppid) && proc.uid === root.uid) {
        owned.set(proc.pid, proc);
        changed = true;
      }
    }
  }
  return owned;
}

function sendSignal(pid, signal) {
  process.kill(pid, signal);
}

function pauseSeconds(seconds) {
  sleepSync(seconds * 1000);
}

/**
 * Stop one stray and what it started. Nothing is signalled unless it is still the very same
 * process, looked up again immediately before each signal. Returns true only when every one
 * of them was seen to be gone. `read`, `send` and `pause` can be replaced by a test.
 */
export function stopOrphan(original, read = snapshot, send = sendSignal, pause = pauseSeconds) {
  const signalIfSame = (proc, signal) => {
    const latest = read().get(proc.pid);
    if (latest && sameIdentity(latest, proc)) {
      try { send(proc.pid, signal); }
      catch (error) { if (!error || error.code !== 'ESRCH') throw error; }   // already gone
    }
  };
  let rows = read();
  const current = rows.get(original.pid);
  if (!current || !sameIdentity(current, original) || !stray(current, rows)) return false;
  const owned = descendants(current, rows);
  const stillThere = table => [...owned.values()].filter(p => table.has(p.pid) && sameIdentity(table.get(p.pid), p));
  for (const proc of [...owned.values()].reverse()) signalIfSame(proc, 'SIGTERM');
  let remaining = [];
  for (let i = 0; i < 5; i++) {
    rows = read();
    remaining = stillThere(rows);
    if (!remaining.length) return true;
    pause(1);
  }
  for (const proc of remaining) signalIfSame(proc, 'SIGKILL');
  pause(0.2);
  rows = read();
  return stillThere(rows).length === 0;
}

const USAGE = 'usage: sweep.mjs [-h] [--kill]';

function parseArgs(argv) {
  let kill = false;
  const unknown = [];
  for (const arg of argv) {
    if (arg === '-h' || (arg.length > 2 && '--help'.startsWith(arg))) {
      process.stdout.write(USAGE + '\n\n' +
        'Inspect Frenemy-family orphans; signal only with explicit --kill. Unknown\n' +
        'ancestry is protected. Full identity and ancestry are rechecked before TERM.\n' +
        'Escalation targets only the same identities in that owned tree.\n\n' +
        'options:\n  -h, --help  show this help message and exit\n  --kill\n');
      process.exit(0);
    }
    if (arg.length > 2 && '--kill'.startsWith(arg)) kill = true;
    else unknown.push(arg);
  }
  if (unknown.length) {
    process.stderr.write(USAGE + '\nsweep.mjs: error: unrecognized arguments: ' + unknown.join(' ') + '\n');
    process.exit(2);
  }
  return { kill };
}

export function main(argv = process.argv.slice(2)) {
  if (WIN) {
    console.log('This tool is for Mac and Linux. Nothing was inspected or signalled.');
    return 0;
  }
  const args = parseArgs(argv);
  const rows = snapshot();
  const me = process.getuid();
  const candidates = [...rows.values()].filter(p => p.uid === me && FAMILY.test(p.command) && p.pid !== process.pid);
  let failed = false;
  for (const proc of candidates) {
    const orphan = stray(proc, rows);
    console.log((orphan ? 'STRAY' : 'PROTECTED') + ' pid ' + proc.pid + ' ' + proc.command.slice(0, 100));
    if (args.kill && orphan) {
      const stopped = stopOrphan(proc);
      console.log(stopped ? '  stopped' : '  skipped, changed, or still present; inspect again');
      if (!stopped) failed = true;
    }
  }
  if (!args.kill) console.log('Dry run: no processes were signalled.');
  return failed ? 1 : 0;
}

function startedDirectly() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
}

if (startedDirectly()) process.exitCode = main();
