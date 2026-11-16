// The work behind the two Snitch reporters, claude-beat.mjs and agent-beat.mjs.
//
// An AI app starts a reporter each time something happens in a chat (a tool call, the end of a
// turn, an error) and hands it a small JSON note on its input. The reporter turns that note
// into the chat's row for the Snitch panel:
//   <FLEET_DIR>/jobs/<id>.json    the row itself, written through the fleet writer
//   <FLEET_DIR>/jobs/<id>.trail   the last five things the chat did
//   <FLEET_DIR>/jobs/<id>.tasks   the chat's plan, when it keeps one
//
// Notes from one chat are handled one at a time and in the order they happened: a note that
// reaches the front of the queue after a newer one was already handled is dropped.
//
// Everything here runs inside the reporter's own process. A reporter must be quick and must
// never get in the way of the app that started it, so the two small start files catch every
// error raised from here and end quietly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tty from 'node:tty';
import lock from '../extension/lib/joblock.js';
import { WIN, sleepSync } from '../../tools/platform.mjs';
import { fleetCommand, fleetDir, logicalCwd, changeDir, decodeText, readText, replaceFile, sub } from '../bin/fleet.mjs';

// ---- reading JSON values the way the earlier reporters did --------------------------------
// The notes come from four different apps and are not always the shape one expects. These few
// helpers keep the handling of odd values (missing, empty, a list where text was expected)
// exactly as it was, so the same note still gives the same row.

const SPACE = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const SPACES = new RegExp('[' + SPACE + ']+');
const OUTER_SPACES = new RegExp('^[' + SPACE + ']+|[' + SPACE + ']+$', 'g');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Empty things count as nothing: null, false, 0, "", [] and {}. */
function truthy(value) {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

/** The first value that is not empty, or the last one given. */
function or(...values) {
  for (let i = 0; i < values.length - 1; i++) if (truthy(values[i])) return values[i];
  return values[values.length - 1];
}

/** A field of a record. Throws when asked for a field of something that is not a record. */
function get(record, key, fallback = null) {
  if (!isRecord(record)) throw new TypeError('not a record');
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : fallback;
}

function quotedText(text) {
  const mark = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === mark) out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += '\\x' + code.toString(16).padStart(2, '0');
    else out += ch;
  }
  return mark + out + mark;
}

function shown(value) {
  return typeof value === 'string' ? quotedText(value) : asText(value);
}

/** Any JSON value as text. */
function asText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return BigInt(value).toString();
    return String(value).replace(/e([+-])(\d)$/, 'e$10$2');
  }
  if (Array.isArray(value)) return '[' + value.map(shown).join(', ') + ']';
  return '{' + Object.keys(value).map(key => quotedText(key) + ': ' + shown(value[key])).join(', ') + '}';
}

/** Text on one line: every run of spaces, tabs and line ends becomes one space. */
function oneLine(text) {
  return String(text).split(SPACES).filter(Boolean).join(' ');
}

/** One line of at most `limit` characters, ending in "…" when it was cut. */
function brief(value, limit = 58) {
  const line = oneLine(asText(value));
  const chars = Array.from(line);
  return chars.length <= limit ? line : chars.slice(0, limit - 1).join('') + '…';
}

function capital(text) {
  const chars = Array.from(text);
  return chars.length ? chars[0].toUpperCase() + chars.slice(1).join('') : text;
}

const TRAILING_SLASHES = WIN ? /[\\/]+$/ : /\/+$/;
function lastPart(text) {
  const cut = WIN ? Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\')) : text.lastIndexOf('/');
  return text.slice(cut + 1);
}

/** A whole number written as text ("12", " 7 ", "+3"); throws on anything else. */
function wholeNumber(text) {
  const tidy = String(text).replace(OUTER_SPACES, '');
  if (!/^[+-]?[0-9]+(_[0-9]+)*$/.test(tidy)) throw new RangeError('not a whole number');
  return BigInt(tidy.replace(/_/g, '').replace(/^\+/, ''));
}

function readJson(file) {
  const text = readText(file);
  if (text === null) throw new Error('unreadable');
  return JSON.parse(text);
}

// ---- the note on the reporter's input -----------------------------------------------------

