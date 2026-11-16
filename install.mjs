#!/usr/bin/env node
// Install into a new directory, then connect the installed AI apps to each other.
//
// Every settings file is backed up before it is changed, only Frenemy's own entries are
// added or refreshed, and each result is parsed again before it is kept.
//
// Needs Node.js 18 or newer and nothing else. Runs on macOS, Linux and Windows itself.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let platformTools;
try {
  platformTools = await import('./tools/platform.mjs');
} catch {
  console.error('Installation stopped: this download is not complete (tools/platform.mjs is missing). ' +
    'Download Frenemy again and unpack it into a new, empty folder.');
  process.exit(1);
}
const { WIN, resolveBin, spawnCli, stopProcessTreeSync, homeDir, sleepSync } = platformTools;

export const ROOT = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
export const SEATS = ['claude', 'codex', 'agy', 'kimi'];
export const NAMES = { claude: 'Claude', codex: 'Codex', agy: 'Gemini (agy)', kimi: 'Kimi' };
const NODE_NEEDED = 18;

/** A plain message for the person at the keyboard; never shown with a stack or an error name. */
export class Stop extends Error {}
/** Ctrl-C (or the window closing) while an app was being connected. */
export class Interrupted extends Error {
  constructor() { super('interrupted'); }
}

const pad = (n, width = 2) => String(n).padStart(width, '0');
function stamp(now = new Date()) {
  return pad(now.getFullYear(), 4) + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
}
const STAMP = stamp();

const isObj = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof TomlDate);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function lexists(file) {
  try { fs.lstatSync(file); return true; } catch { return false; }
}
function isSymlink(file) {
  try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; }
}
function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
function isDir(file) {
  try { return fs.statSync(file).isDirectory(); } catch { return false; }
}

/** Is `inner` the folder `outer` itself or somewhere inside it? */
function inside(inner, outer) {
  const rel = path.relative(outer, inner);
  return rel === '' || !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
}

/**
 * A settings file as text. Bytes that are not valid UTF-8 stop the work on that file: they
 * could not be written back unchanged. A byte-order mark is kept in the text, so the JSON and
 * TOML readers refuse it instead of quietly dropping it.
 */
export function readText(file) {
  const bytes = fs.readFileSync(file);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Stop(path.basename(file) + ' is not plain UTF-8 text, so it was left alone'); }
}

/** JSON the way the earlier installer wrote it: two-space indent, non-ASCII characters escaped. */
function jsonText(value) {
  return JSON.stringify(value, null, 2).replace(/[\u007f-￿]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
}

// On Windows a virus scanner can hold a new file for a moment; a rename is tried a few times.
function rename(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (error) {
      if (!WIN || attempt >= 9 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      sleepSync(300);
    }
  }
}

/** Copy one file with its permissions and dates, following a link to the real file. */
function copy2(from, to) {
  const info = fs.statSync(from);
  fs.copyFileSync(from, to);
  if (!WIN) fs.chmodSync(to, info.mode & 0o7777);
  try { fs.utimesSync(to, info.atime, info.mtime); } catch { /* dates are a nicety */ }
}

const SKIPPED_IN_COPY = name => name === '__pycache__' || name === '.DS_Store' || name.endsWith('.pyc');

/** Copy a folder and everything in it, leaving out Finder and Python leftovers. */
function copyTree(source, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(source)) {
    if (SKIPPED_IN_COPY(item)) continue;
    const from = path.join(source, item), to = path.join(dest, item);
    const info = fs.statSync(from);
    if (info.isDirectory()) copyTree(from, to);
    else if (info.isFile()) copy2(from, to);
  }
  const info = fs.statSync(source);
  if (!WIN) fs.chmodSync(dest, info.mode & 0o7777);
  try { fs.utimesSync(dest, info.atime, info.mtime); } catch { /* dates are a nicety */ }
}

// ---- command lines -----------------------------------------------------------------------

/** One word, quoted for a POSIX shell. */
export function shQuote(text) {
  return "'" + String(text).replace(/'/g, "'\"'\"'") + "'";
}

/** Split a command line into words the way a POSIX shell does. Throws on an unclosed quote. */
export function shSplit(text) {
  if (typeof text !== 'string') throw new TypeError('not a command line');
  const words = [];
  let word = null, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      if (word !== null) { words.push(word); word = null; }
      i++;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) throw new Error('No closing quotation');
      word = (word ?? '') + text.slice(i + 1, end); i = end + 1;
    } else if (c === '"') {
      word = word ?? ''; i++;
      for (;;) {
        if (i >= text.length) throw new Error('No closing quotation');
        if (text[i] === '"') { i++; break; }
        if (text[i] === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) { word += text[i + 1]; i += 2; }
        else { word += text[i]; i++; }
      }
    } else if (c === '\\') {
      if (i + 1 >= text.length) throw new Error('No escaped character');
      word = (word ?? '') + text[i + 1]; i += 2;
    } else { word = (word ?? '') + c; i++; }
  }
  if (word !== null) words.push(word);
  return words;
}

// Characters that a Windows shell would change inside double quotes.
const WINDOWS_UNSAFE = /[%$`"\u0000-\u001f]/;

/** Stop early when the install folder cannot be written safely into a Windows command. */
export function checkFolderForShells(prefix, platform = process.platform) {
  if (platform === 'win32' && WINDOWS_UNSAFE.test(String(prefix))) {
    throw new Stop('The install folder name contains %, $ or ` , which Windows command windows change. ' +
      'Choose another folder with --prefix.');
  }
}

// Which events each app reports to Snitch, and with which word. These are the sets and the
// shapes of a working installation of each app; an event an app does not know is ignored
// by that app.
export const EVENTS = {
  claude: [['PostToolUse', ''], ['Stop', 'done'], ['UserPromptSubmit', 'beat'], ['SessionEnd', 'done']],
  codex: [['PostToolUse', ''], ['Stop', 'done'], ['UserPromptSubmit', 'beat'], ['SessionStart', 'done'],
    ['SessionEnd', 'done'], ['Interrupt', 'done']],
  agy: [['PostToolUse', ''], ['Stop', 'done']],
  kimi: [['PostToolUse', ''], ['Stop', 'done'], ['UserPromptSubmit', 'beat'], ['SessionStart', 'done'],
    ['SessionEnd', 'done'], ['Interrupt', 'done'], ['StopFailure', 'fail']],
};

/**
 * The reporter command one app runs for one event.
 * macOS and Linux:  '<node>' '<prefix>/snitch/hooks/claude-beat.mjs' [word]
 * Windows:          node "<prefix with forward slashes>/snitch/hooks/claude-beat.mjs" [word]
 * (the Windows form is read the same way by cmd, PowerShell and Git Bash).
 * `where` is {node, platform}; the platform is a parameter so both forms can be tested anywhere.
 */
