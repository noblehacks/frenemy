#!/usr/bin/env node
// worker-workspace.mjs: transactional prepare/apply command for non-git projects.
//
// A worker agent never edits the project directly. It prepares a job (exclusive
// per-file ownership + a full staging copy of the tree + baselines), edits copies
// in the staging workspace, and the driver later applies the workspace back under
// one project-wide lock with verification, backups, a journal, and rollback on
// ordinary failure.
//
// Model
// -----
// * prepare copies ALL project context (minus .attic/.git/node_modules/.worker-state
//   at any depth, and without following symlinks) into an isolated staging dir and
//   snapshots a staging baseline.
// * apply validates everything BEFORE any write or status flip:
//     - the whole STAGING tree vs the staging baseline: any change, addition or
//       deletion outside the job's owned files is an out-of-scope edit -> reject.
//     - only the owned ORIGINAL files vs their per-file baseline -> stale check.
//   This lets disjoint legitimate changes (other merged workers, the owner) land
//   in nonowned originals between prepare and apply without blocking the job,
//   while any out-of-scope edit the worker staged is caught.
// * A crash (a killed process) mid-apply leaves the job status "applying"; every
//   other prepare/apply is globally blocked until `recover --stopped` (or abandon
//   of a non-applying job) resolves it. Ordinary failure rolls back and releases.
//
// Node built-in modules only. The lock is the shared directory lock in
// snitch/extension/lib/joblock.js and it is ADVISORY. Same-user processes that
// ignore it can bypass every check (this is NOT an OS sandbox).
// See notes/WORKER-SAFEGUARDS.md.
//
// This is a line-for-line port of the earlier Python tool. The files it keeps under
// <root>/.worker-state have the same names and the same JSON shape, so a job made by
// the Python version can be inspected, applied, abandoned or recovered by this one.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WIN } from './platform.mjs';
import lock from '../snitch/extension/lib/joblock.js';

const STATE_DIR = '.worker-state';
const IGNORED_DIRS = new Set(['.attic', '.git', 'node_modules', '__pycache__', STATE_DIR]);
export const ABSENT = 'ABSENT';
const JOB_ID_RE = /^[0-9a-f]{12}$/;
// Statuses that hold per-file ownership against other prepares.
const ACTIVE_STATUSES = new Set(['prepared', 'applying', 'interrupted']);
const SEP = path.sep;
// One apply may copy many files, so the project lock is allowed a long hold, and a
// waiting command waits just as long before it gives up.
const LOCK_HOLD_MS = 15 * 60 * 1000;

export class GuardError extends Error {}

// ------------------------------------------------------------ small helpers --

function isLink(target) {
  try { return fs.lstatSync(target).isSymbolicLink(); } catch { return false; }
}

function isFile(target) {
  try { return fs.statSync(target).isFile(); } catch { return false; }
}

function isDir(target) {
  try { return fs.statSync(target).isDirectory(); } catch { return false; }
}

function exists(target) {
  try { fs.statSync(target); return true; } catch { return false; }
}

function mkdirs(target) {
  fs.mkdirSync(target, { recursive: true });
}

/** The real path of `target`; a part that does not exist yet is kept as written. */
function realpath(target) {
  const start = path.resolve(target);
  const tail = [];
  let current = start;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return start;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Do the two paths name the same file on disk (same volume, same file number)?
 * null when this volume gives its files no number, so the caller compares names instead.
 */
function sameFile(a, b) {
  const one = fs.statSync(a, { bigint: true });
  const two = fs.statSync(b, { bigint: true });
  if (one.ino === 0n || two.ino === 0n) return null;
  return one.dev === two.dev && one.ino === two.ino;
}

// Text order by Unicode code point, the order the Python version sorted in.
function compareText(a, b) {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 0xd800) x += x <= 0xdfff ? 0x2000 : -0x800;
    if (y >= 0xd800) y += y <= 0xdfff ? 0x2000 : -0x800;
    return x - y;
  }
  return a.length - b.length;
}

function sortedText(values) {
  return [...values].sort(compareText);
}

// Job records come from JSON, and file names are their keys, so every lookup goes
// through these helpers. A file called "constructor" or "__proto__" stays a plain key.
function has(record, key) {
  return record !== null && typeof record === 'object' && Object.prototype.hasOwnProperty.call(record, key);
}

/** The value, or null when the key is missing (a missing key and a stored null read the same). */
function get(record, key) {
  if (!has(record, key)) return null;
  const value = record[key];
  return value === undefined ? null : value;
}

/** The value of a field every job record must have. A damaged record stops the command. */
function need(record, key) {
  if (!has(record, key)) throw new Error('job record has no ' + pyRepr(key) + ' field');
  return record[key];
}

function keysOf(record) {
  return sortedText(Object.keys(record));
}

// A string written the way the Python version printed it inside messages.
function pyRepr(value) {
  if (value === null || value === undefined) return 'None';
  const text = String(value);
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += '\\x' + code.toString(16).padStart(2, '0');
    else out += ch;
  }
  return quote + out + quote;
}

function pyList(values) {
  return '[' + values.map(pyRepr).join(', ') + ']';
}

function errorText(error) {
  return error && error.message !== undefined ? String(error.message) : String(error);
}