/** Everything on standard input, or nothing when a person is at the keyboard. */
export function readStdin() {
  try { if (tty.isatty(0)) return Buffer.alloc(0); } catch { return Buffer.alloc(0); }
  const chunks = [];
  const block = Buffer.alloc(65536);
  let waited = 0;
  for (;;) {
    let count;
    try { count = fs.readSync(0, block, 0, block.length, null); }
    catch (error) {
      if ((error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK') && waited < 1000) { waited++; sleepSync(10); continue; }
      break;                                   // the end of the input, or no input at all
    }
    if (count === 0) break;
    waited = 0;
    chunks.push(Buffer.from(block.subarray(0, count)));
  }
  return Buffer.concat(chunks);
}

/** The input as bytes (without the line ends after it) and, when it is JSON, its value. */
export function readInput(raw = readStdin()) {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0x0a) end--;
  const bytes = raw.subarray(0, end);
  let ok = false, value;
  try {
    const text = decodeText(raw);
    if (text !== null) { value = JSON.parse(text); ok = true; }
  } catch { ok = false; }
  return { bytes, ok, value };
}

/** A moment in milliseconds as whole nanoseconds, the unit the order stamps are kept in. */
function nanoseconds(ms) {
  const whole = Math.floor(ms);
  return BigInt(whole) * 1000000n + BigInt(Math.floor((ms - whole) * 1e6));
}

/**
 * Handle one chat's notes one at a time, newest wins. `body` runs while this chat's lock is
 * held; it is skipped (and "stale" returned) when a note received later was already handled.
 */
export function serialized(agent, input, receivedMs, body) {
  const payload = input.ok && isRecord(input.value) ? input.value : {};
  const session = or(get(payload, 'session_id'), get(payload, 'sessionId'), get(payload, 'conversationId'), null);
  const key = lock.keyFor(agent + ':' + (truthy(session) ? asText(session) : process.cwd()));
  // A full path, so the lock is found again after the reporter has moved into the chat's folder.
  const dir = path.resolve(sub(fleetDir(), '.hook-locks'));
  const received = nanoseconds(receivedMs);
  return lock.withLockSync(dir, key, () => {
    const stamp = sub(dir, key + '.stamp');
    let previous = 0n;
    try { previous = wholeNumber(fs.readFileSync(stamp, 'utf8')); } catch { previous = 0n; }
    if (received <= previous) return 'stale';
    body();
    const part = sub(dir, key + '.part');
    fs.writeFileSync(part, received.toString());
    replaceFile(part, stamp);
    return 'handled';
  });
}

// ---- where Claude keeps a background command's output -------------------------------------

/** The folder Claude Code writes background output under. SNITCH_TASK_ROOT overrides it. */
export function taskRoot(env = process.env) {
  if (env.SNITCH_TASK_ROOT) return env.SNITCH_TASK_ROOT;
  if (WIN) return path.join(os.tmpdir(), 'claude');
  return (process.platform === 'darwin' ? '/private/tmp' : '/tmp') + '/claude-' + process.getuid();
}

function tidyRoot(root) {
  if (WIN) return path.normalize(String(root));
  const parts = String(root).split('/').filter(part => part && part !== '.');
  return (String(root).startsWith('/') ? '/' : '') + parts.join('/') || '.';
}

function visibleNames(dir) {
  try { return fs.readdirSync(dir).filter(name => !name.startsWith('.')); } catch { return []; }
}

/**
 * The output file of one background task, found without guessing across projects: first in
 * this chat's own project, then by the chat's id anywhere, then anywhere at all, and only when
 * exactly one file fits. Throws when two fit, or when there is nothing to go on.
 */
export function resolveBackgroundLog(task, session, transcript, root) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(task))) throw new Error('invalid background task id');
  if (!/^[A-Za-z0-9_-]+$/.test(String(session))) throw new Error('invalid session id');
  const base = tidyRoot(root);
  let slug = transcript ? path.basename(path.dirname(String(transcript))) : '';
  if (slug === '.') slug = '';
  const place = (project, chat) => WIN ? path.join(base, project, chat, 'tasks', task + '.output')
    : base + '/' + project + '/' + chat + '/tasks/' + task + '.output';
  let home = null;
  try { home = fs.realpathSync(base); } catch { home = null; }
  const real = file => {
    try {
      if (!fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || home === null) return false;
      const resolved = fs.realpathSync(file);
      return resolved === home || resolved.startsWith(home.endsWith(path.sep) ? home : home + path.sep);
    } catch { return false; }
  };
  const any = null;
  const searches = [];
  if (slug) searches.push([slug, session], [slug, any]);
  searches.push([any, session], [any, any]);
  for (const [project, chat] of searches) {
    const found = [];
    for (const projectName of project === any ? visibleNames(base) : [project]) {
      const projectDir = WIN ? path.join(base, projectName) : base + '/' + projectName;
      for (const chatName of chat === any ? visibleNames(projectDir) : [chat]) {
        const file = place(projectName, chatName);
        if (real(file)) found.push(file);
      }
    }
    if (found.length === 1) return found[0];
    if (found.length > 1) throw new Error('ambiguous background output; no log selected');
  }
  if (slug) return place(slug, session);
  throw new Error('background output location unavailable');
}

