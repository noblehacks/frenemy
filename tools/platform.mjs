// The few things that differ between macOS, Linux and Windows, in one place, with Node alone:
// finding an app's command, starting it, listing processes, and stopping a process tree.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WIN = process.platform === 'win32';

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms));
}

function runnable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (!WIN) fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

/**
 * The full path of an app's command, or null. `NAME_BIN` in the environment wins when set
 * (and gives null when it does not point at a runnable file, so a test can switch an app off).
 * On Windows a real .exe is preferred over a .cmd or .bat launcher of the same name.
 */
export function resolveBin(name, envName = name.toUpperCase() + '_BIN', env = process.env) {
  const override = env[envName];
  if (override) return runnable(override) ? path.resolve(override) : null;
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const endings = WIN ? ['.exe', '.cmd', '.bat', '.com'] : [''];
  for (const ending of endings) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name + ending);
      if (path.isAbsolute(candidate) && runnable(candidate)) return candidate;
    }
  }
  return null;
}

// ---- Windows launchers -------------------------------------------------------------------
// npm puts a small .cmd file in front of apps written in JavaScript. Node cannot start a .cmd
// directly, and passing a prompt through cmd.exe is unsafe and loses every line after the
// first. So the launcher is read and the real program behind it is started instead.

/** What an npm .cmd launcher really runs: {node:true, target} or {node:false, target}, or null. */
export function readCmdShim(text, shimPath) {
  const base = path.win32.dirname(shimPath);
  const match = /"%(?:~dp0|dp0%)\\?([^"%]+?\.(?:js|mjs|cjs|exe))"/i.exec(String(text));
  if (!match) return null;
  const target = path.win32.join(base, match[1]);
  return { node: !/\.exe$/i.test(target), target };
}

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** One argument, quoted for a program started through cmd.exe. */
export function quoteCmdArg(value) {
  let arg = String(value);
  arg = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return ('"' + arg + '"').replace(CMD_META, '^$1');
}

/**
 * Start an app's command the same way on every system. `bin` is a full path from resolveBin.
 * Options are child_process.spawn options. On macOS and Linux `group:true` gives the app its
 * own process group, so the whole group can be stopped together.
 */
export function spawnCli(bin, args = [], options = {}) {
  const { group, ...rest } = options;
  if (!WIN) return spawn(bin, args, { ...rest, detached: Boolean(group) });
  const base = { ...rest, windowsHide: true };
  if (!/\.(cmd|bat)$/i.test(bin)) return spawn(bin, args, base);
  let shim = null;
  try { shim = readCmdShim(fs.readFileSync(bin, 'utf8'), bin); } catch { /* unreadable launcher */ }
  if (shim && fs.existsSync(shim.target)) {
    return shim.node ? spawn(process.execPath, [shim.target, ...args], base) : spawn(shim.target, args, base);
  }
  if (args.some(a => /[\r\n]/.test(String(a)))) {
    throw new Error(path.basename(bin) + ' is a .cmd launcher this version cannot look inside, and text with ' +
      'more than one line cannot pass through it. Install the app with its own Windows installer, or set ' +
      path.basename(bin).replace(/\.(cmd|bat)$/i, '').toUpperCase() + '_BIN to its .exe.');
  }
  const line = [quoteCmdArg(bin), ...args.map(quoteCmdArg)].join(' ');
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + line + '"'],
    { ...base, windowsVerbatimArguments: true });
}

// ---- processes ---------------------------------------------------------------------------

// Two ways to ask Windows for its processes. Each prints "pid parent start" on one line per
// process, the start as one whole number. The first needs nothing but PowerShell itself. The
// second is a command PowerShell must first find among its add-ons: in the short environment a
// relay gives a wrapper that search took 24 seconds and more on a Windows Server 2025 test
// computer, against under half a second for the first. It stays as the fallback.
const WINDOWS_LIST_PLAIN =
  "foreach ($p in ([wmisearcher]'SELECT ProcessId,ParentProcessId,CreationDate FROM Win32_Process').Get()) { " +
  "if ($p.CreationDate) { '{0} {1} {2}' -f $p.ProcessId, $p.ParentProcessId, " +
  '[System.Management.ManagementDateTimeConverter]::ToDateTime($p.CreationDate).ToFileTimeUtc() } }';
