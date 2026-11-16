#!/usr/bin/env node
// fleet: the small job tool behind Snitch. One job is one row, a JSON file in <FLEET_DIR>/jobs.
//
//   fleet start <id> [--agent A] [--title T] [--total N] [--note N] [--beat-every S]
//                    [--watch FILE] [--max-silence S] [--driver D]
//   fleet step  <id> [N] [options]      one more step done (or step N)
//   fleet beat  <id> [options]          still alive
//   fleet done  <id> [options]          finished
//   fleet fail  <id> [options]          stopped with a problem
//   fleet run   <id> [--beat-every S] [--title T] [--agent A] [--total N] [--note N] -- COMMAND [ARG...]
//   fleet ls                            list the rows
//   fleet prune [--days N]              move old finished rows to <FLEET_DIR>/trash
//
// Every change to a row is read, changed and written while holding that row's lock, so two
// writers can never mix their work. Nothing is ever deleted: old rows and side files are moved
// into <FLEET_DIR>/trash.
//
// Other Node code uses the same writer without starting a process:
//   import { fleetCommand } from './fleet.mjs';   fleetCommand(['beat', id]) -> {code, stdout, stderr}
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import lock from '../extension/lib/joblock.js';
import { WIN, homeDir, sleepSync } from '../../tools/platform.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = 'usage: fleet start|run|step|beat|done|fail|ls|prune';
const LOCKED_VERBS = new Set(['start', 'step', 'beat', 'done', 'fail']);
const TEXT_KEYS = ['agent', 'title', 'state', 'note', 'cwd', 'by', 'watch', 'driver'];
const NUMBER_KEYS = ['step', 'total', 'started', 'beat', 'pid', 'every', 'seen', 'beats', 'maxsilence'];
const ROW_KEYS = ['id', 'agent', 'title', 'state', 'step', 'total', 'started', 'beat', 'note', 'pid',
  'cwd', 'by', 'every', 'seen', 'beats', 'maxsilence', 'watch', 'driver'];
const DIGITS = /^[0-9]+$/;

/** Ends a command with an exit code and one line for the error stream. */
class Exit extends Error {
  constructor(code, text) { super(text || ''); this.code = code; this.text = text || ''; }
}
const die = text => { throw new Exit(2, 'fleet: ' + text + '\n'); };

/** A folder inside another, joined the way the earlier shell tool wrote it. */
export function sub(dir, name) {
  return WIN ? path.join(dir, name) : dir + '/' + name;
}

/** Where the rows live: FLEET_DIR, or .fleet in the home folder. */
export function fleetDir(env = process.env) {
  return env.FLEET_DIR || sub(homeDir(env), '.fleet');
}

// ---- the folder this process works in ---------------------------------------------------
// A row records the folder a job runs in under the name its caller used, not the name the
// system would give it after following links (/tmp and /private/tmp on a Mac, for example).

let workingDir = null;

function sameFolder(a, b) {
  try {
    const one = fs.statSync(a), two = fs.statSync(b);
    return one.ino === two.ino && one.dev === two.dev;
  } catch { return false; }
}

/** The current folder, by the name the caller knows it. */
export function logicalCwd() {
  if (workingDir !== null) return workingDir;
  const named = process.env.PWD;
  if (!WIN && named && named.startsWith('/') && !named.split('/').some(part => part === '.' || part === '..') &&
      sameFolder(named, '.')) workingDir = named;
  else workingDir = process.cwd();
  return workingDir;
}

/** Move this process into another folder, keeping the name the caller used for it. */
export function changeDir(dir) {
  const target = path.resolve(logicalCwd(), dir);
  process.chdir(target);
  workingDir = target;
}

// ---- reading and writing rows -----------------------------------------------------------

// A strict reader of UTF-8. A Node built without its language data cannot make one; such a
// Node then reads text the lenient way, which is the only way it has.
let strictText = null;
try { strictText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); } catch { strictText = null; }