const EXIT_STAMP = new RegExp('(?:^|\\n)\\[exited with code (-?[0-9]+)\\][' + SPACE + ']*$');

/**
 * Close the rows of background commands that have really ended: only when the last thing in
 * the command's own output file is the line the app writes on exit. Each row is read again
 * under its writer lock, so a run that just started is never closed by an older run's output.
 */
export function closeBackground(env = process.env) {
  const store = fleetDir(env);
  const jobs = sub(store, 'jobs');
  const locks = sub(store, '.writer-locks');
  fs.mkdirSync(locks, { recursive: true });
  let names;
  try { names = fs.readdirSync(jobs); } catch { return; }
  for (const name of names) {
    if (!name.startsWith('bg-') || !name.endsWith('.json') || name.length < 'bg-.json'.length) continue;
    const id = name.slice(0, -'.json'.length);
    if (!/^[A-Za-z0-9._-]+$/.test(id)) continue;
    try {
      lock.withLockSync(locks, lock.keyFor(id), () => {
        const row = readJson(sub(jobs, name));
        if (!isRecord(row) || row.state !== 'running' || !truthy(row.watch) || typeof row.watch !== 'string') return;
        let tail;
        const fd = fs.openSync(row.watch, 'r');
        try {
          const size = fs.fstatSync(fd).size;
          const buffer = Buffer.alloc(Math.min(size, 4096));
          fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
          tail = buffer.toString('utf8');
        } finally { fs.closeSync(fd); }
        const match = EXIT_STAMP.exec(tail);
        if (!match) return;
        const code = BigInt(match[1]);
        fleetCommand([code === 0n ? 'done' : 'fail', id, '--note', code === 0n ? 'finished' : 'stopped with code ' + code],
          { env, locked: true });
      });
    } catch { /* one unreadable row never stops the others */ }
  }
}

// ---- the trail: the last five things a chat did -------------------------------------------

// Every character that ends a line: the usual ones, and the rarer separators.
const LINE_ENDS = new RegExp('[\\n\\x0b\\x0c\\x1c-\\x1e\\x85' + String.fromCharCode(0x2028, 0x2029) + ']');

function trailLines(file) {
  const text = readText(file);
  if (text === null) return [];
  const lines = [];
  for (const line of text.replace(/\r\n?/g, '\n').split(LINE_ENDS)) {
    const parts = line.split('\t');
    if (parts.length === 3) lines.push(parts);
  }
  return lines;
}

// The same action again is counted on its line; a different one starts a new line.
function addToTrail(file, text, tempFile) {
  const now = String(Math.floor(Date.now() / 1000));
  const lines = trailLines(file);
  const last = lines.length ? lines[lines.length - 1] : null;
  if (last && last[2] === text) lines[lines.length - 1] = [now, String(wholeNumber(last[1] || '1') + 1n), text];
  else lines.push([now, '1', text]);
  fs.writeFileSync(tempFile, lines.slice(-5).map(parts => parts.join('\t') + '\n').join(''));
  replaceFile(tempFile, file);
}

const fleet = args => { try { fleetCommand(args); } catch { /* the row is simply not updated */ } };

// ---- Claude Code ---------------------------------------------------------------------------