export function hookCommand(driver, prefix, word, where = {}) {
  const platform = where.platform || process.platform;
  const file = driver === 'claude' ? 'claude-beat.mjs' : 'agent-beat.mjs';
  const rest = [driver === 'claude' ? '' : driver, word].filter(Boolean);
  if (platform === 'win32') {
    checkFolderForShells(prefix, platform);
    const script = path.win32.join(String(prefix), 'snitch', 'hooks', file).replace(/\\/g, '/');
    return ['node', '"' + script + '"', ...rest].join(' ');
  }
  if (!where.node) throw new Error('hookCommand needs the path of node');
  const script = path.posix.join(String(prefix), 'snitch', 'hooks', file);
  return [shQuote(where.node), shQuote(script), ...rest].join(' ');
}

export function hookEntries(driver, prefix, where) {
  const hooks = {};
  for (const [event, word] of EVENTS[driver]) {
    const entry = { type: 'command', command: hookCommand(driver, prefix, word, where) };
    if (driver === 'codex') hooks[event] = [{ matcher: '', hooks: [{ ...entry, timeout: 10 }] }];
    else if (driver === 'agy' && event !== 'PostToolUse') hooks[event] = [entry];
    else if (driver === 'claude' && (event === 'UserPromptSubmit' || event === 'SessionEnd')) {
      hooks[event] = [{ hooks: [{ ...entry, timeout: 10 }] }];
    } else hooks[event] = [{ matcher: '*', hooks: [entry] }];
  }
  return hooks;
}

export function kimiHookText(prefix, events, where) {
  return EVENTS.kimi.filter(([event]) => events == null || events.includes(event))
    .map(([event, word]) => '[[hooks]]\nevent = ' + JSON.stringify(event) + '\ncommand = ' +
      JSON.stringify(hookCommand('kimi', prefix, word, where)) + '\n\n').join('');
}

/** True for a server entry that an earlier or this Frenemy wrote. */
export function isFrenemy(entry) {
  const args = isObj(entry) && Array.isArray(entry.args) ? entry.args : [];
  return args.some(a => /ask-(claude|codex|agy|kimi)-mcp\.mjs$/.test(String(a)));
}

/**
 * True only when the program being run is one of Frenemy's reporter scripts: the shell
 * reporters of an earlier Frenemy (the script itself is the program), or the Node reporters
 * (node is the program and the script is its first argument).
 */
export function isReporter(command) {
  let words;
  try { words = shSplit(command); } catch { return false; }
  if (!words.length) return false;
  const program = words[0].replace(/\\/g, '/');
  if (program.endsWith('/snitch/hooks/claude-beat.sh') || program.endsWith('/snitch/hooks/agent-beat.sh')) return true;
  if (words.length < 2 || !/^node[\w.-]*$/i.test(program.split('/').pop())) return false;
  const script = words[1].replace(/\\/g, '/');
  return script.endsWith('/snitch/hooks/claude-beat.mjs') || script.endsWith('/snitch/hooks/agent-beat.mjs');
}

// ---- a small, strict TOML reader ----------------------------------------------------------
// Reads TOML 1.0. Anything it is not sure about is an error, and the caller then changes
// nothing in that file. Dates and times are kept as their own text.

export class TomlError extends Stop {}
export class TomlDate {
  constructor(text) { this.text = text; Object.freeze(this); }
}

const FROZEN = 0, EXPLICIT_NEST = 1;

class TomlFlags {
  constructor() { this.flags = new Map(); this.pending = []; }
  static node() { return { flags: new Set(), recursive: new Set(), nested: new Map() }; }
  addPending(key, flag) { this.pending.push([key, flag]); }
  finalizePending() {
    for (const [key, flag] of this.pending) this.set(key, flag, false);
    this.pending = [];
  }
  unsetAll(key) {
    let cont = this.flags;
    for (const k of key.slice(0, -1)) {
      if (!cont.has(k)) return;
      cont = cont.get(k).nested;
    }
    cont.delete(key[key.length - 1]);
  }
  set(key, flag, recursive) {
    let cont = this.flags;
    for (const k of key.slice(0, -1)) {
      if (!cont.has(k)) cont.set(k, TomlFlags.node());
      cont = cont.get(k).nested;
    }
    const stem = key[key.length - 1];
    if (!cont.has(stem)) cont.set(stem, TomlFlags.node());
    (recursive ? cont.get(stem).recursive : cont.get(stem).flags).add(flag);
  }
  is(key, flag) {
    if (!key.length) return false;
    let cont = this.flags;
    for (const k of key.slice(0, -1)) {
      if (!cont.has(k)) return false;
      const inner = cont.get(k);
      if (inner.recursive.has(flag)) return true;
      cont = inner.nested;
    }
    const stem = key[key.length - 1];
    if (!cont.has(stem)) return false;
    const last = cont.get(stem);
    return last.flags.has(flag) || last.recursive.has(flag);
  }
}

const isTable = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof TomlDate);
const newTable = () => Object.create(null);
const NO_NEST = Symbol('no nest');

function tomlNest(root, key, accessLists = true) {
  let cont = root;
  for (const k of key) {
    if (!(k in cont)) cont[k] = newTable();
    cont = cont[k];
    if (accessLists && Array.isArray(cont)) {
      if (!cont.length) throw NO_NEST;
      cont = cont[cont.length - 1];
    }
    if (!isTable(cont)) throw NO_NEST;
  }
  return cont;
}

const RE_TIME = '([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\\.([0-9]{1,6})[0-9]*)?';
const RE_DATETIME = new RegExp('([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])' +
  '(?:[Tt ]' + RE_TIME + '(?:([Zz])|([+-])([01][0-9]|2[0-3]):([0-5][0-9]))?)?', 'y');
const RE_LOCALTIME = new RegExp(RE_TIME, 'y');
const RE_NUMBER = new RegExp('0(?:x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|b[01](?:_?[01])*|o[0-7](?:_?[0-7])*)' +
  '|[+-]?(?:0|[1-9](?:_?[0-9])*)((?:\\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?)', 'y');
const RE_BARE = /[A-Za-z0-9_-]/;
const ILLEGAL_ONE_LINE = /[\u0000-\u0008\u000a-\u001f\u007f]/;      // control characters other than tab
const ILLEGAL_MULTI_LINE = /[\u0000-\u0008\u000b-\u001f\u007f]/;    // the same, but a line break is fine
const ESCAPES = { '\\b': '\b', '\\t': '\t', '\\n': '\n', '\\f': '\f', '\\r': '\r', '\\"': '"', '\\\\': '\\' };