const WINDOWS_LIST_COMMAND =
  "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f " +
  '$_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToFileTimeUtc() }';

function windowsRows(script, timeout) {
  const rows = new Map();
  // PowerShell's own complaints (a system process without a start time) stay out of the caller's output.
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  for (const line of raw.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (m) rows.set(Number(m[1]), { pid: Number(m[1]), parent: Number(m[2]), status: 'R', started: m[3] });
  }
  return rows;
}

/**
 * Every process on this computer: Map of pid -> {pid, parent, status, started}. `started`
 * identifies one process for as long as it lives, so a reused pid is never mistaken for it.
 * Throws when the system will not list processes; callers then signal nothing.
 */
export function processSnapshot() {
  if (WIN) {
    let rows = null;
    try { rows = windowsRows(WINDOWS_LIST_PLAIN, 8000); } catch { /* the second way below */ }
    return rows && rows.size ? rows : windowsRows(WINDOWS_LIST_COMMAND, 15000);
  }
  const rows = new Map();
  const raw = execFileSync('ps', ['-Ao', 'pid=,ppid=,stat=,lstart='],
    { encoding: 'utf8', timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
  for (const line of raw.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (m) rows.set(Number(m[1]), { pid: Number(m[1]), parent: Number(m[2]), status: m[3], started: m[4] });
  }
  return rows;
}

/** `pid` and everything started beneath it, taken from one snapshot. */
export function ownedTree(pid, rows) {
  const owned = new Map();
  if (rows.has(pid)) owned.set(pid, rows.get(pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows.values()) if (!owned.has(row.pid) && owned.has(row.parent)) {
      owned.set(row.pid, row); changed = true;
    }
  }
  return owned;
}

/** Is this the same live process the snapshot saw (same pid, same start, not a zombie)? */
export function stillOwned(target, rows) {
  const now = rows.get(target.pid);
  return Boolean(now && now.started === target.started && !String(now.status).startsWith('Z'));
}

/**
 * Signal exactly the processes in `targets` that are still the same processes, children first.
 * Windows has no polite signal for a hidden program, so there every signal ends the process.
 */
export function signalOwned(targets, signal, rows) {
  for (const target of [...targets.values()].reverse()) {
    if (!stillOwned(target, rows)) continue;
    try {
      if (WIN) spawnSync('taskkill.exe', ['/PID', String(target.pid), '/F'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
      else process.kill(target.pid, signal);
    } catch { /* already gone */ }
  }
}

// ---- stopping on Windows -----------------------------------------------------------------
// Every signal ends a Windows process at once, and a new list of all processes means starting
// PowerShell again. So the tree found in one list is ended, and then each of its process numbers
// is asked directly whether it still runs, which costs nothing. The list is read again only for
// a process that still answers: to end it a second time, and at the end to tell a survivor from
// a new process that was given the same number.

const WINDOWS_STOP_MS = 10000;      // how long the processes get to disappear
const WINDOWS_AGAIN_MS = 1500;      // when a process that still answers is ended a second time

function numberGone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

// One look at the processes left. Gives true (all gone), false (gave up) or the milliseconds to
// wait before the next look. Throws when the list cannot be read; the callers answer false.
function windowsStopLook(state) {
  state.left = state.left.filter(target => !numberGone(target.pid));
  if (!state.left.length) return true;
  const waited = Date.now() - state.started;
  const last = waited >= WINDOWS_STOP_MS;
  if (last || (!state.again && waited >= WINDOWS_AGAIN_MS)) {
    const rows = processSnapshot();
    state.left = state.left.filter(target => stillOwned(target, rows));
    if (!state.left.length) return true;
    if (last) { state.why = 'still running: ' + state.left.map(target => target.pid).join(', '); return false; }
    signalOwned(new Map(state.left.map(target => [target.pid, target])), 'SIGKILL', rows);
    state.again = true;
  }
  return 50;
}

/**
 * Windows: end the processes in `targets`, which were just read from the list `rows`, and see
 * that they are gone. Returns true only when every one of them was seen to be gone. When it
 * returns false, `onFailure` (if given) is told why in a few words.
 */
export async function stopWindowsTree(targets, rows, onFailure) {
  const state = { left: [...targets.values()], started: Date.now(), again: false, why: '' };
  try {
    signalOwned(targets, 'SIGTERM', rows);
    for (;;) {
      const look = windowsStopLook(state);
      if (look === true) return true;
      if (look === false) break;
      await new Promise(resolve => setTimeout(resolve, look));
    }
  } catch (error) { state.why = 'the process list could not be read: ' + String((error && error.message) || error).split('\n')[0]; }
  if (onFailure) { try { onFailure(state.why); } catch { /* the answer is false either way */ } }
  return false;
}

function stopWindowsTreeSync(targets, rows) {
  const state = { left: [...targets.values()], started: Date.now(), again: false, why: '' };
  try {
    signalOwned(targets, 'SIGTERM', rows);
    for (;;) {
      const look = windowsStopLook(state);
      if (look === true || look === false) return look;
      sleepSync(look);
    }
  } catch { return false; }
}

/**
 * Stop `pid` and everything beneath it, then look again to see that it worked. Asks first
 * (SIGTERM), forces after `graceMs`; on Windows every process is ended at once (see above).
 * Returns true only when every process was seen to be gone.
 * `onTargets` receives the processes found, for a caller that keeps its own record of them.
 */
export async function stopProcessTree(pid, graceMs = 2000, onTargets) {
  if (!pid) return true;
  let targets, listed;
  try { listed = processSnapshot(); targets = ownedTree(pid, listed); } catch { return false; }
  if (onTargets) onTargets(targets);
  if (WIN) return stopWindowsTree(targets, listed);
  try {
    signalOwned(targets, 'SIGTERM', processSnapshot());
    const started = Date.now();
    const limit = Math.min(graceMs + 2000, 5000);
    let escalated = false;
    while (Date.now() - started < limit) {
      const rows = processSnapshot();
      if (![...targets.values()].some(t => stillOwned(t, rows))) return true;
      if (!escalated && Date.now() - started >= graceMs) { signalOwned(targets, 'SIGKILL', rows); escalated = true; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  } catch { return false; }
}

/** The same, for code that cannot wait on a promise (a signal handler, an exit path). */
export function stopProcessTreeSync(pid, graceMs = 1000) {
  if (!pid) return true;
  let targets, listed;
  try { listed = processSnapshot(); targets = ownedTree(pid, listed); } catch { return false; }
  if (WIN) return stopWindowsTreeSync(targets, listed);
  try {
    signalOwned(targets, 'SIGTERM', processSnapshot());
    const started = Date.now();
    const limit = graceMs + 3000;
    let escalated = false;
    while (Date.now() - started < limit) {
      const rows = processSnapshot();
      if (![...targets.values()].some(t => stillOwned(t, rows))) return true;
      if (!escalated && Date.now() - started >= graceMs) { signalOwned(targets, 'SIGKILL', rows); escalated = true; }
      sleepSync(100);
    }
    return false;
  } catch { return false; }
}

// ---- small shared pieces -----------------------------------------------------------------

/**
 * Wrapper scratch files are moved aside when a run ends, never deleted, the way the earlier
 * shell wrappers did it.
 */
export function retireTemp(...files) {
  const dir = path.join(os.tmpdir(), 'frenemy-retained-wrapper-files');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return; }
  for (const file of files) {
    if (!file) continue;
    try {
      if (!fs.statSync(file).isFile()) continue;
      fs.renameSync(file, path.join(dir, path.basename(file) + '.' + process.pid + '.' + Math.floor(Math.random() * 32768)));
    } catch { /* nothing to move */ }
  }
}

/** A new empty scratch file, private to this user. */
export function tempFile(prefix = 'frenemy-') {
  for (let attempt = 0; attempt < 20; attempt++) {
    const file = path.join(os.tmpdir(), prefix + process.pid + '-' + Math.random().toString(36).slice(2, 12));
    try { fs.closeSync(fs.openSync(file, 'wx', 0o600)); return file; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('Could not make a scratch file in ' + os.tmpdir());
}

/** The home folder, honouring HOME (or USERPROFILE on Windows) when a test sets it. */
export function homeDir(env = process.env) {
  return (WIN ? env.USERPROFILE : env.HOME) || os.homedir();
}

/** A path written so every shell on every system reads it the same way (forward slashes). */
export function portablePath(file) {
  return WIN ? String(file).replace(/\\/g, '/') : String(file);
}