// What a finished tool call was, in a few plain words, in the past tense.
function claudeAction(note) {
  const tool = or(get(note, 'tool_name'), '');
  let input = or(get(note, 'tool_input'), {});
  if (!isRecord(input)) input = {};
  const file = or(get(input, 'file_path'), get(input, 'notebook_path'), '');
  const name = value => { const text = asText(value); return lastPart(text.replace(TRAILING_SLASHES, '')) || text; };
  if (tool === 'Read') return truthy(file) ? 'Read ' + name(file) : 'Read a file';
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return truthy(file) ? 'Edited ' + name(file) : 'Edited a file';
  if (tool === 'Write') return truthy(file) ? 'Wrote ' + name(file) : 'Wrote a file';
  if (tool === 'Grep') return 'Searched for ' + brief(or(get(input, 'pattern'), ''), 34);
  if (tool === 'Glob') return 'Looked for files';
  if (tool === 'TodoWrite') return 'Updated the plan';
  if (tool === 'WebSearch') return 'Searched the web';
  if (tool === 'WebFetch') {
    const host = asText(or(get(input, 'url'), '')).split('//').pop().split('/')[0];
    return 'Fetched ' + (host || 'a page');
  }
  if (tool === 'Task' || tool === 'Agent') return 'Sent work to the ' + asText(or(get(input, 'subagent_type'), 'helper')) + ' helper';
  if (tool === 'Bash') {
    const what = brief(or(get(input, 'description'), get(input, 'command'), 'a command'));
    return truthy(get(input, 'run_in_background')) ? 'Started ' + what : capital(what);
  }
  return truthy(tool) ? brief(tool) : '';
}

// The trail line and the saved plan for one Claude note.
function claudeSideFiles(jobs, id, value) {
  const note = truthy(value) ? value : {};
  const text = claudeAction(note);
  if (text) addToTrail(sub(jobs, id + '.trail'), text, sub(jobs, id + '.trail.part'));
  if (or(get(note, 'tool_name'), '') !== 'TodoWrite') return;
  const todos = or(get(or(get(note, 'tool_input'), {}), 'todos'), []);
  if (!Array.isArray(todos) && !isRecord(todos) && typeof todos !== 'string') throw new TypeError('todos is not a list');
  const lines = [];
  for (const item of Array.isArray(todos) ? todos : []) {
    if (isRecord(item)) lines.push(asText(or(get(item, 'status'), 'pending')) + '\t' + brief(or(get(item, 'content'), ''), 70));
  }
  const body = lines.map(line => line + '\n').join('');
  const tasks = sub(jobs, id + '.tasks');
  const before = readText(tasks);
  if (body) {
    if (body !== (before === null ? null : before.replace(/\r\n?/g, '\n'))) {
      fs.writeFileSync(tasks + '.part', body);
      replaceFile(tasks + '.part', tasks);
    }
    return;
  }
  // An emptied plan is moved to the trash folder, never deleted.
  try {
    const trash = sub(sub(jobs, '..'), 'trash');
    fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(tasks, sub(trash, id + '-' + nanoseconds(Date.now()) + '-' + process.pid + '.tasks'));
  } catch { /* there was no plan file */ }
}

// The row this chat already owns, if any: the earliest one wins, so a chat keeps one row and
// one name for its whole life even when its shell moves into another folder.
function keptClaudeRow(jobs, tag) {
  let names;
  try { names = fs.readdirSync(jobs); } catch { return null; }
  const ending = '-' + tag + '.json';
  let best = null;
  for (const name of names) {
    if (!name.startsWith('claude-') || !name.endsWith(ending) || name.length < 'claude-'.length + ending.length) continue;
    const id = name.slice(0, -'.json'.length);
    if (!/^[A-Za-z0-9._-]+$/.test(id)) continue;
    let row, started;
    try {
      row = readJson(sub(jobs, name));
      if (get(row, 'agent') !== 'claude') continue;
      const value = or(get(row, 'started'), 0);
      if (typeof value === 'number') started = BigInt(Math.trunc(value));
      else if (typeof value === 'string') started = wholeNumber(value);
      else if (value === true) started = 1n;
      else continue;
    } catch { continue; }
    if (best === null || started < best.started || (started === best.started && id < best.id)) best = { started, id, row };
  }
  if (!best) return null;
  return { id: best.id, title: oneLine(asText(or(get(best.row, 'title'), ''))) };
}