/** Bytes as text, or null when they are not clean UTF-8. */
export function decodeText(bytes) {
  if (!strictText) return Buffer.from(bytes).toString('utf8');
  try { return strictText.decode(bytes); } catch { return null; }
}

/** A file's text, or null when it is missing, unreadable or not clean UTF-8. */
export function readText(file) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { return null; }
  return decodeText(bytes);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

/** Put a finished temp file in place of the real one: readers see the old or the new, never half. */
export function replaceFile(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (error) {
      // On Windows a file that a reader has open for a moment cannot be replaced; try again shortly.
      if (!WIN || attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      sleepSync(15);
    }
  }
}

// At most 120 bytes of text, never cut inside a character, without trailing line ends.
function clip(text) {
  let bytes = Buffer.from(String(text), 'utf8');
  if (bytes.length > 120) {
    let end = 120;
    while (end > 0 && (bytes[end] & 0xC0) === 0x80) end--;
    bytes = bytes.subarray(0, end);
  }
  return bytes.toString('utf8').replace(/\n+$/, '');
}
const noTrailingLineEnds = text => String(text).replace(/\n+$/, '');

/** The process that asked for this row, by name. Only Linux can tell without another program. */
function callerName() {
  if (!WIN) {
    try {
      const name = fs.readFileSync('/proc/' + process.ppid + '/comm', 'utf8').replace(/\n/g, '').replace(/^.*\//, '');
      if (name) return name;
    } catch { /* no /proc on this system */ }
  }
  return 'unknown';
}

function command(argv, cx) {
  const { env, io } = cx;
  const now = () => BigInt(Math.floor(Date.now() / 1000));
  const FLEET_DIR = fleetDir(env);
  const JOBS = sub(FLEET_DIR, 'jobs');
  const TMP = sub(FLEET_DIR, '.tmp');
  try {
    fs.mkdirSync(JOBS, { recursive: true });
    fs.mkdirSync(TMP, { recursive: true });
  } catch (error) { throw new Exit(1, 'fleet: ' + error.message + '\n'); }

  // Read one row. Anything missing or unusable keeps its starting value.
  const load = (id, verb) => {
    const row = { agent: 'shell', title: id, state: 'running', step: 0n, total: 0n, started: null, beat: null,
      pid: 0n, note: '', cwd: '', by: '', every: 0n, seen: 0n, beats: 0n, watch: '', maxsilence: 0n, driver: '' };
    let file = sub(JOBS, id + '.json'), dismissed = false;
    if (!isFile(file) && verb !== 'start') { file = sub(sub(FLEET_DIR, 'dismissed'), id + '.json'); dismissed = true; }
    if (!isFile(file)) return row;
    let saved = {};
    const text = readText(file);
    if (text !== null) { try { saved = JSON.parse(text); } catch { saved = {}; } }
    if (!isRecord(saved)) saved = {};
    if (dismissed) saved = Object.prototype.hasOwnProperty.call(saved, 'row') ? saved.row : {};
    if (!isRecord(saved)) saved = {};
    for (const key of TEXT_KEYS) if (typeof saved[key] === 'string') row[key] = saved[key];
    for (const key of NUMBER_KEYS) {
      const value = saved[key];
      const digits = typeof value === 'string' ? value
        : typeof value === 'number' && Number.isInteger(value) ? String(value) : '';
      if (DIGITS.test(digits)) row[key] = BigInt(digits);
    }
    return row;
  };

  // Move a file into the trash folder under a name that says when and by whom.
  const retire = file => {
    if (!isFile(file)) return true;
    const trash = sub(FLEET_DIR, 'trash');
    try {
      fs.mkdirSync(trash, { recursive: true });
      const stem = now() + '-' + cx.pid, name = path.basename(file);
      let target = sub(trash, stem + '-' + name);
      for (let n = 2; fs.existsSync(target); n++) target = sub(trash, stem + '.' + n + '-' + name);
      fs.renameSync(file, target);
      return true;
    } catch { return false; }
  };

  const writeJob = values => {
    const row = Object.assign({}, values);
    for (const key of ['title', 'note', 'by', 'driver']) row[key] = clip(row[key]);
    for (const key of ['cwd', 'watch']) row[key] = noTrailingLineEnds(row[key]);
    const temp = sub(TMP, row.id + '.' + cx.pid + '.part');
    const lines = [];
    let bad = null;
    for (const key of ROW_KEYS) {
      if (NUMBER_KEYS.includes(key)) {
        const digits = String(row[key] === '' || row[key] === null || row[key] === undefined ? '0' : row[key]);
        if (!DIGITS.test(digits)) { if (bad === null) bad = key; continue; }
        lines.push('  ' + JSON.stringify(key) + ': ' + BigInt(digits).toString());
      } else lines.push('  ' + JSON.stringify(key) + ': ' + JSON.stringify(String(row[key])));
    }
    if (bad !== null) {
      // The earlier tool left its empty temp file behind here; so does this one.
      try { fs.writeFileSync(temp, ''); } catch { /* nothing to leave */ }
      throw new Exit(2, 'fleet: invalid nonnegative integer for ' + bad + '\nfleet: invalid job data\n');
    }
    const target = sub(JOBS, row.id + '.json');
    try { fs.writeFileSync(temp, '{\n' + lines.join(',\n') + '\n}\n'); }
    catch { die('invalid job data'); }
    try { replaceFile(temp, target); }
    catch { die('cannot install ' + target); }
    if (!retire(sub(sub(FLEET_DIR, 'dismissed'), row.id + '.json'))) die('cannot retire dismissal for ' + row.id);
  };

  const args = argv.map(String);
  const CMD = args.length ? args.shift() : '';
  if (CMD === '') die(USAGE);

  if (CMD === 'run') die('run starts a command and waits for it; use the fleet command itself for that');

  if (CMD === 'ls') {
    const result = spawnSync(process.execPath, [path.join(HERE, 'list-jobs.js'), JOBS],
      { stdio: cx.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true });
    if (!cx.inherit) { io.out.push(result.stdout || ''); io.err.push(result.stderr || ''); }
    throw new Exit(result.error ? 127 : result.status === null ? 1 : result.status, '');
  }

  if (CMD === 'prune') {
    let days = '7';
    if (args[0] === '--days') days = args[1] || '7';
    if (!DIGITS.test(days)) die('--days must be a nonnegative integer');
    const limit = BigInt(days) * 86400n;
    const T = now();
    try { fs.mkdirSync(sub(FLEET_DIR, 'trash'), { recursive: true }); } catch { /* reported by the moves below */ }
    let moved = 0, names = [];
    try { names = fs.readdirSync(JOBS).sort(); } catch { names = []; }
    for (const name of names) {
      if (name.startsWith('.') || !name.endsWith('.json')) continue;
      const file = sub(JOBS, name);
      if (!isFile(file)) continue;
      const id = name.slice(0, -'.json'.length);
      const row = load(id, CMD);
      if (row.state !== 'done' && row.state !== 'failed') continue;
      if (!(T - (row.beat === null ? T : row.beat) > limit)) continue;
      if (retire(file)) moved++;
      for (const side of ['steps', 'trail', 'tasks']) retire(sub(JOBS, id + '.' + side));
    }
    io.out.push('moved ' + moved + ' finished job(s) to ' + sub(FLEET_DIR, 'trash') + '\n');
    return;
  }

  const ID = args.length ? args.shift() : '';
  if (ID === '') die(CMD + ' needs a job id');
  if (!/^[A-Za-z0-9._-]+$/.test(ID) || ID.startsWith('.')) {
    die('job id must use letters, digits, dot, underscore or dash, and cannot start with dot');
  }

  let setStep = '';
  if (CMD === 'step' && args.length && args[0] !== '' && !args[0].startsWith('--')) setStep = args.shift();

  const given = { agent: '', title: '', total: '', note: '', every: '', watch: '', maxsilence: '', driver: '' };
  let haveNote = false, haveDriver = false;
  const flags = { '--agent': 'agent', '--title': 'title', '--total': 'total', '--note': 'note',
    '--beat-every': 'every', '--watch': 'watch', '--max-silence': 'maxsilence', '--driver': 'driver' };
  while (args.length) {
    if (args.length < 2) die('missing value for ' + args[0]);
    const key = Object.prototype.hasOwnProperty.call(flags, args[0]) ? flags[args[0]] : null;
    if (!key) die('unknown option: ' + args[0]);
    given[key] = args[1];
    if (key === 'note') haveNote = true;
    if (key === 'driver') haveDriver = true;
    args.splice(0, 2);
  }
  if ((given.note + given.title).includes('\n')) die('--note/--title cannot contain a newline');

  const old = load(ID, CMD);
  const relayJob = env.FRENEMY_RELAY_JOB || '';
  if (relayJob !== '' && relayJob === ID) {
    // A worker started by the relay may only keep the relay's own row alive. It may not open,
    // close or rename it: the relay does that.
    if (!(isFile(sub(JOBS, ID + '.json')) && old.state === 'running' && CMD === 'beat')) throw new Exit(0, '');
    given.agent = ''; given.title = ''; haveNote = false; haveDriver = false;
  }
  let T = now();
  if (old.beat !== null && old.beat > T) T = old.beat;       // a row's clock never runs backwards
  if (old.started === null) old.started = T;
  if (old.beat === null) old.beat = T;

  const agent = given.agent || old.agent;
  const title = given.title || old.title;
  const total = given.total || old.total;
  let step = old.step, state = old.state, started = old.started, pid = old.pid;
  let cwd = old.cwd, by = old.by;
  const every = given.every || old.every;
  let seen = old.seen, beats = old.beats;
  let watch = given.watch || old.watch;
  let maxsilence = given.maxsilence || old.maxsilence;
  let driver = haveDriver ? given.driver : old.driver;
  const absolute = WIN ? path.isAbsolute(watch) : watch.startsWith('/');
  if (watch !== '' && !absolute) watch = sub(cx.cwd(), watch);

  // The job's own rhythm: a running average of the time between its signs of life.
  const gap = T - old.beat;
  if (gap > 0n && gap < 86400n) {
    seen = beats > 0n ? (3n * gap + 7n * seen) / 10n : gap;
    beats += 1n;
  }
  let note = haveNote ? given.note : old.note;

  if (CMD === 'start') {
    step = 0n; state = 'running'; started = T; pid = cx.pid;
    seen = 0n; beats = 0n;                       // a new run proves nothing yet; its rhythm starts over
    if (given.watch === '') watch = '';          // a fresh run does not inherit the old watch
    if (given.maxsilence === '') maxsilence = 0n;
    if (given.driver === '') driver = '';
    if (!haveNote) note = '';
    cwd = ''; by = '';                           // cleared so they are recorded again for this run
    retire(sub(JOBS, ID + '.steps'));
    try { fs.writeFileSync(sub(JOBS, ID + '.steps'), ''); } catch { /* the row is still written */ }
    retire(sub(JOBS, ID + '.trail'));
    retire(sub(JOBS, ID + '.tasks'));
  } else if (CMD === 'step') {
    step = setStep !== '' ? setStep : step + 1n;
    state = 'running';
    try { fs.appendFileSync(sub(JOBS, ID + '.steps'), T + '\n'); } catch { /* the row is still written */ }
  } else if (CMD === 'beat') {
    state = 'running';
  } else if (CMD === 'done') {
    state = 'done';
    if (DIGITS.test(String(total)) && BigInt(total) > 0n) step = total;
  } else if (CMD === 'fail') {
    state = 'failed';
  } else die('unknown command: ' + CMD);

  if (cwd === '') cwd = cx.cwd();
  if (by === '') by = callerName();

  writeJob({ id: ID, agent, title, state, step, total, started, beat: T, note, pid, cwd, by,
    every, seen, beats, maxsilence, watch, driver });
}

/**
 * Run one fleet command inside this process. Returns {code, stdout, stderr}; never throws.
 * options: env (default process.env), cwd (the folder recorded for a new row), pid,
 * locked (the caller already holds this row's lock), inherit (`ls` prints straight to the screen).
 */
export function fleetCommand(argv, options = {}) {
  const io = { out: [], err: [] };
  const env = options.env || process.env;
  const cx = { env, io, pid: BigInt(options.pid || process.pid), inherit: Boolean(options.inherit),
    cwd: () => options.cwd || logicalCwd() };
  let code = 0;
  try {
    const verb = argv.length ? String(argv[0]) : '';
    const id = argv.length > 1 ? String(argv[1]) : '';
    if (LOCKED_VERBS.has(verb) && id !== '' && !options.locked) {
      lock.withLockSync(sub(fleetDir(env), '.writer-locks'), lock.keyFor(id), () => command(argv, cx));
    } else command(argv, cx);
  } catch (error) {
    if (error instanceof Exit) { code = error.code; if (error.text) io.err.push(error.text); }
    else { code = 1; io.err.push('fleet: ' + (error && error.message ? error.message : String(error)) + '\n'); }
  }
  return { code, stdout: io.out.join(''), stderr: io.err.join('') };
}

// ---- the command itself -----------------------------------------------------------------

async function runVerb(args) {
  const fail = text => { process.stderr.write('fleet: ' + text + '\n'); return 2; };
  const FLEET_DIR = fleetDir();
  try {
    fs.mkdirSync(sub(FLEET_DIR, 'jobs'), { recursive: true });
    fs.mkdirSync(sub(FLEET_DIR, '.tmp'), { recursive: true });
  } catch (error) { process.stderr.write('fleet: ' + error.message + '\n'); return 1; }
  let every = '30', title = '', agent = '', total = '', note = '';
  const id = args.length ? args.shift() : '';
  if (id === '') return fail('run needs a job id');
  while (args.length) {
    if (args[0] !== '--' && args.length < 2) return fail('missing value for ' + args[0]);
    if (args[0] === '--') { args.shift(); break; }
    if (args[0] === '--beat-every') every = args[1] || '30';
    else if (args[0] === '--title') title = args[1];
    else if (args[0] === '--agent') agent = args[1];
    else if (args[0] === '--total') total = args[1];
    else if (args[0] === '--note') note = args[1];
    else return fail('unknown option before --: ' + args[0]);
    args.splice(0, 2);
  }
  if (!args.length) return fail('run needs a command after --');
  const { runJob, checkEvery } = await import('./run-job.mjs');
  const seconds = checkEvery(every);
  if (typeof seconds === 'string') { process.stderr.write('run-job: ' + seconds + '\n'); return 2; }
  return runJob({ jobId: id, every: seconds, title, agent: agent || 'shell', total: total || '0', note,
    command: args, record: recordArgs => fleetCommand(recordArgs) });
}

async function main(argv) {
  const args = argv.map(String);
  // A caller that already holds this row's lock says so by naming itself.
  const locked = process.env.FLEET_SERIALIZED_PID === String(process.ppid);
  delete process.env.FLEET_SERIALIZED_PID;
  if (args[0] === 'run') return runVerb(args.slice(1));
  const result = fleetCommand(args, { locked, inherit: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.code;
}

function startedDirectly() {
  if (!process.argv[1]) return false;
  try {
    const asked = fs.realpathSync(process.argv[1]), self = fs.realpathSync(fileURLToPath(import.meta.url));
    return WIN ? asked.toLowerCase() === self.toLowerCase() : asked === self;
  } catch { return false; }
}

if (startedDirectly()) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; },
    error => { process.stderr.write('fleet: ' + (error && error.message ? error.message : String(error)) + '\n'); process.exitCode = 1; });
}
