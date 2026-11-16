// What every wrapper shares. A wrapper takes one prompt, starts one AI app's command-line
// program with it, watches a time limit, caps what comes back and passes the app's exit code on.
// When a wrapper ends, for any reason, the app it started is stopped and the wrapper's scratch
// files are moved aside (never deleted).
import fs from 'node:fs';
import os from 'node:os';
import { WIN, sleepSync, resolveBin, spawnCli, stopProcessTreeSync, retireTemp, tempFile } from './platform.mjs';

export { WIN, resolveBin };

export const MAX_PROMPT = 200000;      // bytes of prompt a wrapper accepts
export const MAX_OUT = 200000;         // bytes of answer that flow back to the caller
export const ERR_SHOWN = 4000;         // bytes of the app's own error text that are passed on
export const WIN_ARG_LIMIT = 30000;    // characters of prompt a Windows command line can carry
// Linux refuses any single command-line argument longer than 128 KiB, so a prompt that travels as
// an argument (agy, Kimi) gets a smaller cap there. Mac takes the full size.
export const ARG_PROMPT_CAP = process.platform === 'linux' ? 120000 : MAX_PROMPT;

// ---- writing and leaving ------------------------------------------------------------------

/** Write to standard output (1) or standard error (2) and return only when it has been written. */
export function emit(fd, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  let at = 0;
  while (at < bytes.length) {
    try { at += fs.writeSync(fd, bytes, at, bytes.length - at); }
    catch (error) {
      if (error.code === 'EAGAIN') { sleepSync(5); continue; }
      return;                           // the reader has gone away
    }
  }
}

/** One line on standard error. */
export function say(line) { emit(2, line + '\n'); }

/** End the wrapper with this exit code, after an optional line on standard error. */
export function leave(code, line) {
  if (line !== undefined) say(line);
  process.exit(code);
}

// ---- the end of a run ---------------------------------------------------------------------

const scratch = [];          // files moved aside when the wrapper ends
let app = null;              // the AI app this wrapper started
let ended = false;