function shellBaseName(dir) {
  const text = String(dir).replace(TRAILING_SLASHES, '');
  if (text === '') return String(dir) === '' ? '' : '/';
  return lastPart(text);
}

function claudeBody(argv, input) {
  const JOBS = sub(fleetDir(), 'jobs');
  const MODE = argv[0] || 'beat';
  const note = input.ok ? input.value : undefined;

  // One value from the note as text; nothing when it is missing or of another kind.
  const field = key => {
    if (!isRecord(note)) return '';
    const parent = key === 'backgroundTaskId' ? get(note, 'tool_response')
      : ['command', 'description', 'run_in_background'].includes(key) ? get(note, 'tool_input') : note;
    const value = isRecord(parent) ? get(parent, key, '') : '';
    if (typeof value === 'string') return value.replace(/\n+$/, '');
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return '';
  };

  const PROJECT = field('cwd') || process.env.CLAUDE_PROJECT_DIR || logicalCwd();
  try { if (fs.statSync(PROJECT).isDirectory()) changeDir(PROJECT); } catch { /* stay where we are */ }

  const FOLDER = shellBaseName(PROJECT).replace(/ /g, '-').replace(/[^A-Za-z0-9._-]/g, '');
  let TITLE = FOLDER.replace(/-/g, ' ');
  const SESSION_RAW = field('session_id');
  if (!SESSION_RAW) return;
  const SESSION = SESSION_RAW.replace(/[^A-Za-z0-9]/g, '');
  const TAG = (SESSION || 'solo').slice(-6);
  let ID = 'claude-' + FOLDER + '-' + TAG;

  const kept = keptClaudeRow(JOBS, TAG);
  if (kept) {
    ID = kept.id;
    if (kept.title) TITLE = kept.title;
  }

  const relayJob = process.env.FRENEMY_RELAY_JOB || '';
  if (relayJob) {
    // Started by the relay: report into the relay's own row, and only while it is running.
    if (!/^[A-Za-z0-9_-]+$/.test(relayJob)) return;
    let row;
    try { row = readJson(sub(JOBS, relayJob + '.json')); } catch { return; }
    if (!isRecord(row) || row.agent !== 'claude' || row.state !== 'running') return;
    ID = relayJob;
    TITLE = oneLine(asText(get(row, 'title', 'claude')));
  }

  const BG_ID = field('backgroundTaskId');
  if (BG_ID && field('run_in_background') === 'true') {
    // A command sent to the background gets a row of its own, watching its real output file.
    const oneLineInput = key => {
      if (!input.ok) return '';
      try { return oneLine(asText(or(get(or(get(truthy(note) ? note : {}, 'tool_input'), {}), key), ''))); }
      catch { return ''; }
    };
    const CMD = oneLineInput('command') || field('command');
    const WHAT = oneLineInput('description') || field('description') || 'background command';
    const has = part => CMD.includes(part);
    let WORKER = 'claude';
    if (has('ask-agy') || has('antigravity') || has('agy -p') || has('agy --print') || has('agy --prompt') || has(' agy ')) WORKER = 'agy';
    else if (has('ask-kimi') || has('kimi-code') || has('kimi -p') || has('kimi --prompt') || has(' kimi ')) WORKER = 'kimi';
    else if (has('ask-codex') || has('codex exec') || has('genimg.sh') || has(' codex ')) WORKER = 'codex';
    let BG_OUT = '';
    try { BG_OUT = String(resolveBackgroundLog(BG_ID, SESSION_RAW, field('transcript_path'), taskRoot())).replace(/\n+$/, ''); }
    catch { BG_OUT = ''; }
    const BG_NOTE = BG_OUT ? '' : 'Output log could not be identified reliably';
    fleet(['start', 'bg-' + BG_ID, '--agent', WORKER, '--driver', 'claude', '--title', WHAT,
      '--watch', BG_OUT, '--note', BG_NOTE, '--max-silence', '1800']);
  }

  try { closeBackground(); } catch { /* rows stay as they are */ }

  if (input.bytes.length && input.ok) {
    try { claudeSideFiles(JOBS, ID, note); } catch { /* no trail or plan for this note */ }
  }

  let DRV = process.env.FRENEMY_DRIVER || '';
  if (DRV === 'claude') DRV = '';

  if (relayJob) { fleet(['beat', ID]); return; }
  if (MODE === 'done' || MODE === 'stop') {
    fleet(['done', ID, '--agent', 'claude', '--driver', DRV, '--title', TITLE, '--note', 'Idle — waiting for you']);
  } else {
    // A chat promises no rhythm of its own. Without this bound a quiet chat was called
    // "No response" after five minutes and archived after thirty.
    fleet(['beat', ID, '--agent', 'claude', '--driver', DRV, '--title', TITLE, '--note', 'working', '--max-silence', '7200']);
  }
}