// JSON in the exact layout the Python version wrote: keys in order, ASCII only,
// ", " and ": " between items on one line, or one item per line with an indent.
function pyJson(value, indent = null, depth = 0) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'string') {
    return JSON.stringify(value).replace(/[\u0080-￿]/g,
      ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  }
  const inner = indent === null ? '' : '\n' + ' '.repeat(indent * (depth + 1));
  const outer = indent === null ? '' : '\n' + ' '.repeat(indent * depth);
  const between = indent === null ? ', ' : ',' + inner;
  let open = '{';
  let close = '}';
  let items;
  if (Array.isArray(value)) {
    open = '['; close = ']';
    items = value.map(item => pyJson(item, indent, depth + 1));
  } else {
    const pairs = value instanceof Map ? [...value.entries()] : Object.keys(value).map(key => [key, value[key]]);
    pairs.sort((a, b) => compareText(String(a[0]), String(b[0])));
    items = pairs.map(([key, item]) => pyJson(String(key)) + ': ' + pyJson(item, indent, depth + 1));
  }
  return items.length ? open + inner + items.join(between) + outer + close : open + close;
}

/** Seconds since 1970 with a fraction, finer than a millisecond so two jobs never tie. */
function now() {
  return (performance.timeOrigin + performance.now()) / 1000;
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Rename over the target. Windows refuses while another program has the file open, so try again briefly there. */
function replaceFile(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (error) {
      if (!WIN || attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      lock.sleepSync(50);
    }
  }
}

// ---------------------------------------------------------- the project lock --

let heldLock = null;
let lastBeat = 0;

// The shared lock treats a lock held longer than its limit as abandoned. A long copy
// shows it is still alive by touching its lock every few seconds.
function beat() {
  if (!heldLock) return;
  const time = Date.now();
  if (time - lastBeat < 5000) return;
  lastBeat = time;
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(heldLock.path, 'owner.json'), 'utf8'));
    if (owner && owner.pid === process.pid) fs.utimesSync(heldLock.path, new Date(time), new Date(time));
  } catch { /* the lock is checked again when it is released */ }
}

/** Run `body` while holding the one lock for this project. Advisory, held for the whole command body. */
async function withGlobalLock(root, body) {
  ensureStateDirs(root);
  ensureStateTreeClean(root);
  let handle;
  try {
    handle = lock.acquireSync(path.join(stateDir(root), 'locks'), 'global',
      { maxHoldMs: LOCK_HOLD_MS, timeoutMs: LOCK_HOLD_MS, pollMs: 50 });
  } catch (error) {
    if (/^Timed out waiting for the lock/.test(errorText(error))) {
      throw new GuardError('another worker-workspace command has held this project for 15 minutes; ' +
        'nothing was changed, try again when it has finished');
    }
    throw error;
  }
  heldLock = handle;
  lastBeat = Date.now();
  try { return await body(); }
  finally { heldLock = null; handle.release(); }
}

// ------------------------------------------------------------- state folder --

function stateDir(root) {
  return path.join(root, STATE_DIR);
}

function ensureStateDirs(root) {
  for (const sub of ['', 'jobs', 'workspaces', 'backups', 'locks', 'journal', 'recovered']) {
    const target = sub ? path.join(stateDir(root), sub) : stateDir(root);
    if (isLink(target) || realpath(target) !== target) {
      throw new GuardError('unsafe state path: ' + (sub ? target : target + SEP));
    }
    mkdirs(target);
  }
}

/** Fail closed if the state dir or any immediate child is a symlink. */
function ensureStateTreeClean(root) {
  const sd = stateDir(root);
  if (isLink(sd) || realpath(sd) !== sd) throw new GuardError(`state directory is symlinked: ${sd}`);
  for (const name of fs.readdirSync(sd)) {
    if (isLink(path.join(sd, name))) throw new GuardError(`symlink not allowed inside state dir: ${name}`);
  }
}