/** Parse TOML text into tables (objects without a prototype), arrays, strings, numbers, booleans and TomlDate. */
export function parseToml(input) {
  if (typeof input !== 'string') throw new TomlError('not text');
  const src = input.replace(/\r\n/g, '\n');
  let pos = 0;
  const fail = message => {
    const line = src.slice(0, Math.min(pos, src.length)).split('\n').length;
    throw new TomlError('line ' + line + ': ' + message);
  };
  const skip = chars => { while (pos < src.length && chars.includes(src[pos])) pos++; };
  const skipComment = () => {
    if (src[pos] !== '#') return;
    let end = src.indexOf('\n', pos + 1);
    if (end < 0) end = src.length;
    if (ILLEGAL_ONE_LINE.test(src.slice(pos + 1, end))) fail('a character that is not allowed in a comment');
    pos = end;
  };
  const skipArraySpace = () => {
    for (;;) {
      const before = pos;
      skip(' \t\n'); skipComment();
      if (pos === before) return;
    }
  };

  const hexChar = length => {
    const hex = src.slice(pos, pos + length);
    if (hex.length !== length || !/^[0-9A-Fa-f]+$/.test(hex)) fail('invalid \\u value in a string');
    pos += length;
    const code = parseInt(hex, 16);
    if (!((code >= 0 && code <= 0xD7FF) || (code >= 0xE000 && code <= 0x10FFFF))) fail('\\u value is not a character');
    return String.fromCodePoint(code);
  };
  const escape = multiline => {
    const id = src.slice(pos, pos + 2);
    pos += 2;
    if (multiline && (id === '\\ ' || id === '\\\t' || id === '\\\n')) {
      if (id !== '\\\n') {
        skip(' \t');
        if (pos >= src.length) return '';
        if (src[pos] !== '\n') fail('a backslash that escapes nothing');
        pos++;
      }
      skip(' \t\n');
      return '';
    }
    if (id === '\\u') return hexChar(4);
    if (id === '\\U') return hexChar(8);
    if (!own(ESCAPES, id)) fail('a backslash that escapes nothing');
    return ESCAPES[id];
  };
  const basicString = multiline => {
    const illegal = multiline ? ILLEGAL_MULTI_LINE : ILLEGAL_ONE_LINE;
    let result = '', start = pos;
    for (;;) {
      if (pos >= src.length) fail('a string that is never closed');
      const char = src[pos];
      if (char === '"') {
        if (!multiline) { const text = result + src.slice(start, pos); pos += 1; return text; }
        if (src.startsWith('"""', pos)) { const text = result + src.slice(start, pos); pos += 3; return text; }
        pos++; continue;
      }
      if (char === '\\') {
        result += src.slice(start, pos);
        result += escape(multiline);
        start = pos; continue;
      }
      if (illegal.test(char)) fail('a character that is not allowed in a string');
      pos++;
    }
  };
  const literalString = () => {
    pos += 1;
    const end = src.indexOf("'", pos);
    if (end < 0) fail('a string that is never closed');
    const text = src.slice(pos, end);
    if (ILLEGAL_ONE_LINE.test(text)) fail('a character that is not allowed in a string');
    pos = end + 1;
    return text;
  };
  const multilineString = literal => {
    pos += 3;
    if (src[pos] === '\n') pos += 1;
    let result;
    const delim = literal ? "'" : '"';
    if (literal) {
      const end = src.indexOf("'''", pos);
      if (end < 0) fail('a string that is never closed');
      result = src.slice(pos, end);
      if (ILLEGAL_MULTI_LINE.test(result)) fail('a character that is not allowed in a string');
      pos = end + 3;
    } else result = basicString(true);
    // The closing run may be four or five quotes long: the extra ones belong to the text.
    if (src[pos] !== delim) return result;
    pos += 1;
    if (src[pos] !== delim) return result + delim;
    pos += 1;
    return result + delim + delim;
  };

  const keyPart = () => {
    const char = src[pos];
    if (char !== undefined && RE_BARE.test(char)) {
      const start = pos;
      while (pos < src.length && RE_BARE.test(src[pos])) pos++;
      return src.slice(start, pos);
    }
    if (char === "'") return literalString();
    if (char === '"') { pos += 1; return basicString(false); }
    return fail('a name was expected here');
  };
  const parseKey = () => {
    const key = [keyPart()];
    skip(' \t');
    while (src[pos] === '.') {
      pos += 1; skip(' \t');
      key.push(keyPart());
      skip(' \t');
    }
    return key;
  };
  const keyValue = () => {
    const key = parseKey();
    if (src[pos] !== '=') fail("'=' was expected after a name");
    pos += 1; skip(' \t');
    return [key, parseValue()];
  };

  const validDate = match => {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (year < 1) return false;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  };
  const parseArray = () => {
    pos += 1;
    const array = [];
    skipArraySpace();
    if (src[pos] === ']') { pos += 1; return array; }
    for (;;) {
      array.push(parseValue());
      skipArraySpace();
      const c = src[pos];
      if (c === ']') { pos += 1; return array; }
      if (c !== ',') fail('a list that is never closed');
      pos += 1;
      skipArraySpace();
      if (src[pos] === ']') { pos += 1; return array; }
    }
  };
  const parseInlineTable = () => {
    pos += 1;
    const table = newTable(), flags = new TomlFlags();
    skip(' \t');
    if (src[pos] === '}') { pos += 1; return table; }
    for (;;) {
      const [key, value] = keyValue();
      const stem = key[key.length - 1];
      if (flags.is(key, FROZEN)) fail('a value is set twice');
      let nest;
      try { nest = tomlNest(table, key.slice(0, -1), false); }
      catch (error) { if (error !== NO_NEST) throw error; fail('a value is set twice'); }
      if (stem in nest) fail('a value is set twice');
      nest[stem] = value;
      skip(' \t');
      const c = src[pos];
      if (c === '}') { pos += 1; return table; }
      if (c !== ',') fail('a {...} table that is not closed on its own line');
      if (isTable(value) || Array.isArray(value)) flags.set(key, FROZEN, true);
      pos += 1; skip(' \t');
    }
  };
  function parseValue() {
    const char = src[pos];
    if (char === '"') {
      if (src.startsWith('"""', pos)) return multilineString(false);
      pos += 1; return basicString(false);
    }
    if (char === "'") {
      if (src.startsWith("'''", pos)) return multilineString(true);
      return literalString();
    }
    if (char === 't' && src.startsWith('true', pos)) { pos += 4; return true; }
    if (char === 'f' && src.startsWith('false', pos)) { pos += 5; return false; }
    if (char === '[') return parseArray();
    if (char === '{') return parseInlineTable();
    RE_DATETIME.lastIndex = pos;
    const date = RE_DATETIME.exec(src);
    if (date) {
      if (!validDate(date)) fail('a date that does not exist');
      pos += date[0].length;
      return new TomlDate(date[0]);
    }
    RE_LOCALTIME.lastIndex = pos;
    const time = RE_LOCALTIME.exec(src);
    if (time) { pos += time[0].length; return new TomlDate(time[0]); }
    RE_NUMBER.lastIndex = pos;
    const number = RE_NUMBER.exec(src);
    if (number) {
      pos += number[0].length;
      const text = number[0].replace(/_/g, '');
      if (number[1]) return Number(text);
      const whole = BigInt(text);
      return whole >= BigInt(Number.MIN_SAFE_INTEGER) && whole <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(whole) : whole;
    }
    const three = src.slice(pos, pos + 3);
    if (three === 'inf') { pos += 3; return Infinity; }
    if (three === 'nan') { pos += 3; return NaN; }
    const four = src.slice(pos, pos + 4);
    if (four === '+inf') { pos += 4; return Infinity; }
    if (four === '-inf') { pos += 4; return -Infinity; }
    if (four === '+nan' || four === '-nan') { pos += 4; return NaN; }
    return fail('a value this reader does not know');
  }

  const root = newTable(), flags = new TomlFlags();
  let header = [];
  for (;;) {
    skip(' \t');
    const char = src[pos];
    if (char === '\n') { pos += 1; continue; }
    if (char !== undefined && (RE_BARE.test(char) || char === '"' || char === "'")) {
      const [key, value] = keyValue();
      const parent = header.concat(key.slice(0, -1)), stem = key[key.length - 1];
      for (let i = 1; i < key.length; i++) {
        const container = header.concat(key.slice(0, i));
        if (flags.is(container, EXPLICIT_NEST)) fail('a table is defined twice');
        flags.addPending(container, EXPLICIT_NEST);
      }
      if (flags.is(parent, FROZEN)) fail('a value is set twice');
      let nest;
      try { nest = tomlNest(root, parent); }
      catch (error) { if (error !== NO_NEST) throw error; fail('a value is set twice'); }
      if (stem in nest) fail('a value is set twice');
      if (isTable(value) || Array.isArray(value)) flags.set(header.concat(key), FROZEN, true);
      nest[stem] = value;
      skip(' \t');
    } else if (char === '[') {
      flags.finalizePending();
      const list = src[pos + 1] === '[';
      pos += list ? 2 : 1;
      skip(' \t');
      const key = parseKey();
      if (list) {
        if (flags.is(key, FROZEN)) fail('a value is set twice');
        flags.unsetAll(key);
        flags.set(key, EXPLICIT_NEST, false);
        try {
          const cont = tomlNest(root, key.slice(0, -1)), last = key[key.length - 1];
          if (last in cont) {
            if (!Array.isArray(cont[last])) throw NO_NEST;
            cont[last].push(newTable());
          } else cont[last] = [newTable()];
        } catch (error) { if (error !== NO_NEST) throw error; fail('a value is set twice'); }
        if (!src.startsWith(']]', pos)) fail("']]' was expected");
        pos += 2;
      } else {
        if (flags.is(key, EXPLICIT_NEST) || flags.is(key, FROZEN)) fail('a table is defined twice');
        flags.set(key, EXPLICIT_NEST, false);
        try { tomlNest(root, key); }
        catch (error) { if (error !== NO_NEST) throw error; fail('a value is set twice'); }
        if (src[pos] !== ']') fail("']' was expected");
        pos += 1;
      }
      header = key;
      skip(' \t');
    } else if (char !== undefined && char !== '#') fail('a line this reader does not understand');
    skipComment();
    if (pos >= src.length) break;
    if (src[pos] !== '\n') fail('something extra at the end of the line');
    pos += 1;
  }
  return root;
}