// platform.mjs stops a process tree but has no call for a process group. On Mac and Linux the
// app is started as the leader of its own group, and the group is what the earlier shell
// wrappers stopped, so that is done here. Returns false when nobody is left in the group.
function signalGroup(pid, signal) {
  if (WIN || !Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(-pid, signal); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function appRunning() {
  return Boolean(app && app.pid && app.exitCode === null && app.signalCode === null);
}

// Stop the app and everything it started: ask, wait a fifth of a second, then force.
function stopApp() {
  if (!app || !app.pid) return;
  if (WIN) {
    // No groups on Windows: the tree under the app is stopped while the app can still be found.
    if (appRunning()) stopProcessTreeSync(app.pid, 200);
    return;
  }
  if (!signalGroup(app.pid, 'SIGTERM')) return;
  sleepSync(200);
  signalGroup(app.pid, 'SIGKILL');
}

function endOfRun() {
  if (ended) return;
  ended = true;
  try { stopApp(); } catch { /* the scratch files are still moved aside */ }
  retireTemp(...scratch);
}

/**
 * From here on the wrapper cleans up however it ends, and a stop signal ends it with the usual
 * code (interrupt 130, terminate 143, hang-up 129). Also fills in the few names an app expects
 * to find in its environment when the caller passed none.
 */
export function installCleanup() {
  if (!process.env.USER) {
    try { process.env.USER = os.userInfo().username; } catch { /* left unset */ }
  }
  if (!process.env.LOGNAME && process.env.USER) process.env.LOGNAME = process.env.USER;
  if (!WIN && !process.env.SHELL) {
    try { const shell = os.userInfo().shell; if (shell) process.env.SHELL = shell; } catch { /* left unset */ }
  }
  process.on('exit', endOfRun);
  // On Windows these do not run when the wrapper is stopped from outside; there the relay stops
  // the wrapper and the app together.
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
  process.on('SIGHUP', () => process.exit(129));
}

/** Who asked for this run. A relay host sets its own name; nothing set means Claude's own shell. */
export function defaultDriver() {
  if (!process.env.FRENEMY_DRIVER) process.env.FRENEMY_DRIVER = 'claude';
}

/** A new scratch file that is moved aside when the wrapper ends. Exit 3 when none can be made. */
export function scratchFile() {
  let file;
  try { file = tempFile('frenemy-wrapper-'); } catch { process.exit(3); }
  scratch.push(file);
  return file;
}

// ---- the prompt ---------------------------------------------------------------------------

/** Everything on standard input, as bytes. */
export function readStdin() {
  return new Promise(resolve => {
    const chunks = [];
    const done = () => resolve(Buffer.concat(chunks));
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    process.stdin.resume();
  });
}

/** The prompt as the shell wrappers held it: no zero bytes, and no line ends after the last line. */
export function trimPrompt(bytes) {
  let clean = bytes.includes(0) ? Buffer.from(bytes.filter(byte => byte !== 0)) : bytes;
  let end = clean.length;
  while (end > 0 && clean[end - 1] === 0x0a) end--;
  return clean.subarray(0, end);
}

/** The time limit in seconds from the environment (570 when not set), or exit 2 with `complaint`. */
export function timeLimit(envName, complaint) {
  const text = process.env[envName] || '570';
  if (!/^[0-9]+$/.test(text)) leave(2, complaint(text));
  return { text, seconds: Number(text) };
}

/**
 * The one prompt of a wrapper that hands it to the app as a command-line argument: the single
 * argument when one was given, otherwise standard input. Exits 2 on a bad one.
 */
export async function argumentPrompt(name) {
  const given = process.argv.slice(2);
  if (given.length > 1) leave(2, `${name}: expected one prompt argument (or stdin), got ${given.length}`);
  const prompt = given.length === 1 ? given[0] : trimPrompt(await readStdin()).toString('utf8');
  if (!prompt) leave(2, `${name}: empty prompt`);
  const size = Buffer.byteLength(prompt, 'utf8');
  if (size > ARG_PROMPT_CAP) leave(2, `${name}: prompt is ${size} bytes; cap is ${ARG_PROMPT_CAP}`);
  if (WIN) {
    // A Windows command line holds about 32,000 characters in all, quoting included.
    const quoted = prompt.length + 2 + (prompt.match(/["\\]/g) || []).length;
    if (quoted > WIN_ARG_LIMIT) {
      leave(2, `${name}: prompt is ${prompt.length} characters; on Windows the cap is ${WIN_ARG_LIMIT} because it travels on the command line`);
    }
  }
  return prompt;
}

// ---- running the app ----------------------------------------------------------------------

function open(file, flags) {
  try { return fs.openSync(file, flags); } catch { process.exit(3); }
}

/**
 * Start the app and wait for it. Its output goes to the files `out` and `err`; its input is the
 * file `input`, or nothing. `everySecond` runs once at the start and then each second while the
 * app runs. `onTimeout` runs when `seconds` (0 = no limit) have passed and must end the wrapper;
 * `killOnTimeout` forces the app's group down first, as most of the shell wrappers did.
 * Resolves the app's exit code (128 + the signal number when a signal ended it).
 */
export function runApp({ bin, args, out, err, input, seconds, everySecond, onTimeout, killOnTimeout = true }) {
  return new Promise(resolve => {
    const fds = [input ? open(input, 'r') : 'ignore', open(out, 'a'), open(err, 'a')];
    const closeFds = () => { for (const fd of fds) if (typeof fd === 'number') { try { fs.closeSync(fd); } catch { /* closed */ } } };
    let timer = null, settled = false;
    const finish = code => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      resolve(code);
    };
    // An app that cannot be started ends the way a shell reports it: 127 when the file is not
    // there, 126 otherwise, with the reason in the error file.
    const notStarted = error => {
      try { fs.appendFileSync(err, String((error && error.message) || error) + '\n'); } catch { /* nothing more to say */ }
      finish(error && error.code === 'ENOENT' ? 127 : 126);
    };
    try { app = spawnCli(bin, args, { stdio: fds, group: true, env: process.env }); }
    catch (error) { closeFds(); notStarted(error); return; }
    closeFds();
    app.on('error', notStarted);
    app.on('exit', (code, signal) => finish(code === null ? 128 + (os.constants.signals[signal] || 0) : code));
    if (everySecond) everySecond();
    let waited = 0;
    timer = setInterval(() => {
      if (settled) return;
      waited += 1;
      if (everySecond) everySecond();
      if (seconds > 0 && waited >= seconds) {
        clearInterval(timer);
        if (killOnTimeout && app.pid) signalGroup(app.pid, 'SIGKILL');
        onTimeout();
      }
    }, 1000);
  });
}

// ---- what comes back ----------------------------------------------------------------------

/** The size of a file in bytes (0 when it cannot be read). */
export function sizeOf(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

/** The first `count` bytes of a file. */
export function head(file, count) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return Buffer.alloc(0); }
  try {
    const bytes = Buffer.alloc(Math.min(count, sizeOf(file)));
    let got = 0;
    while (got < bytes.length) {
      const read = fs.readSync(fd, bytes, got, bytes.length - got, got);
      if (read <= 0) break;
      got += read;
    }
    return bytes.subarray(0, got);
  } catch { return Buffer.alloc(0); }
  finally { fs.closeSync(fd); }
}

/** The last `count` bytes of a file. */
export function tail(file, count) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return Buffer.alloc(0); }
  try {
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - count);
    const bytes = Buffer.alloc(size - start);
    let got = 0;
    while (got < bytes.length) {
      const read = fs.readSync(fd, bytes, got, bytes.length - got, start + got);
      if (read <= 0) break;
      got += read;
    }
    return bytes.subarray(0, got);
  } catch { return Buffer.alloc(0); }
  finally { fs.closeSync(fd); }
}