export function sha256File(file) {
  beat();
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (count <= 0) break;
      hash.update(count === chunk.length ? chunk : chunk.subarray(0, count));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

/** The permission bits of a regular file, or null. Windows only knows "read-only or not", and that is what is compared there. */
function fileMode(file) {
  try {
    const info = fs.statSync(file);
    return info.isFile() ? (info.mode & 0o7777) : null;
  } catch { return null; }
}

/** Copy the content, the permission bits and the file times. */
function copy2(from, to) {
  beat();
  fs.copyFileSync(from, to);
  const info = fs.statSync(from);
  if (!WIN) fs.chmodSync(to, info.mode & 0o7777);   // the Windows copy already carries the read-only mark
  try { fs.utimesSync(to, info.atime, info.mtime); } catch { /* times are a courtesy, not a check */ }
}

/** Probe this project's volume only; nested mounts are not supported. */
export function pathRules(root) {
  const probe = path.join(stateDir(root), 'Path-Probe-é');
  if (isLink(probe)) throw new GuardError('symlink path probe refused');
  fs.closeSync(fs.openSync(probe, 'a'));
  const insensitive = exists(path.join(stateDir(root), 'pATH-pROBE-é'));
  const normalizes = exists(path.join(stateDir(root), 'Path-Probe-é'));
  return [insensitive, normalizes];
}

// A relative path with "." and ".." worked out and no doubled or trailing separators.
function normalizeRelative(rel) {
  const parts = [];
  for (const part of rel.split(WIN ? /[\\/]/ : '/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length && parts[parts.length - 1] !== '..') parts.pop();
    else parts.push(part);
  }
  return parts.length ? parts.join(SEP) : '.';
}

/** Reject absolute paths and anything normalizing outside root. */
function safeRelpath(root, rel) {
  if (path.isAbsolute(rel)) throw new GuardError(`absolute path not allowed: ${rel}`);
  const norm = normalizeRelative(rel);
  if (norm === '.' || norm === '' || norm === '..' || norm.startsWith('..' + SEP)) {
    throw new GuardError(`path escapes root: ${rel}`);
  }
  if (WIN) {
    // A colon names another drive or a hidden second stream of a file, and Windows drops a
    // trailing dot or space, so "a.txt." and "a.txt" would be one file under two names.
    if (norm.includes(':')) throw new GuardError(`path escapes root: ${rel}`);
    if (norm.split(SEP).some(part => /[. ]$/.test(part))) {
      throw new GuardError(`path component ends with a dot or a space: ${rel}`);
    }
  }
  const full = root.endsWith(SEP) ? root + norm : root + SEP + norm;
  if (!(full + SEP).startsWith(root + SEP)) throw new GuardError(`path escapes root: ${rel}`);
  return [norm, full];
}

/** The path spelled the way the disk spells every part that already exists. */
function canonicalRelpath(root, rel) {
  const [norm] = safeRelpath(root, rel);
  let current = root;
  const parts = [];
  for (let part of norm.split(SEP)) {
    const target = path.join(current, part);
    if (isLink(target)) throw new GuardError(`symlink not allowed: ${rel}`);
    if (exists(target) && isDir(current)) {
      const names = fs.readdirSync(current);
      if (!names.includes(part)) {
        const typed = part;
        const twin = names.find(name => {
          if (isLink(path.join(current, name))) return false;
          const same = sameFile(path.join(current, name), target);
          return same === null ? caseFold(name.normalize('NFC')) === caseFold(typed.normalize('NFC')) : same;
        });
        if (twin !== undefined) part = twin;
      }
    }
    parts.push(part);
    current = path.join(current, part);
  }
  return parts.join(SEP);
}

// Fold letter case the way Python's casefold does for the names that matter here.
function caseFold(text) {
  return text.toUpperCase().toLowerCase().toUpperCase().toLowerCase();
}

export function scopeKey(root, rel, rules) {
  const value = canonicalRelpath(root, rel);
  const [insensitive, normalizes] = rules;
  let current = root;
  let missing = false;
  const parts = [];
  for (let part of value.split(SEP)) {
    current = path.join(current, part);
    missing = missing || !exists(current);
    // Existing components already have their exact on-disk spelling. Folding
    // them would conflate distinct Unicode names on some insensitive volumes.
    if (missing) {
      if (normalizes) part = part.normalize('NFC');
      if (insensitive) part = caseFold(part);
    }
    parts.push(part);
  }
  return parts.join(SEP);
}

function scopesClash(a, b) {
  return a === b || a.startsWith(b + SEP) || b.startsWith(a + SEP);
}

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  if (isLink(tmp)) throw new GuardError('symlink temporary state file');
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data, 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  replaceFile(tmp, file);
}

/** Fail closed if any path component under root is a symlink. */
function ensureNoSymlink(root, full, rel) {
  let current = root;
  for (const part of rel.split(SEP)) {
    current = path.join(current, part);
    if (isLink(current)) throw new GuardError(`symlink not allowed: ${rel}`);
  }
}

function isIgnoredRel(rel) {
  return rel.split(SEP).some(part => IGNORED_DIRS.has(part));
}

// Walk a tree from the top down. `visit` gets each folder's sub-folder names and its other
// names, and returns the sub-folders to go into. A link to a folder is listed with the
// folders but never entered, and a folder that cannot be read is passed over.
function walk(top, visit) {
  const stack = [[top, '']];
  while (stack.length) {
    const [dir, relDir] = stack.pop();
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    const dirNames = [];
    const fileNames = [];
    for (const name of names) (isDir(path.join(dir, name)) ? dirNames : fileNames).push(name);
    const enter = visit(dir, relDir, dirNames, fileNames);
    for (let i = enter.length - 1; i >= 0; i--) {
      const next = path.join(dir, enter[i]);
      if (!isLink(next)) stack.push([next, relDir ? relDir + SEP + enter[i] : enter[i]]);
    }
  }
}

/** Hash every regular file (symlinks and other non-files skipped). */
export function treeBaseline(root) {
  const base = new Map();
  walk(root, (dir, relDir, dirNames, fileNames) => {
    for (const name of sortedText(fileNames)) {
      const full = path.join(dir, name);
      if (isLink(full) || !isFile(full)) continue;
      base.set(relDir ? relDir + SEP + name : name, sha256File(full));
    }
    return sortedText(dirNames.filter(name => !IGNORED_DIRS.has(name) && !isLink(path.join(dir, name))));
  });
  return base;
}

function jobsDir(root) {
  return path.join(stateDir(root), 'jobs');
}

function validateJobId(jobId) {
  if (!JOB_ID_RE.test(jobId || '')) throw new GuardError(`invalid job id: ${pyRepr(jobId)}`);
}

function loadJob(root, jobId) {
  validateJobId(jobId);
  const file = path.join(jobsDir(root), jobId + '.json');
  if (isLink(file) || !isFile(file)) throw new GuardError(`unknown job: ${jobId}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJob(root, job) {
  const file = path.join(jobsDir(root), need(job, 'id') + '.json');
  if (isLink(file)) throw new GuardError(`symlink not allowed: ${file}`);
  atomicWrite(file, pyJson(job, 2));
}

function* iterJobs(root) {
  const dir = jobsDir(root);
  if (!isDir(dir)) return;
  for (const name of sortedText(fs.readdirSync(dir))) {
    if (name.endsWith('.json')) yield JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
}

function interruptedMarker(root, jobId) {
  return path.join(stateDir(root), 'locks', `interrupted-${jobId}.lock`);
}

function clearMarker(root, jobId) {
  const marker = interruptedMarker(root, jobId);
  if (exists(marker)) replaceFile(marker, marker + '.released');
}

/**
 * Block all prepare/apply while any job is stuck 'applying' (for example what a killed
 * process leaves behind) or carries an unresolved interrupted lock. Recovery/abandon of
 * the excluded job itself is allowed through.
 */
function checkNoBlockedJobs(root, excludeId) {
  for (const job of iterJobs(root)) {
    const id = need(job, 'id');
    if (id === excludeId) continue;
    if (need(job, 'status') === 'applying') {
      throw new GuardError(`job ${id} is stuck in 'applying' (crashed mid-write?); ` +
        `explicit recovery required (recover --stopped ${id})`);
    }
  }
  const locks = path.join(stateDir(root), 'locks');
  if (!isDir(locks)) return;
  for (const name of fs.readdirSync(locks)) {
    if (name.startsWith('interrupted-') && name.endsWith('.lock')) {
      const other = name.slice('interrupted-'.length, -'.lock'.length);
      if (other !== excludeId) {
        throw new GuardError(`apply for job ${other} was interrupted and stays locked; ` +
          `explicit recovery required (recover --stopped ${other})`);
      }
    }
  }
}

function journal(root, jobId, event, fields = {}) {
  const entry = { ts: now(), job: jobId, event, ...fields };
  const file = path.join(stateDir(root), 'journal', `${jobId}.jsonl`);
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, pyJson(entry) + '\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

// Every write of a job record and every journal line goes through this table, so a test
// can stop the tool at an exact step. Nothing else uses it.
export const seams = { saveJob, journal };

// ---------------------------------------------------------------- prepare --

/** Reject directory claims and ancestor/descendant scope conflicts. */
function checkScopeClaims(root, rels) {
  const norms = [];
  for (const rel of rels) {
    const norm = canonicalRelpath(root, rel);
    const [, full] = safeRelpath(root, norm);
    if (isDir(full)) throw new GuardError(`claimed path is a directory: ${rel}`);
    norms.push(norm);
  }
  const ordered = sortedText(new Set(norms));
  const rules = pathRules(root);
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      if (scopesClash(scopeKey(root, a, rules), scopeKey(root, b, rules))) {
        throw new GuardError(`scope conflict between claimed files: ${a} vs ${b}`);
      }
    }
  }
  return ordered;
}

/**
 * Copy all project context into staging: ignored dirs pruned at any
 * depth; symlinks never followed or copied.
 */
function copyContextToStaging(root, wsAbs) {
  walk(root, (dir, relDir, dirNames, fileNames) => {
    for (const name of sortedText(fileNames)) {
      const full = path.join(dir, name);
      if (isLink(full) || !isFile(full)) continue;
      const dst = path.join(wsAbs, relDir ? relDir + SEP + name : name);
      mkdirs(path.dirname(dst));
      copy2(full, dst);
    }
    return sortedText(dirNames.filter(name => !IGNORED_DIRS.has(name) && !isLink(path.join(dir, name))));
  });
}

async function cmdPrepare(args) {
  const root = realpath(args.root);
  if (!isDir(root)) throw new GuardError(`root is not a directory: ${args.root}`);
  if (!args.files || !args.files.length) throw new GuardError('prepare needs at least one --files entry');
  if (!args.agent) throw new GuardError('prepare needs --agent NAME');

  let jobId;
  let wsRel;
  const owned = new Map();
  const skipped = [];
  await withGlobalLock(root, () => {
    checkNoBlockedJobs(root, null);
    const ordered = checkScopeClaims(root, args.files);

    const ownedModes = new Map();
    for (const norm of ordered) {
      if (isIgnoredRel(norm)) {
        skipped.push(norm);
        continue;
      }
      const [, full] = safeRelpath(root, norm);
      ensureNoSymlink(root, full, norm);
      owned.set(norm, isFile(full) ? sha256File(full) : ABSENT);
      ownedModes.set(norm, fileMode(full));
    }

    if (!owned.size) throw new GuardError('no ownable files after filtering ignored dirs');

    // Reject overlap with any active job's ownership.
    const rules = pathRules(root);
    for (const job of iterJobs(root)) {
      if (!ACTIVE_STATUSES.has(need(job, 'status'))) continue;
      const overlap = [];
      for (const a of owned.keys()) {
        for (const b of keysOf(need(job, 'files'))) {
          if (scopesClash(scopeKey(root, a, rules), scopeKey(root, b, rules))) overlap.push(a);
        }
      }
      if (overlap.length) {
        throw new GuardError(`files already owned by active job ${need(job, 'id')} ` +
          `(agent ${need(job, 'agent')}): ${pyList(overlap)}`);
      }
    }

    jobId = randomHex(6);
    wsRel = path.join(STATE_DIR, 'workspaces', jobId);
    const wsAbs = path.join(root, wsRel);
    mkdirs(wsAbs);
    copyContextToStaging(root, wsAbs);
    const staging = treeBaseline(wsAbs);
    const stagingModes = new Map();
    for (const rel of staging.keys()) stagingModes.set(rel, fileMode(path.join(wsAbs, rel)));

    const job = {
      id: jobId,
      agent: args.agent,
      root,
      created: now(),
      status: 'prepared',
      files: owned,
      staging,
      modes: ownedModes,
      staging_modes: stagingModes,
      workspace: wsRel,
    };
    seams.saveJob(root, job);
    seams.journal(root, jobId, 'prepared', { agent: args.agent, files: sortedText(owned.keys()) });
  });

  console.log(`job ${jobId}`);
  console.log(`agent ${args.agent}`);
  console.log(`workspace ${wsRel}`);
  for (const norm of sortedText(owned.keys())) console.log(`owned ${norm} ${owned.get(norm).slice(0, 12)}`);
  for (const norm of skipped) console.log(`ignored ${norm}`);
  return 0;
}

// ------------------------------------------------------------------ apply --

/**
 * ALL validation, before any status flip or write. Throws GuardError.
 *
 * Out-of-scope policy compares the STAGING tree to its prepare-time
 * baseline (catches worker edits to files the job does not own). The
 * original tree is compared ONLY for owned files (stale check), so
 * unrelated legitimate merges elsewhere never block this job.
 */
export function verifyBeforeWrite(root, job) {
  const owned = need(job, 'files');
  const stagingBase = need(job, 'staging');
  const wsAbs = path.join(root, need(job, 'workspace'));
  const problems = [];
  if (!has(job, 'modes') || !has(job, 'staging_modes')) {
    throw new GuardError('legacy assignment has no permission baseline; confirm worker stopped, abandon and prepare a new assignment');
  }

  const stagedNow = new Map();
  walk(wsAbs, (dir, relDir, dirNames, fileNames) => {
    const relOf = name => (relDir ? relDir + SEP + name : name);
    for (const name of dirNames) {
      if (isLink(path.join(dir, name))) problems.push('symlink directory in staging: ' + relOf(name));
    }
    for (const name of fileNames) {
      const full = path.join(dir, name);
      if (isLink(full)) problems.push(`symlink in staging: ${relOf(name)}`);
      else if (isFile(full)) stagedNow.set(relOf(name), sha256File(full));
    }
    return dirNames.filter(name => !IGNORED_DIRS.has(name));
  });

  for (const [rel, digest] of stagedNow) {
    if (!has(owned, rel) && get(stagingBase, rel) !== digest) {
      problems.push(`out-of-scope staged edit: ${rel}`);
    }
    if (!has(owned, rel) && get(job.staging_modes, rel) !== fileMode(path.join(wsAbs, rel))) {
      problems.push(`out-of-scope staged permission change: ${rel}`);
    }
  }
  for (const rel of keysOf(stagingBase)) {
    if (!has(owned, rel) && !stagedNow.has(rel)) problems.push(`out-of-scope staged delete: ${rel}`);
  }

  for (const rel of keysOf(owned)) {
    if (owned[rel] !== ABSENT && !stagedNow.has(rel)) problems.push(`owned file missing from staging: ${rel}`);
  }

  for (const rel of keysOf(owned)) {
    const [norm, full] = safeRelpath(root, rel);
    ensureNoSymlink(root, full, norm);
    const current = isFile(full) ? sha256File(full) : ABSENT;
    if (current !== owned[rel]) problems.push(`original hash mismatch: ${rel}`);
    if (fileMode(full) !== get(job.modes, rel)) problems.push(`original permission mismatch: ${rel}`);
  }

  if (problems.length) {
    throw new GuardError('apply rejected before writing anything: ' + problems.join('; '));
  }
}

function rollback(root, job, replaced, backups) {
  for (const rel of [...replaced].reverse()) {
    const backup = backups.has(rel) ? backups.get(rel) : null;
    const target = path.join(root, rel);
    if (backup !== null && isFile(backup)) {
      copy2(backup, target);
      seams.journal(root, job.id, 'rollback', { file: rel });
    } else {
      // File was newly created by this apply; refuse to delete (no rm),
      // move aside into state artifacts so the tree is not half-written.
      const asideDir = path.join(stateDir(root), 'recovered', job.id + '-rollback');
      const aside = path.join(asideDir, rel);
      mkdirs(path.dirname(aside));
      replaceFile(target, aside);
      seams.journal(root, job.id, 'rollback-new-file-moved-aside', { file: rel, aside });
    }
  }
}

// Ctrl+C while files are being replaced. Node only hears it between steps, so the
// write loop stops at marked points and looks. This stands in for Python's KeyboardInterrupt.
class Interrupted extends Error {}

async function cmdApply(args) {
  const root = realpath(args.root);
  return withGlobalLock(root, async () => {
    checkNoBlockedJobs(root, args.job);
    const job = loadJob(root, args.job);
    if (need(job, 'status') !== 'prepared') {
      throw new GuardError(`job ${need(job, 'id')} status is ${job.status}; cannot apply`);
    }

    // Every check happens here; on failure ownership/status are untouched
    // (job stays prepared/interrupted) so the driver can review safely.
    verifyBeforeWrite(root, job);

    const wsAbs = path.join(root, job.workspace);
    const files = keysOf(job.files);
    const intended = new Map();
    const intendedModes = new Map();
    for (const rel of files) {
      const staged = path.join(wsAbs, rel);
      intended.set(rel, isFile(staged) ? sha256File(staged) : ABSENT);
      intendedModes.set(rel, fileMode(staged));
    }
    job.intended = intended;
    job.intended_modes = intendedModes;
    job.status = 'applying';
    seams.saveJob(root, job);
    // Lock 'interrupted' BEFORE the first replace: a kill from here on
    // leaves either this marker or the 'applying' status, and both
    // globally block other prepare/apply until explicit recovery.
    fs.writeFileSync(interruptedMarker(root, job.id), `pid=${process.pid} ts=${now()}\n`);
    seams.journal(root, job.id, 'applying');

    const replaced = [];
    const backups = new Map();
    let stopAsked = false;
    const onInterrupt = () => { stopAsked = true; };
    const checkpoint = async () => {
      await new Promise(resolve => setImmediate(resolve));
      if (stopAsked) throw new Interrupted();
    };
    process.on('SIGINT', onInterrupt);
    try {
      const backupDir = path.join(stateDir(root), 'backups', job.id);
      mkdirs(backupDir);

      // Back up all originals first (nothing written into the tree yet).
      for (const rel of files) {
        await checkpoint();
        const target = path.join(root, rel);
        if (job.files[rel] !== ABSENT && isFile(target)) {
          const backup = path.join(backupDir, rel);
          mkdirs(path.dirname(backup));
          copy2(target, backup);
          backups.set(rel, backup);
          seams.journal(root, job.id, 'backup', { file: rel });
        }
      }

      // Atomic per-file replacement from the staging workspace.
      for (const rel of files) {
        await checkpoint();
        const src = path.join(wsAbs, rel);
        const target = path.join(root, rel);
        if (!isFile(src)) {
          if (job.files[rel] === ABSENT) continue;   // still absent: nothing to create
          throw new GuardError(`workspace copy missing for ${rel}`);
        }
        const parent = path.dirname(target);
        mkdirs(parent);
        const tmp = path.join(parent, '.wwtmp-' + randomHex(16));
        copy2(src, tmp);   // the copy keeps executable modes
        replaceFile(tmp, target);
        replaced.push(rel);
        seams.journal(root, job.id, 'replace', { file: rel });
      }

      await checkpoint();
      job.status = 'applied';
      seams.saveJob(root, job);
      clearMarker(root, job.id);
      seams.journal(root, job.id, 'applied');
      console.log(`job ${job.id} applied: ${replaced.length} file(s) replaced`);
      return 0;
    } catch (error) {
      if (error instanceof Interrupted) {
        job.status = 'interrupted';
        seams.saveJob(root, job);
        seams.journal(root, job.id, 'interrupted', { replaced });
        console.error('apply interrupted; job stays locked for explicit recovery');
        return 2;
      }
      // Ordinary failure: roll back what this apply wrote.
      try {
        rollback(root, job, replaced, backups);
        seams.journal(root, job.id, 'rolled-back', { error: errorText(error), replaced });
        job.status = 'rolled-back';
        seams.saveJob(root, job);
        clearMarker(root, job.id);
      } catch (rollbackError) {
        job.status = 'interrupted';
        seams.saveJob(root, job);
        seams.journal(root, job.id, 'interrupted', { error: errorText(rollbackError) });
        console.error(`rollback itself failed; job stays locked: ${errorText(rollbackError)}`);
        return 2;
      }
      console.error(`apply failed, changes rolled back: ${errorText(error)}`);
      return 1;
    } finally {
      process.removeListener('SIGINT', onInterrupt);
    }
  });
}

// ---------------------------------------------------------------- recover --

async function cmdRecover(args) {
  if (!args.stopped) throw new GuardError('recover refused: pass explicit --stopped to confirm');
  const root = realpath(args.root);
  let done = null;
  let jobId = null;
  await withGlobalLock(root, () => {
    checkNoBlockedJobs(root, args.job);
    const job = loadJob(root, args.job);
    jobId = need(job, 'id');
    if (need(job, 'status') === 'applied') {
      // All replacements precede this persisted state. Reconciliation changes
      // only bookkeeping, so later owner edits must never keep the project locked.
      if (exists(interruptedMarker(root, jobId))) {
        const drift = [];
        for (const rel of keysOf(need(job, 'files'))) {
          try {
            const [norm, target] = safeRelpath(root, rel);
            ensureNoSymlink(root, target, norm);
            const digest = isFile(target) ? sha256File(target) : ABSENT;
            if (digest !== get(get(job, 'intended'), rel)) drift.push(rel);
            else if (has(job, 'intended_modes') && fileMode(target) !== get(job.intended_modes, rel)) drift.push(rel);
          } catch { drift.push(rel); }
        }
        seams.journal(root, jobId, 'reconciled-applied',
          { drift, note: 'commit was complete; no project file changed' });
        clearMarker(root, jobId);
      }
      done = `job ${jobId} applied: commit marker reconciled; no project files changed`;
      return;
    }
    if (!['applying', 'interrupted'].includes(job.status)) {
      throw new GuardError(`job ${jobId} status is ${job.status}; nothing to recover`);
    }

    const backupDir = path.join(stateDir(root), 'backups', jobId);
    const artifacts = path.join(stateDir(root), 'recovered', jobId);
    const actions = [];
    const haveModes = has(job, 'modes') && has(job, 'intended_modes');
    if (!haveModes) {
      seams.journal(root, jobId, 'legacy-mode-recovery',
        { note: 'historical recovery uses content hashes; original mode baseline unavailable' });
    }
    const owned = need(job, 'files');
    for (const rel of keysOf(owned)) {
      const baseline = owned[rel];
      const [, target] = safeRelpath(root, rel);
      ensureNoSymlink(root, target, rel);
      const current = isFile(target) ? sha256File(target) : ABSENT;
      const mode = fileMode(target);
      if (current === baseline && (!haveModes || mode === get(job.modes, rel))) continue;
      const intended = get(get(job, 'intended'), rel);
      if (intended === null || current !== intended) {
        throw new GuardError('recover refused without overwrite: ' + rel);
      }
      if (haveModes && mode !== get(job.intended_modes, rel)) {
        throw new GuardError('recover refused changed permissions: ' + rel);
      }
      const backup = path.join(backupDir, rel);
      if (baseline !== ABSENT) {
        ensureNoSymlink(backupDir, backup, rel);
        if (!isFile(backup) || sha256File(backup) !== baseline) {
          throw new GuardError('missing or changed recovery backup: ' + rel);
        }
        if (haveModes && fileMode(backup) !== get(job.modes, rel)) {
          throw new GuardError('changed recovery backup permissions: ' + rel);
        }
      }
      actions.push([rel, target, baseline, backup]);
    }
    // All targets and backups checked before restoring any file.
    for (const [rel, target, baseline, backup] of actions) {
      if (baseline === ABSENT) {
        const aside = path.join(artifacts, rel + '.' + randomHex(16));
        mkdirs(path.dirname(aside));
        replaceFile(target, aside);
      } else {
        const tmp = target + '.recover-' + randomHex(16);
        copy2(backup, tmp);
        replaceFile(tmp, target);
      }
      seams.journal(root, jobId, 'recovered-file', { file: rel });
    }

    clearMarker(root, jobId);
    job.status = 'recovered';
    seams.saveJob(root, job);
    seams.journal(root, jobId, 'recovered',
      { note: 'originals restored; backups and artifacts retained; ownership released for handoff' });
  });
  console.log(done !== null ? done : `job ${jobId} recovered: originals restored, ownership released`);
  return 0;
}

// ---------------------------------------------------------------- abandon --

async function cmdAbandon(args) {
  if (!args.stopped) throw new GuardError('abandon refused: pass explicit --stopped to confirm');
  const root = realpath(args.root);
  let jobId = null;
  await withGlobalLock(root, () => {
    checkNoBlockedJobs(root, args.job);
    const job = loadJob(root, args.job);
    jobId = need(job, 'id');
    const status = need(job, 'status');
    if (status === 'applying' || status === 'interrupted') {
      throw new GuardError(`job ${jobId} is ${status}; run ` +
        'recover --stopped first so nothing is left half-written');
    }
    if (status === 'applied') throw new GuardError('applied jobs cannot be abandoned');
    job.status = 'abandoned';
    seams.saveJob(root, job);
    clearMarker(root, jobId);
    seams.journal(root, jobId, 'abandoned', { note: 'artifacts retained; ownership released for handoff' });
  });
  console.log(`job ${jobId} abandoned; artifacts retained, ownership released`);
  return 0;
}

// ----------------------------------------------------------------- status --

function cmdStatus(args) {
  const root = realpath(args.root);
  let jobs;
  if (args.job !== null) {
    jobs = [loadJob(root, args.job)];
  } else {
    if (!isDir(stateDir(root))) {
      console.log('no state directory; no jobs');
      return 0;
    }
    jobs = iterJobs(root);
  }
  let found = false;
  for (const job of jobs) {
    found = true;
    console.log(`${need(job, 'id')}  ${need(job, 'status')}  agent=${need(job, 'agent')}`);
    const files = need(job, 'files');
    for (const rel of keysOf(files)) console.log(`    ${rel} ${String(files[rel]).slice(0, 12)}`);
  }
  if (!found) console.log('no jobs');
  return 0;
}

// ---------------------------------------------------------- command line --

const PROG = 'worker-workspace';
const COMMAND_NAMES = ['prepare', 'apply', 'recover', 'abandon', 'status'];
const MAIN_USAGE = `usage: ${PROG} [-h] {prepare,apply,recover,abandon,status} ...`;
const MAIN_HELP = `${MAIN_USAGE}

worker-workspace.mjs: transactional prepare/apply command for non-git projects.

A worker agent never edits the project directly. It prepares a job (exclusive
per-file ownership + a full staging copy of the tree + baselines), edits copies
in the staging workspace, and the driver later applies the workspace back under
one project-wide lock with verification, backups, a journal, and rollback on
ordinary failure.

Model
-----
* prepare copies ALL project context (minus .attic/.git/node_modules/.worker-state
  at any depth, and without following symlinks) into an isolated staging dir and
  snapshots a staging baseline.
* apply validates everything BEFORE any write or status flip:
    - the whole STAGING tree vs the staging baseline: any change, addition or
      deletion outside the job's owned files is an out-of-scope edit -> reject.
    - only the owned ORIGINAL files vs their per-file baseline -> stale check.
  This lets disjoint legitimate changes (other merged workers, the owner) land
  in nonowned originals between prepare and apply without blocking the job,
  while any out-of-scope edit the worker staged is caught.
* A crash (a killed process) mid-apply leaves the job status "applying"; every
  other prepare/apply is globally blocked until \`recover --stopped\` (or abandon
  of a non-applying job) resolves it. Ordinary failure rolls back and releases.

Node built-in modules only. The project lock is ADVISORY. Same-user processes
that ignore it can bypass every check (this is NOT an OS sandbox).
See notes/WORKER-SAFEGUARDS.md.

positional arguments:
  {prepare,apply,recover,abandon,status}
    prepare             claim files, snapshot baselines, copy workspace
    apply               verify and write workspace back under the project lock
    recover             restore originals after an interrupted apply (requires
                        --stopped)
    abandon             release ownership (requires --stopped)
    status              list jobs and ownership

options:
  -h, --help            show this help message and exit`;

const STOPPED_HELP = '  --stopped    explicit confirmation that the worker is stopped';
const NARROW_HELP = '  -h, --help   show this help message and exit\n  --root ROOT\n';
// Each option: [flag, 'one' value | 'plus' one or more values | 'flag' no value, required].
const COMMANDS = {
  prepare: {
    run: cmdPrepare,
    usage: `usage: ${PROG} prepare [-h] --root ROOT --agent AGENT\n                                --files FILES [FILES ...]`,
    options: [['--root', 'one', true], ['--agent', 'one', true], ['--files', 'plus', true]],
    help: '  -h, --help            show this help message and exit\n  --root ROOT\n  --agent AGENT\n  --files FILES [FILES ...]',
  },
  apply: {
    run: cmdApply,
    usage: `usage: ${PROG} apply [-h] --root ROOT --job JOB`,
    options: [['--root', 'one', true], ['--job', 'one', true]],
    help: NARROW_HELP + '  --job JOB',
  },
  recover: {
    run: cmdRecover,
    usage: `usage: ${PROG} recover [-h] --root ROOT --job JOB [--stopped]`,
    options: [['--root', 'one', true], ['--job', 'one', true], ['--stopped', 'flag', false]],
    help: NARROW_HELP + '  --job JOB\n' + STOPPED_HELP,
  },
  abandon: {
    run: cmdAbandon,
    usage: `usage: ${PROG} abandon [-h] --root ROOT --job JOB [--stopped]`,
    options: [['--root', 'one', true], ['--job', 'one', true], ['--stopped', 'flag', false]],
    help: NARROW_HELP + '  --job JOB\n' + STOPPED_HELP,
  },
  status: {
    run: cmdStatus,
    usage: `usage: ${PROG} status [-h] --root ROOT [--job JOB]`,
    options: [['--root', 'one', true], ['--job', 'one', false]],
    help: NARROW_HELP + '  --job JOB    show only this job',
  },
};

// Is this word an option? null: a plain value. {name}: a known option (name is null for
// an unknown one), with `explicit` when written --name=value. Short forms such as --ro
// for --root are accepted, as the Python version accepted them.
function readOption(word, flags) {
  if (!word || word[0] !== '-') return null;
  if (flags.includes(word)) return { name: word };
  if (word.length === 1) return null;
  const cut = word.indexOf('=');
  const head = cut >= 0 ? word.slice(0, cut) : word;
  const explicit = cut >= 0 ? word.slice(cut + 1) : undefined;
  if (cut >= 0 && flags.includes(head)) return { name: head, explicit };
  if (word.startsWith('--')) {
    const matches = flags.filter(flag => flag.startsWith('--') && flag.startsWith(head));
    if (matches.length > 1) return { name: null, ambiguous: `ambiguous option: ${head} could match ${matches.join(', ')}` };
    if (matches.length === 1) return { name: matches[0], explicit };
  }
  if (/^-\d+$|^-\d*\.\d+$/.test(word)) return null;
  if (word.includes(' ')) return null;
  return { name: null };
}

// Returns {command, args} or {exit: code} after printing help or the usage error.
function parseArgs(argv) {
  const fail = (usage, prog, message) => {
    console.error(`${usage}\n${prog}: error: ${message}`);
    return { exit: 2 };
  };
  const extras = [];
  let index = 0;
  let name = null;
  for (; index < argv.length && name === null; index++) {
    const word = String(argv[index]);
    if (word === '--') continue;
    const option = readOption(word, ['-h', '--help']);
    if (option === null) name = word;
    else if (option.ambiguous) return fail(MAIN_USAGE, PROG, option.ambiguous);
    else if (option.name) { console.log(MAIN_HELP); return { exit: 0 }; }
    else extras.push(word);
  }
  if (name === null) return fail(MAIN_USAGE, PROG, 'the following arguments are required: cmd');
  if (!COMMAND_NAMES.includes(name)) {
    return fail(MAIN_USAGE, PROG, `argument cmd: invalid choice: ${pyRepr(name)} ` +
      `(choose from ${COMMAND_NAMES.map(pyRepr).join(', ')})`);
  }

  const command = COMMANDS[name];
  const prog = `${PROG} ${name}`;
  const flags = ['-h', '--help', ...command.options.map(option => option[0])];
  const args = { root: null, agent: null, files: null, job: null, stopped: false };
  const seen = new Set();
  const rest = argv.slice(index).map(String);
  for (let i = 0; i < rest.length;) {
    const word = rest[i];
    if (word === '--') { extras.push(...rest.slice(i + 1)); break; }
    const option = readOption(word, flags);
    if (option === null || option.name === null) {
      if (option && option.ambiguous) return fail(command.usage, prog, option.ambiguous);
      extras.push(word);
      i++;
      continue;
    }
    if (option.name === '-h' || option.name === '--help') {
      console.log(`${command.usage}\n\noptions:\n${command.help}`);
      return { exit: 0 };
    }
    const kind = command.options.find(entry => entry[0] === option.name)[1];
    const key = option.name.slice(2);
    seen.add(option.name);
    i++;
    if (kind === 'flag') {
      if (option.explicit !== undefined) {
        return fail(command.usage, prog, `argument ${option.name}: ignored explicit argument ${pyRepr(option.explicit)}`);
      }
      args[key] = true;
      continue;
    }
    const values = [];
    if (option.explicit !== undefined) values.push(option.explicit);
    else {
      while (i < rest.length && rest[i] !== '--' && readOption(rest[i], flags) === null) {
        values.push(rest[i++]);
        if (kind === 'one') break;
      }
    }
    if (!values.length) {
      return fail(command.usage, prog, `argument ${option.name}: expected ` +
        (kind === 'one' ? 'one argument' : 'at least one argument'));
    }
    args[key] = kind === 'one' ? values[0] : values;
  }
  const missing = command.options.filter(option => option[2] && !seen.has(option[0])).map(option => option[0]);
  if (missing.length) {
    return fail(command.usage, prog, `the following arguments are required: ${missing.join(', ')}`);
  }
  if (extras.length) return fail(MAIN_USAGE, PROG, `unrecognized arguments: ${extras.join(' ')}`);
  return { command, args };
}

/** Run one command line. Returns the exit code: 0 done, 1 refused or failed, 2 bad arguments or an interrupted apply. */
export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.exit !== undefined) return parsed.exit;
  try {
    return await parsed.command.run(parsed.args);
  } catch (error) {
    if (!(error instanceof GuardError)) throw error;
    console.error(`error: ${error.message}`);
    return 1;
  }
}

function startedDirectly() {
  if (!process.argv[1]) return false;
  try {
    const started = fs.realpathSync(path.resolve(process.argv[1]));
    const here = fs.realpathSync(fileURLToPath(import.meta.url));
    return WIN ? started.toLowerCase() === here.toLowerCase() : started === here;
  } catch { return false; }
}

if (startedDirectly()) {
  main().then(
    code => { process.exitCode = code; },
    error => { console.error(error && error.stack ? error.stack : String(error)); process.exitCode = 1; },
  );
}