/** Are two parsed values the same, whatever the order of their names? */
export function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== 'object') return false;
  if (a instanceof TomlDate || b instanceof TomlDate) {
    return a instanceof TomlDate && b instanceof TomlDate && a.text === b.text;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((value, i) => same(value, b[i]));
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every(name => own(b, name) && same(a[name], b[name]));
}

/** Read one app's TOML settings, or stop with a plain message and leave the file alone. */
function readToml(text, name) {
  try { return parseToml(text); }
  catch (error) {
    if (!(error instanceof TomlError)) throw error;
    throw new Stop('could not read ' + name + ' with certainty (' + error.message + '), so nothing in it was changed');
  }
}

// ---- checking the download and this computer ----------------------------------------------

/** The full path of an app's command, or null. Stable links and launchers are kept as they are. */
export function executable(name) {
  return resolveBin(name);
}

function nodeVersion(node) {
  try {
    return execFileSync(node, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
  } catch { return null; }
}
const major = version => Number(String(version || '').replace(/^v/, '').split('.')[0]) || 0;

/** The node that the apps will use to run Frenemy: NODE_BIN, else node on PATH, else this one. */
export function preflight() {
  const need = 'Node.js ' + NODE_NEEDED + ' or newer is required';
  const get = ' Get it from https://nodejs.org and run this again.';
  if (major(process.versions.node) < NODE_NEEDED) {
    throw new Stop(need + '. This computer has ' + process.versions.node + '.' + get);
  }
  if (process.env.NODE_BIN) {
    const chosen = executable('node');
    const version = chosen && nodeVersion(chosen);
    if (!version) throw new Stop('NODE_BIN does not point at a working node: ' + process.env.NODE_BIN);
    if (major(version) < NODE_NEEDED) throw new Stop(need + '. NODE_BIN points at ' + version + '.' + get);
    return chosen;
  }
  const onPath = executable('node');
  if (onPath && !/\.(cmd|bat)$/i.test(onPath) && major(nodeVersion(onPath)) >= NODE_NEEDED) return onPath;
  return process.execPath;
}

/** Every file, folder and link in the release, except a git checkout's own folder. */
function listRelease(root) {
  const found = [];
  const walk = (dir, parts) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === '.git') continue;
      const full = path.join(dir, item.name), here = parts.concat(item.name);
      const link = item.isSymbolicLink();
      found.push({ name: here.join('/'), parts: here, full, link, file: !link && item.isFile() });
      if (!link && item.isDirectory()) walk(full, here);
    }
  };
  walk(root, []);
  return found;
}

function readManifest(root) {
  let text;
  try { text = fs.readFileSync(path.join(root, 'MANIFEST.json'), 'utf8'); }
  catch {
    throw new Stop('MANIFEST.json is missing from ' + root + '. Run the installer from inside the unpacked ' +
      'Frenemy folder, or download Frenemy again.');
  }
  let files;
  try { files = JSON.parse(text).files; } catch { files = null; }
  if (!isObj(files)) throw new Stop('MANIFEST.json cannot be read. Download Frenemy again and unpack it into a new, empty folder.');
  return files;
}

const AGAIN = ' Download Frenemy again and unpack it into a new, empty folder.';

/** Compare this download with MANIFEST.json, file by file. */
export function verify(root = ROOT) {
  const manifest = readManifest(root);
  const listed = listRelease(root);
  if (listed.some(item => item.link)) throw new Stop('Release must not contain symlinks.' + AGAIN);
  const actual = new Map();
  for (const item of listed) {
    if (item.file && !item.parts.includes('__pycache__') && item.parts[item.parts.length - 1] !== 'MANIFEST.json' &&
        item.parts[item.parts.length - 1] !== '.DS_Store') actual.set(item.name, item.full);
  }
  const extra = [...actual.keys()].filter(name => !own(manifest, name));
  const missing = Object.keys(manifest).filter(name => !actual.has(name));
  if (extra.length || missing.length) {
    const some = (label, names) => names.length ? ' ' + label + ': ' + names.slice(0, 3).join(', ') +
      (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '') + '.' : '';
    throw new Stop('Release file list differs from MANIFEST.json.' + some('Not expected', extra) + some('Missing', missing) + AGAIN);
  }
  for (const [name, digest] of Object.entries(manifest)) {
    if (sha256(fs.readFileSync(actual.get(name))) !== digest) throw new Stop('Release integrity check failed: ' + name + '.' + AGAIN);
  }
}