/** The whole Claude reporter: read the note, wait for this chat's turn, write the row. */
export function claudeMain(argv, receivedMs) {
  const input = readInput();
  return serialized('claude', input, receivedMs, () => claudeBody(argv, input));
}

// ---- Codex, Kimi and agy -------------------------------------------------------------------

const QUOTA = /quota (?:exhausted|reached|exceeded|has been exhausted)|RESOURCE_EXHAUSTED|usage limit (?:reached|exceeded|hit)|hit your (?:usage )?limit|reached your .{0,40}limit|insufficient[_ ]quota|insufficient balance/iu;
// The provider refused the account itself: sign-in or plan, its text does not say which.
const ACCESS = /subscription does not have access/iu;
const PLAN_TOOLS = ['update_plan', 'todowrite', 'todo_write'];
const SHELL_PREFIX = /^(\/bin\/)?(ba|z)?sh +-l?c +/;

// Work out, from one note, which row it belongs to and what to say in it.
// Returns null when the note gives nothing to report.
function agentReading(agent, mode, input, jobs, hookDir) {
  let note = input.ok && truthy(input.value) ? input.value : {};
  if (!isRecord(note)) note = {};
  const line = value => value === null || value === undefined ? '' : oneLine(asText(value));
  const name = value => { const text = asText(value).replace(TRAILING_SLASHES, ''); return lastPart(text) || text; };

  const env = process.env.ANTIGRAVITY_CONVERSATION_ID;
  const session = asText(or(get(note, 'session_id'), get(note, 'sessionId'), get(note, 'conversationId'),
    env === undefined ? null : env, '')).replace(/[^A-Za-z0-9]/g, '');
  if (!session) return null;
  const tag = session.slice(-6);

  let folder = '';
  if (agent === 'agy') {
    const workspaces = or(get(note, 'workspacePaths'), []);
    if (Array.isArray(workspaces) && workspaces.length) folder = asText(workspaces[0]);
  }
  if (!truthy(folder)) folder = or(get(note, 'cwd'), '');
  if (!truthy(folder)) folder = agent !== 'agy' ? hookDir : '';
  let full = truthy(folder) ? asText(folder) : '';
  folder = truthy(folder) ? name(folder) : '';
  const slug = folder.replace(/ /g, '-').replace(/[^A-Za-z0-9._-]/g, '') || agent;
  let title = slug.replace(/-/g, ' ');

  let tool = or(get(note, 'tool_name'), get(note, 'toolName'), '');
  let args = or(get(note, 'tool_input'), get(note, 'toolInput'), {});
  if (agent === 'agy') {
    const call = or(get(note, 'toolCall'), {});
    if (isRecord(call)) {
      tool = or(get(call, 'name'), tool);
      args = or(get(call, 'args'), args);
    }
  }
  if (!isRecord(args)) args = {};

  const firstText = keys => {
    for (const key of keys) {
      let value = get(args, key);
      if (Array.isArray(value)) value = value.map(asText).join(' ');
      if (truthy(value)) return asText(value);
    }
    return '';
  };

  let text = '';
  if (mode === 'beat' && truthy(tool)) {
    const shownTool = asText(tool);
    const low = shownTool.toLowerCase();
    const has = (...parts) => parts.some(part => low.includes(part));
    const file = firstText(['file_path', 'path', 'AbsolutePath', 'TargetFile', 'absolute_path', 'filePath', 'notebook_path']);
    const typed = firstText(['command', 'CommandLine', 'cmd', 'commandLine']);
    const patch = low.includes('patch') ? /\*\*\* (Update|Add|Delete) File: *([^ ]+)/.exec(line(typed)) : null;
    const ranCommand = () => capital(brief(line(typed).replace(SHELL_PREFIX, '') || 'a command'));
    if (patch) text = (patch[1] === 'Update' ? 'Edited ' : patch[1] === 'Add' ? 'Wrote ' : 'Deleted ') + name(patch[2]);
    else if (['bash', 'shell', 'exec_command', 'run_command', 'runcommand', 'execute'].includes(low)) text = ranCommand();
    else if (PLAN_TOOLS.includes(low)) text = 'Updated the plan';
    else if (has('read', 'view', 'open_file')) text = file ? 'Read ' + name(file) : 'Read a file';
    else if (has('write', 'create_file', 'replace', 'edit', 'apply_patch', 'patch')) {
      text = (has('edit', 'replace', 'patch') ? 'Edited ' : 'Wrote ') + (file ? name(file) : 'a file');
    } else if (has('grep', 'search', 'find')) {
      const pattern = firstText(['pattern', 'Query', 'query', 'SearchQuery', 'regex']);
      text = pattern ? 'Searched for ' + brief(pattern, 34) : 'Searched';
    } else if (has('glob', 'list_dir', 'find_by_name')) text = 'Looked for files';
    else if (has('shell', 'exec', 'bash', 'command', 'run')) text = ranCommand();
    else if (has('web', 'fetch', 'browser')) text = 'Looked something up on the web';
    else if (has('todo', 'plan')) text = 'Updated the plan';
    else text = brief(shownTool);
  }

  let id = agent + '-' + slug + '-' + tag;
  const namedFolder = truthy(get(note, 'cwd')) || (agent === 'agy' && truthy(get(note, 'workspacePaths')));
  if (!namedFolder) {
    // A note that names no folder (a bare "the turn ended") goes to the one row this chat already has.
    let names = [];
    try { names = fs.readdirSync(jobs); } catch { names = []; }
    const start = agent + '-', ending = '-' + tag + '.json';
    const matches = names.filter(file => file.startsWith(start) && file.endsWith(ending) && file.length >= start.length + ending.length);
    if (matches.length === 1) {
      let old = null;
      try { old = readJson(sub(jobs, matches[0])); } catch { old = null; }
      if (isRecord(old)) {
        id = matches[0].slice(0, -'.json'.length);
        if (typeof old.title === 'string') title = old.title;
        if (typeof old.cwd === 'string') full = old.cwd;
      }
    }
  }

  const relayJob = process.env.FRENEMY_RELAY_JOB || '';
  if (relayJob) {
    // Started by the relay: report into the relay's own row, and only while it is running.
    if (!/^[A-Za-z0-9_-]+$/.test(relayJob)) return null;
    let parent;
    try { parent = readJson(sub(jobs, relayJob + '.json')); } catch { return null; }
    if (!isRecord(parent) || parent.agent !== agent || parent.state !== 'running') return null;
    id = relayJob;
    title = get(parent, 'title', agent);
    full = get(parent, 'cwd', '');
  }

  if (mode === 'beat' && PLAN_TOOLS.includes(asText(tool).toLowerCase())) {
    const items = Object.prototype.hasOwnProperty.call(args, 'plan') ? args.plan : get(args, 'todos');
    if (Array.isArray(items)) {
      const rows = [];
      for (const item of items) {
        if (!isRecord(item)) continue;
        // Kept as the earlier reporter had it: the row's title becomes the last plan line read here.
        title = line(get(item, 'step', get(item, 'content', get(item, 'text', ''))));
        let status = asText(get(item, 'status', 'pending'));
        if (!['pending', 'in_progress', 'completed'].includes(status)) status = 'pending';
        if (title) rows.push(status + '\t' + title);
      }
      fs.mkdirSync(jobs, { recursive: true });
      const tasks = sub(jobs, id + '.tasks');
      const part = tasks + '.part.' + process.pid;
      fs.writeFileSync(part, rows.join('\n') + (rows.length ? '\n' : ''));
      replaceFile(part, tasks);
    }
  }

  if (typeof full !== 'string') {
    if (!Array.isArray(full) && !isRecord(full)) return null;
    full = (Array.isArray(full) ? full : Object.keys(full)).some(item => item === '\n' || item === '\r') ? '' : asText(full);
  }
  if (full.includes('\n') || full.includes('\r')) full = '';
  return { id, title: line(title), text: line(text), full };
}