/** The first `count` characters of a text (whole characters, never half of one). */
export function firstChars(text, count) {
  if (text.length <= count) return text;
  let units = 0, seen = 0;
  for (const character of text) {
    if (seen === count) break;
    units += character.length;
    seen += 1;
  }
  return text.slice(0, units);
}

/**
 * Pass a plain-text answer on: the app's output up to the cap (with a note when it was cut),
 * then the start of its error text, then leave with the app's own exit code. An app that wrote
 * nothing ends the wrapper with exit 1.
 */
export function deliver(name, out, err, code) {
  if (!sizeOf(out)) {
    say('wrapper: worker produced no answer');
    emit(2, head(err, ERR_SHOWN));
    process.exit(1);
  }
  emit(1, head(out, MAX_OUT));
  if (sizeOf(out) > MAX_OUT) emit(1, `\n[${name}: answer truncated at ${MAX_OUT} bytes]\n`);
  if (sizeOf(err)) emit(2, head(err, ERR_SHOWN));
  process.exit(code);
}

// ---- agy ----------------------------------------------------------------------------------

const QUOTA_LINE = /run\.go:[0-9]+\] Run: attempt [0-9]+ failed \(RESOURCE_EXHAUSTED \(code 429\): Individual quota reached\./;

/**
 * Google's own "quota reached" report at the end of agy's log, or null. Only the log's last
 * 16 KB is read, and only agy's own failure line counts, so the same words quoted inside an
 * answer never trip it. Returns { reset } with the reset time agy reported ('' when none).
 */
export function agyQuota(logFile) {
  try { if (!fs.statSync(logFile).isFile()) return null; } catch { return null; }
  const lines = tail(logFile, 16384).toString('latin1').split('\n').filter(line => QUOTA_LINE.test(line));
  if (!lines.length) return null;
  const reset = /^.*Resets in ([0-9hms]*)/.exec(lines[lines.length - 1]);
  return { reset: reset ? reset[1] : '' };
}

/**
 * Both agy wrappers. `name` is the word that starts each message; `fullRights` adds the flag
 * that lets agy write files and run commands without asking.
 */
export async function runAgy({ name, fullRights }) {
  defaultDriver();
  const bin = resolveBin('agy');
  if (!bin) leave(127, `${name}: agy not found/executable at ${process.env.AGY_BIN || ''}`);
  const limit = timeLimit('AGY_TIMEOUT', text => `${name}: AGY_TIMEOUT must be a number, got '${text}'`);
  const prompt = await argumentPrompt(name);

  installCleanup();
  const out = scratchFile(), err = scratchFile();
  let log = process.env.AGY_LOG_FILE;
  if (!log) {
    try { log = tempFile('frenemy-agy-log.'); } catch { process.exit(3); }
  }
  const checkQuota = () => {
    const found = agyQuota(log);
    if (!found) return;
    leave(75, 'Google quota exhausted (Individual quota reached); worker stopped' +
      (found.reset ? '; reported reset in ' + found.reset : '') + '.');
  };

  const printTimeout = limit.seconds > 0 ? (limit.seconds + 60) + 's' : '24h';
  const args = ['--log-file', log];
  if (fullRights) args.push('--dangerously-skip-permissions');
  args.push('--print-timeout', printTimeout, '-p', prompt);
  const code = await runApp({
    bin, args, out, err, seconds: limit.seconds, everySecond: checkQuota,
    onTimeout: () => leave(124, `${name}: agy timed out after ${limit.text}s and was killed`),
  });
  checkQuota();

  const silent = file => {
    try { return /(?:^|\n)jetski: no output produced/.test(fs.readFileSync(file, 'latin1')); } catch { return false; }
  };
  if (silent(out) || silent(err)) {
    emit(2, head(out, ERR_SHOWN));
    if (sizeOf(err)) emit(2, head(err, ERR_SHOWN));
    process.exit(1);
  }
  deliver(name, out, err, code);
}