// ---- changing settings files ---------------------------------------------------------------

/** Keep a copy of a settings file as it was, once per run. `done` maps the file to its copy. */
export function backup(file, done) {
  if (fs.existsSync(file) && !done.has(file)) {
    let copy = file + '.before-frenemy-' + STAMP, extra = 1;
    while (lexists(copy)) {        // never write over an earlier backup
      extra += 1; copy = file + '.before-frenemy-' + STAMP + '-' + extra;
    }
    copy2(file, copy); done.set(file, copy);
  }
}

function realTarget(file) {
  try { return fs.realpathSync(file); }
  catch { return path.resolve(path.dirname(file), fs.readlinkSync(file)); }
}

/** Write text only if it parses; put the backup back if the written file does not. */
export function replaceChecked(file, text, parse, done) {
  parse(text);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  backup(file, done);
  const shown = file;
  if (isSymlink(file)) file = realTarget(file);     // settings kept through a link: change the real file, keep the link
  const part = file + '.frenemy-part';
  fs.writeFileSync(part, text);
  if (!WIN && fs.existsSync(file)) fs.chmodSync(part, fs.statSync(file).mode & 0o7777);   // a private settings file stays private
  rename(part, file);
  try { parse(readText(file)); }
  catch {
    if (done.has(shown)) copy2(done.get(shown), file);
    throw new Stop('could not write a valid ' + path.basename(shown) + '; it was put back as it was');
  }
}

// A whole number too large for JavaScript would be rounded when the file is written again.
function refuseLargeNumbers(text, name) {
  const bare = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const literal of bare.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || []) {
    if (/^-?\d+$/.test(literal) && !Number.isSafeInteger(Number(literal))) {
      throw new Stop(name + ' holds a number too large to copy exactly (' + literal + '), so the file was left alone');
    }
  }
}

/** `rewrite` is false for a file that is only looked at, never written again by this installer. */
export function readJson(file, rewrite = true) {
  if (!fs.existsSync(file)) return {};
  const name = path.basename(file);
  const text = readText(file) || '{}';
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Stop(name + ' is not valid JSON, so it was left alone'); }
  if (!isObj(data)) throw new Stop(name + ' is not a JSON object');
  if (rewrite) refuseLargeNumbers(text, name);
  return data;
}

export function mergeJsonServers(file, servers, done, notes) {
  const data = readJson(file), name = path.basename(file);
  if (!own(data, 'mcpServers')) data.mcpServers = {};
  const table = data.mcpServers;
  if (!isObj(table)) throw new Stop('mcpServers in ' + name + ' is not in the expected shape');
  let changed = false;
  for (const [seat, server] of Object.entries(servers)) {
    if (own(table, seat) && !isFrenemy(table[seat])) {
      notes.push('left your own "' + seat + '" entry in ' + name + ' untouched'); continue;
    }
    if (!own(table, seat) || !same(table[seat], server)) { table[seat] = server; changed = true; }
  }
  if (changed) replaceChecked(file, jsonText(data), JSON.parse, done);
}

function commandsIn(value, found = []) {
  if (Array.isArray(value)) for (const child of value) commandsIn(child, found);
  else if (isObj(value)) {
    if (typeof value.command === 'string') found.push(value.command);
    for (const child of Object.values(value)) commandsIn(child, found);
  }
  return found;
}

/** Drop reporters of an earlier Frenemy; keep every hook that is the person's own. */
function withoutStale(groups, ours) {
  const stale = entry => isObj(entry) && typeof entry.command === 'string' && isReporter(entry.command) && !ours.has(entry.command);
  const kept = [];
  for (const group of groups) {
    if (stale(group)) continue;
    if (isObj(group) && Array.isArray(group.hooks) && group.hooks.some(stale)) {
      const rest = group.hooks.filter(hook => !stale(hook));
      if (rest.length) kept.push({ ...group, hooks: rest });
      continue;
    }
    kept.push(group);
  }
  return kept;
}

export function mergeJsonHooks(file, hooks, done, key = 'hooks') {
  const data = readJson(file);
  if (key === 'snitch') {                      // agy keeps each tool's hooks under its own name
    if (own(data, 'snitch') && same(data.snitch, hooks)) return;
    data.snitch = hooks;
  } else {
    if (!own(data, 'hooks')) data.hooks = {};
    const table = data.hooks;
    if (!isObj(table) || !Object.values(table).every(Array.isArray)) {
      throw new Stop('hooks in ' + path.basename(file) + ' are not in the expected shape');
    }
    let changed = false;
    const ours = new Set(commandsIn(Object.values(hooks)));
    // A reporter left by an earlier Frenemy (its shell reporters, or one in another folder)
    // would report everything twice. Only those reporters are taken out; a hook of the
    // person's own sitting in the same group stays.
    for (const event of Object.keys(table)) {
      const kept = withoutStale(table[event], ours);
      if (!same(kept, table[event])) { table[event] = kept; changed = true; }
    }
    for (const [event, groups] of Object.entries(hooks)) {
      const wanted = commandsIn(groups)[0];
      if (own(table, event) && commandsIn(table[event]).includes(wanted)) continue;
      if (!own(table, event)) table[event] = [];
      table[event].push(...groups); changed = true;
    }
    if (!changed) return;
  }
  replaceChecked(file, jsonText(data), JSON.parse, done);
}

const splitLines = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];