function agentBody(agent, mode, input) {
  if (!['codex', 'kimi', 'agy'].includes(agent)) return;
  const JOBS = sub(fleetDir(), 'jobs');
  const hookDir = logicalCwd();

  // Keep a copy of the raw note when asked to, for building test fixtures from real events.
  const capture = process.env.SNITCH_CAPTURE || '';
  if (capture && input.bytes.length) {
    try {
      if (fs.statSync(capture).isDirectory()) {
        fs.writeFileSync(sub(capture, agent + '-' + mode + '-' + process.pid + '.json'), Buffer.concat([
          Buffer.from('cwd=' + hookDir + '\nFRENEMY_DRIVER=' + (process.env.FRENEMY_DRIVER || '') + '\n---\n'),
          input.bytes, Buffer.from('\n')]));
      }
    } catch { /* a capture that fails changes nothing else */ }
  }

  let reading = null;
  try { reading = agentReading(agent, mode, input, JOBS, hookDir); } catch { reading = null; }
  if (!reading || !reading.id) return;
  const ID = reading.id;
  const TITLE = reading.title || agent;
  try { if (reading.full && fs.statSync(reading.full).isDirectory()) changeDir(reading.full); } catch { /* stay where we are */ }

  if (reading.text) {
    try {
      fs.mkdirSync(JOBS, { recursive: true });
      const trail = sub(JOBS, ID + '.trail');
      addToTrail(trail, reading.text, trail + '.part.' + process.pid);   // a temp name of its own
    } catch { /* no trail line for this note */ }
  }

  const driver = process.env.FRENEMY_DRIVER || '';
  const DRV = driver === '' || driver === agent ? '' : driver;

  let VERB, NOTE;
  if (mode === 'fail') {
    // The provider's own words, when it sent any: a row that only says "stopped with an
    // error" hides the one thing worth knowing. Usage that ran out is named as that; an
    // account the provider refused is named as that, with no guess at the cause.
    VERB = 'fail';
    NOTE = '';
    try {
      if (input.ok && isRecord(input.value)) {
        let message = or(get(input.value, 'error_message'), get(input.value, 'error'), '');
        if (isRecord(message)) message = or(get(message, 'message'), '');
        message = oneLine(asText(message));
        if (message) {
          NOTE = (QUOTA.test(message) ? 'Subscription/quota ran out: '
            : ACCESS.test(message) ? 'Account refused (sign-in or plan): ' : 'Stopped with an error: ') + message;
        }
      }
    } catch { NOTE = ''; }
    if (!NOTE) NOTE = 'Session stopped with an error';
  } else if (mode === 'done' || mode === 'stop') {
    VERB = 'done'; NOTE = 'Idle — waiting for you';
  } else {
    VERB = 'beat'; NOTE = 'working';
  }
  const relayed = Boolean(process.env.FRENEMY_RELAY_JOB);
  if (relayed) { VERB = 'beat'; NOTE = ''; }
  // A chat promises no rhythm of its own. Without this bound a quiet chat was called
  // "No response" after five minutes and archived after thirty.
  // Standalone rows only: a relayed worker keeps the relay's own bound.
  const silence = !relayed && VERB === 'beat' ? ['--max-silence', '7200'] : [];
  fleet([VERB, ID, '--agent', agent, '--driver', DRV, '--title', TITLE, '--note', NOTE, ...silence]);
}

/**
 * The whole reporter for Codex, Kimi and agy: read the note, wait for this chat's turn, write
 * the row. The start file answers agy with "{}" itself, whatever happens here.
 */
export function agentMain(argv, receivedMs) {
  const input = readInput();
  const agent = argv.length ? argv[0] : 'claude';
  return serialized(agent, input, receivedMs, () => agentBody(argv.length ? argv[0] : '', argv[1] || 'beat', input));
}