export function mergeKimiHooks(file, prefix, done, where) {
  const name = path.basename(file);
  const text = fs.existsSync(file) ? readText(file) : '';
  const original = readToml(text, name);
  const hooksOf = table => ('hooks' in table ? table.hooks : []);
  if (!Array.isArray(hooksOf(original)) || !hooksOf(original).every(isTable)) {
    throw new Stop('hooks in ' + name + ' are not in the expected shape');
  }
  const ours = new Set(EVENTS.kimi.map(([, word]) => hookCommand('kimi', prefix, word, where)));
  const stale = command => typeof command === 'string' && isReporter(command) && !ours.has(command);
  // Take out [[hooks]] blocks that are reporters of an earlier Frenemy.
  let lines = splitLines(text);
  const kept = [];
  let block = null;
  if ('hooks' in original && original.hooks.length === 0) {
    let top = lines.findIndex(line => line.trimStart().startsWith('['));
    if (top < 0) top = lines.length;
    lines = lines.filter((line, i) => !(i < top && /^\s*hooks\s*=\s*\[\s*\]\s*(#[^\n]*)?\n?$/.test(line)));
  }
  const close = lines_ => {
    let entry = {};
    try {
      const list = parseToml(lines_.join('')).hooks;
      if (Array.isArray(list) && list.length && isTable(list[0])) entry = list[0];
    } catch (error) { if (!(error instanceof TomlError)) throw error; }
    if (!stale('command' in entry ? entry.command : '')) kept.push(...lines_);
  };
  for (const line of lines) {
    if (line.trimStart().startsWith('[')) {
      if (block !== null) close(block);
      block = line.trim() === '[[hooks]]' ? [line] : null;
      if (block === null) kept.push(line);
    } else if (block !== null) block.push(line);
    else kept.push(line);
  }
  if (block !== null) close(block);
  const stripped = kept.join('');
  const unsafe = new Stop('could not safely tidy the old reporters in ' + name + ', so nothing in it was changed');
  let before;
  try { before = parseToml(stripped); }
  catch (error) { if (!(error instanceof TomlError)) throw error; throw unsafe; }
  const expected = Object.assign(newTable(), original);
  expected.hooks = hooksOf(original).filter(hook => !stale(hook.command));
  if (!expected.hooks.length) delete expected.hooks;
  if (!same(before, expected)) throw unsafe;
  const pair = (event, command) => event + '\u0000' + command;
  const have = new Set(hooksOf(before).filter(hook => isTable(hook) && typeof hook.event === 'string' && typeof hook.command === 'string')
    .map(hook => pair(hook.event, hook.command)));
  const missing = EVENTS.kimi.filter(([event, word]) => !have.has(pair(event, hookCommand('kimi', prefix, word, where))))
    .map(([event]) => event);
  if (!missing.length && same(before, original)) return;
  const added = stripped + (!stripped || stripped.endsWith('\n') ? '' : '\n') + (stripped ? '\n' : '') +
    kimiHookText(prefix, missing, where);
  const parse = candidate => {
    let after;
    try { after = parseToml(candidate); }
    catch (error) {
      if (!(error instanceof TomlError)) throw error;
      throw new Stop('the reporters could not be added to ' + name + ' with certainty, so nothing in it was changed');
    }
    const rest = Object.assign(newTable(), after);
    rest.hooks = hooksOf(after).slice(0, hooksOf(before).length);
    if (!rest.hooks.length) delete rest.hooks;
    if (!same(rest, before)) throw new Stop('existing Kimi settings would have changed');
  };
  replaceChecked(file, added, parse, done);
}

/** Run an app's own command and wait for it. Rejects with a plain message when it says no. */
export function runCli(binary, args, onChild) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnCli(binary, args, { stdio: ['inherit', 'pipe', 'pipe'] }); }
    catch (error) { reject(error); return; }
    if (onChild) onChild(child);
    let out = '', err = '', late = false;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { if (out.length < 4096) out += chunk; });
    child.stderr.on('data', chunk => { if (err.length < 4096) err += chunk; });
    const timer = setTimeout(() => { late = true; stopProcessTreeSync(child.pid, 1000); }, 60000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (late) reject(new Stop("the app's own command did not answer within 60 seconds"));
      else if (code !== 0) reject(new Stop((err || out).trim().slice(0, 300) || 'exit ' + code));
      else resolve();
    });
  });
}

/** Where each app keeps its settings, honouring the apps' own folder overrides. */
export function settingsFiles(home) {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR;
  const codexDir = process.env.CODEX_HOME || path.join(home, '.codex');
  return {
    claude: [claudeDir ? path.join(claudeDir, '.claude.json') : path.join(home, '.claude.json'),
      path.join(claudeDir || path.join(home, '.claude'), 'settings.json')],
    codex: [path.join(codexDir, 'config.toml'), path.join(codexDir, 'hooks.json')],
    agy: [path.join(home, '.gemini', 'config', 'mcp_config.json'), path.join(home, '.gemini', 'config', 'hooks.json')],
    kimi: [path.join(home, '.kimi-code', 'mcp.json'), path.join(home, '.kimi-code', 'config.toml')],
  };
}

/**
 * Restore every file of one app. `was` maps each file to {bytes, mode}, or to null when the
 * file was not there. Returns the names that could NOT be restored.
 */
export function putBack(was) {
  const failed = [];
  for (const [file, old] of was) {
    try {
      if (old === null) {
        if (isFile(file)) fs.unlinkSync(file);
      } else {
        if (!isFile(file) || !fs.readFileSync(file).equals(old.bytes)) fs.writeFileSync(file, old.bytes);
        if (!WIN) fs.chmodSync(file, old.mode & 0o7777);
      }
    } catch { failed.push(path.basename(file)); }
  }
  return failed;
}

/**
 * Give every installed app the other installed apps as tools, plus its Snitch reporter.
 * `options`: node (the node the reporters run with), run (stands in for runCli in tests).
 * Returns {report: [[seat, ok, note]], done: Map(file -> backup copy)}.
 */
export async function connect(prefix, bins, home, options = {}) {
  const where = { node: options.node || process.execPath, platform: options.platform };
  const run = options.run || runCli;
  const done = new Map(), report = [];
  const present = SEATS.filter(seat => bins[seat]);
  const files = settingsFiles(home);
  // Ctrl-C while an app's own command runs: stop waiting, stop that command, and let the
  // code below put the app back as it was.
  const waiting = { hit: false, current: null };
  const onSignal = () => {
    waiting.hit = true;
    const current = waiting.current;
    if (!current) return;
    if (current.child) { try { stopProcessTreeSync(current.child.pid, 500); } catch { /* already gone */ } }
    current.reject(new Interrupted());
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, onSignal);
  const call = (binary, ...args) => new Promise((resolve, reject) => {
    if (waiting.hit) { reject(new Interrupted()); return; }
    const current = { reject, child: null };
    waiting.current = current;
    Promise.resolve().then(() => run(binary, args, child => { current.child = child; }))
      .then(resolve, reject).finally(() => { if (waiting.current === current) waiting.current = null; });
  });
  try {
    for (const driver of present) {
      const notes = [];
      let was = null;
      try {
        if (waiting.hit) throw new Interrupted();
        // How this app's files were before, so a failure half-way puts every one of them
        // back: an app is either connected or left as it was.
        was = new Map(files[driver].map(file =>
          [file, isFile(file) ? { bytes: fs.readFileSync(file), mode: fs.statSync(file).mode } : null]));
        const all = JSON.parse(fs.readFileSync(path.join(prefix, 'config', driver + '-mcp.json'), 'utf8')).mcpServers;
        const servers = Object.fromEntries(Object.entries(all).filter(([name]) => present.includes(name)));
        const hooks = hookEntries(driver, prefix, where);
        if (driver === 'claude' || driver === 'codex') {
          const [state, hookFile] = files[driver];
          const stateName = path.basename(state);
          const listed = () => {
            if (!fs.existsSync(state)) return {};
            const data = driver === 'claude' ? readJson(state, false) : readToml(readText(state), stateName);
            const key = driver === 'claude' ? 'mcpServers' : 'mcp_servers';
            const table = own(data, key) ? data[key] : {};
            if (!isTable(table)) throw new Stop('the server list in ' + stateName + ' is not in the expected shape');
            return table;
          };
          const existing = listed();
          mergeJsonHooks(hookFile, hooks, done);      // checked first: nothing is changed if this file is unusable
          backup(state, done);
          const wanted = {};
          for (const [name, server] of Object.entries(servers)) {
            const had = own(existing, name);
            if (had && !isFrenemy(existing[name])) {
              notes.push('left your own "' + name + '" entry untouched'); continue;
            }
            wanted[name] = server;
            if (driver === 'claude') {
              if (had) await call(bins.claude, 'mcp', 'remove', '-s', 'user', name);
              await call(bins.claude, 'mcp', 'add-json', '-s', 'user', name, JSON.stringify({ ...server, type: 'stdio' }));
            } else {
              if (had) await call(bins.codex, 'mcp', 'remove', name);
              const env = Object.entries(server.env).flatMap(([key, value]) => ['--env', key + '=' + value]);
              await call(bins.codex, 'mcp', 'add', name, ...env, '--', server.command, ...server.args);
            }
          }
          // The app's own command said yes. Read its settings back and see the entries there.
          const after = listed();
          for (const [name, server] of Object.entries(wanted)) {
            const entry = own(after, name) ? after[name] : null;
            if (!isTable(entry) || !same(entry.args, server.args) || entry.command !== server.command ||
                (isTable(entry.env) ? entry.env.FRENEMY_DRIVER : undefined) !== driver) {
              throw new Stop(NAMES[driver] + ' accepted the connection to ' + name + ' but it is not in ' + stateName);
            }
          }
        } else if (driver === 'agy') {
          mergeJsonHooks(files.agy[1], hooks, done, 'snitch');
          mergeJsonServers(files.agy[0], servers, done, notes);
        } else {
          mergeKimiHooks(files.kimi[1], prefix, done, where);
          mergeJsonServers(files.kimi[0], servers, done, notes);
        }
        report.push([driver, true, notes.join('; ')]);
      } catch (error) {       // anything at all, Ctrl-C included: this app goes back to how it was
        const failed = was !== null ? putBack(was) : [];
        const outcome = was === null ? 'nothing of it was changed'
          : !failed.length ? 'its settings were put back as they were'
            : 'COULD NOT put back ' + failed.join(', ') + ': restore the .before-frenemy copy by hand';
        if (error instanceof Interrupted) {
          console.error('Stopped while connecting ' + NAMES[driver] + '; ' + outcome);
          for (const [original, copy] of done) console.error('Backup of', original, '->', copy);
          throw error;
        }
        const plain = error instanceof Stop;
        const text = String(error && error.message !== undefined ? error.message : error).slice(0, 300);
        report.push([driver, false, (plain ? '' : ((error && (error.code || error.name)) || 'Error') + ': ') + text + ' (' + outcome + ')']);
      }
    }
  } finally {
    for (const signal of signals) process.removeListener(signal, onSignal);
  }
  return { report, done };
}

/** An earlier run of this same release: every release file is there, unchanged. */
export function sameRelease(prefix, root = ROOT) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'MANIFEST.json'), 'utf8')).files;
    return Object.entries(manifest).every(([name, digest]) => sha256(fs.readFileSync(path.join(prefix, ...name.split('/')))) === digest);
  } catch { return false; }
}

function otherSnitch(extensions, ext) {
  let names = [];
  try { names = fs.readdirSync(extensions); } catch { return null; }
  for (const name of names) {
    const folder = path.join(extensions, name);
    try {
      const data = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
      if (path.resolve(folder) !== path.resolve(ext) && isObj(data) && data.name === 'snitch') return folder;
    } catch { /* not an extension, or not readable */ }
  }
  return null;
}

/** Write the entries for every app into <staging>/config, pointing at `prefix`. Returns the apps found. */
export function generate(staging, node, prefix = staging) {
  const out = path.join(staging, 'config');
  fs.mkdirSync(out);
  const where = { node };
  const bins = Object.fromEntries(SEATS.map(seat => [seat, executable(seat)]));
  const env = { PATH: process.env.PATH || process.env.Path || (WIN ? '' : '/usr/bin:/bin'), NODE_BIN: node };
  for (const seat of SEATS) if (bins[seat]) env[seat.toUpperCase() + '_BIN'] = bins[seat];
  for (const driver of SEATS) {
    const servers = {};
    for (const seat of SEATS) {
      if (seat === driver) continue;
      servers[seat] = { command: node, args: [path.join(prefix, 'tools', 'ask-' + seat + '-mcp.mjs')], env: { ...env, FRENEMY_DRIVER: driver } };
    }
    fs.writeFileSync(path.join(out, driver + '-mcp.json'), jsonText({ mcpServers: servers }));
    if (driver === 'codex') {
      let text = '';
      for (const [seat, server] of Object.entries(servers)) {
        text += '[mcp_servers.' + seat + ']\ncommand = ' + JSON.stringify(node) + '\nargs = [' + server.args.map(arg => JSON.stringify(arg)).join(', ') + ']\n';
        text += '[mcp_servers.' + seat + '.env]\n';
        text += Object.entries(server.env).map(([key, value]) => key + ' = ' + JSON.stringify(value) + '\n').join('') + '\n';
      }
      fs.writeFileSync(path.join(out, 'codex-mcp.toml'), text);
    }
    const hooks = hookEntries(driver, prefix, where);
    fs.writeFileSync(path.join(out, driver + '-hooks.json'), jsonText(driver === 'agy' ? { snitch: hooks } : { hooks }));
    if (driver === 'kimi') fs.writeFileSync(path.join(out, 'kimi-hooks.toml'), kimiHookText(prefix, null, where));
  }
  fs.writeFileSync(path.join(out, 'dependencies.json'), jsonText({ node, cli_paths: bins }));
  return bins;
}

function installExtension(source, ext) {
  fs.mkdirSync(path.dirname(ext), { recursive: true });
  // Keep incomplete packages below a container without package.json,
  // so VS Code cannot discover them as installed extensions.
  const parent = path.join(path.dirname(ext), '.frenemy-staging');
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, path.basename(ext) + '-'));
  copyTree(source, staging);
  if (lexists(ext)) throw new Stop('Extension destination appeared during install; retained unchanged: ' + ext);
  rename(staging, ext);
}

// ---- the command itself -------------------------------------------------------------------

const HELP = `Frenemy installer. Run it with:  node install.mjs [options]

Install into a new directory, then connect the installed AI apps to each other.
Every settings file is backed up before it is changed, only Frenemy's own entries are
added or refreshed, and each result is read again before it is kept.

Options:
  --check                 Check this download and Node.js; change nothing
  --no-connect            Install and write the settings to config/ only; change no app settings
  --no-snitch             Do not install the Snitch panel
  --prefix FOLDER         Where to install (default: .local/share/frenemy/2.0.0 in your home folder)
  --extension-dir FOLDER  Where to put the Snitch panel (default: VS Code's extensions folder, when it exists)
  -h, --help              Show this help
`;

class Usage extends Stop {}

function parseArgs(argv) {
  const args = { prefix: null, extensionDir: null, check: false, noSnitch: false, noConnect: false, help: false };
  const flags = { '--check': 'check', '--no-snitch': 'noSnitch', '--no-connect': 'noConnect', '--help': 'help', '-h': 'help' };
  const values = { '--prefix': 'prefix', '--extension-dir': 'extensionDir' };
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    const eq = word.startsWith('--') ? word.indexOf('=') : -1;
    const name = eq > 0 ? word.slice(0, eq) : word;
    if (own(flags, name) && eq < 0) args[flags[name]] = true;
    else if (own(values, name)) {
      const value = eq > 0 ? word.slice(eq + 1) : argv[++i];
      if (value === undefined || value === '') throw new Usage(name + ' needs a folder after it.');
      args[values[name]] = value;
    } else throw new Usage('Unknown option: ' + word);
  }
  return args;
}

function expandUser(value, home) {
  if (value === '~') return home;
  if (value.startsWith('~/') || (WIN && value.startsWith('~\\'))) return path.join(home, value.slice(2));
  return value;
}

/** Do the installation. `overrides.generate` stands in for generate() in tests. Returns the exit code. */
export async function main(argv = process.argv.slice(2), overrides = {}) {
  const makeConfig = overrides.generate || generate;
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(HELP); return 0; }
  verify();
  const node = preflight();
  if (args.check) {
    console.log('This download is intact and this computer has what Frenemy needs: Node.js ' + NODE_NEEDED +
      ' or newer (found ' + (nodeVersion(node) || 'v' + process.versions.node) + '). ' +
      'Sign-ins are checked by each app itself.');
    return 0;
  }
  const home = homeDir();
  const prefix = path.resolve(expandUser(args.prefix || path.join(home, '.local', 'share', 'frenemy', '2.0.0'), home));
  if (inside(prefix, ROOT)) throw new Stop('Install outside the unpacked release directory.');
  checkFolderForShells(prefix);
  const reuse = isDir(prefix) && !isSymlink(prefix) && sameRelease(prefix);
  if (lexists(prefix) && !reuse) {
    throw new Stop('Destination exists and is not this release; choose a new directory: ' + prefix);
  }
  let ext = null, snitch = '';
  if (!args.noSnitch) {
    const vscode = path.join(home, '.vscode', 'extensions'), remote = path.join(home, '.vscode-server', 'extensions');
    if (args.extensionDir) ext = path.resolve(expandUser(args.extensionDir, home));
    else if (isDir(vscode)) ext = path.join(vscode, 'local.snitch-0.1.1');
    // VS Code reaching into another machine keeps its extensions here instead.
    else if (isDir(remote)) ext = path.join(remote, 'local.snitch-0.1.1');
    else snitch = 'VS Code was not found, so the Snitch panel was not installed.';
  }
  if (ext && (inside(ext, prefix) || inside(prefix, ext))) throw new Stop('Extension and runtime destinations must be separate.');
  if (ext) {
    const other = isDir(path.dirname(ext)) ? otherSnitch(path.dirname(ext), ext) : null;
    if (lexists(ext)) { snitch = 'Snitch is already at ' + ext + '; left as it is.'; ext = null; }
    else if (other) { snitch = 'Another Snitch is already installed at ' + other + '; left as it is.'; ext = null; }
  }
  let bins;
  if (reuse) {
    // Same release, run again: nothing is copied over it. Only the settings are refreshed,
    // so an app installed since the first run gets connected too.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'frenemy-config-'));
    bins = makeConfig(fresh, node, prefix);
    fs.mkdirSync(path.join(prefix, 'config'), { recursive: true });
    for (const item of fs.readdirSync(path.join(fresh, 'config'))) {
      copy2(path.join(fresh, 'config', item), path.join(prefix, 'config', item));
    }
    console.log('Already installed:', prefix);
  } else {
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    const staging = fs.mkdtempSync(path.join(path.dirname(prefix), path.basename(prefix) + '.staging-'));
    try {
      copyTree(ROOT, staging);
      bins = makeConfig(staging, node, prefix);
      if (lexists(prefix)) throw new Stop('Destination appeared during install; retained unchanged.');
      rename(staging, prefix);
    } catch (error) {
      console.error('Incomplete staging retained for inspection:', staging);
      throw error;
    }
    console.log('Installed:', prefix);
  }
  if (ext) {
    installExtension(path.join(prefix, 'snitch', 'extension'), ext);
    snitch = 'Snitch panel installed at ' + ext + '. Reload VS Code to see it.';
  }
  if (snitch) console.log(snitch);
  const missing = SEATS.filter(seat => !bins[seat]).map(seat => NAMES[seat]);
  const config = path.join(prefix, 'config');
  if (args.noConnect) {
    console.log('No app settings were changed. The entries to add are in', config, '(see INSTALL.md).');
    if (missing.length) console.log('Not found on this computer:', missing.join(', '));
    return 0;
  }
  const { report, done } = await connect(prefix, bins, home, { node });
  const good = report.filter(([, ok]) => ok).map(([seat]) => NAMES[seat]);
  if (good.length < 2) console.log('Frenemy needs at least two of the four AI apps. Found:', good.join(', ') || 'none');
  else console.log('Connected to each other:', good.join(', '));
  for (const [seat, ok, note] of report) {
    if (!ok) console.log('Could not connect ' + NAMES[seat] + ':', note, '- its entries are in', config);
    else if (note) console.log(NAMES[seat] + ':', note);
  }
  if (missing.length) console.log('Not found on this computer (skipped):', missing.join(', '));
  for (const [original, copy] of done) console.log('Backup of', original, '->', path.basename(copy));
  console.log('Restart the AI apps you have open. Each app still needs its own sign-in.');
  return report.every(([, ok]) => ok) ? 0 : 1;
}

function startedDirectly() {
  if (!process.argv[1]) return false;
  // "node -e <code> install.mjs" only names this file as an argument; that is not a request to install.
  if (process.execArgv.some(word => ['-e', '--eval', '-p', '--print'].includes(word))) return false;
  try {
    const started = fs.realpathSync(process.argv[1]), here = fs.realpathSync(fileURLToPath(import.meta.url));
    return WIN ? started.toLowerCase() === here.toLowerCase() : started === here;
  } catch { return false; }
}

if (startedDirectly()) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof Interrupted) process.exit(130);
    if (error instanceof Usage) {
      console.error(error.message + ' Run "node install.mjs --help" to see the options.');
      process.exit(2);
    }
    console.error('Installation stopped:', error && error.message !== undefined ? error.message : error);
    process.exit(1);
  }
}
