'use strict';
// Archive selected job records under the shared per-job lock, and keep a record of each
// dismissal so that a replayed event cannot bring a cleared job back.
//
// Inside the extension:  require('./archive-jobs').archive(jobsDir, jobs, checked) -> Promise
// From outside:          node archive-jobs.js <jobsDir>
//                        (request JSON on stdin: {"jobs":[{"id","hash"}],"checked":bool};
//                         result JSON on stdout: {"cleared","skipped","errors"})
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const timers = require('timers');     // the real timer, whatever a host does to the global one
const lock = require('./joblock');
const { pyJson } = require('./pyjson');

const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PARTS = ['json', 'steps', 'trail', 'tasks'];
const BUSY_WAIT_MS = 2000;

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function get(object, key, fallback) {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : fallback;
}

// A fault of the file system or of the lock (as opposed to a mistake in the request).
function isFileFault(error) {
  return Boolean(error) && typeof error.code === 'string' && !error.code.startsWith('ERR_');
}

// Move a file into place. Windows can refuse for a moment while another program has the
// target open, so there the move is tried again briefly.
function replace(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (error) {
      const retry = process.platform === 'win32' && attempt < 10 &&
        (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES');
      if (!retry) throw error;
      lock.sleepSync(20);
    }
  }
}

// Write the whole file beside its target, then move it into place: old or new, never partial.
function atomic(target, data) {
  const dir = path.dirname(target);
  let fd, temp;
  for (let attempt = 0; ; attempt++) {
    temp = path.join(dir, path.basename(target) + '.' + crypto.randomBytes(4).toString('hex'));
    try { fd = fs.openSync(temp, 'wx', 0o600); break; }
    catch (error) { if (error.code !== 'EEXIST' || attempt >= 20) throw error; }
  }
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  replace(temp, target);
}

// One job, with its lock held.
function archiveLocked(dirs, jid, candidate, checked, result) {
  const target = path.join(dirs.jobs, jid + '.json');
  const marker = path.join(dirs.dismissed, jid + '.json');
  let raw;
  try { raw = fs.readFileSync(target); }
  catch (error) {
    if (error.code === 'ENOENT') { result.skipped += 1; return; }
    throw error;
  }
  if (checked && sha256(raw) !== candidate.hash) { result.skipped += 1; return; }
  let row;
  try { row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch (_) { row = {}; }
  if (row === null || typeof row !== 'object' || Array.isArray(row)) row = {};

  // The dismissal is saved first: a crash after the record has moved must not allow a replay.
  let cutoff = Date.now();
  const eventAt = get(row, 'event_at', 0);
  if (typeof eventAt === 'number') cutoff = Math.max(cutoff, eventAt);
  const record = { row, cutoff, cursor: get(row, 'event_cursor', 0) };
  const oldMarker = fs.existsSync(marker) ? fs.readFileSync(marker) : null;
  const destination = fs.mkdtempSync(path.join(dirs.trash, jid + '-'));
  const moved = [];
  let markerWritten = false;
  try {
    atomic(marker, pyJson(record) + '\n');
    markerWritten = true;
    for (const part of PARTS) {
      const from = path.join(dirs.jobs, jid + '.' + part);
      const to = path.join(destination, jid + '.' + part);
      try { replace(from, to); }
      catch (error) {
        // The reporters can create or remove the side files at any moment; only the record
        // itself has to be there.
        if (error.code === 'ENOENT' && part !== 'json') continue;
        throw error;
      }
      moved.push([from, to, part]);
    }
  } catch (error) {
    // The job's lock is still held while it is put back.
    for (const [from, to, part] of moved.slice().reverse()) {
      if (part === 'json' || !fs.existsSync(from)) replace(to, from);
    }
    if (markerWritten) {
      if (oldMarker !== null) atomic(marker, oldMarker);
      else replace(marker, path.join(destination, 'cancelled-dismissal.json'));
    }
    throw error;
  }
  result.cleared += 1;
}

/**
 * Archive each job in `candidates` ([{id, hash}]) out of `jobsDir` into the trash folder beside
 * it. With `checked`, a job whose record no longer matches its hash is left alone and counted
 * as skipped. A job that another writer holds for two seconds is reported as busy, not forced.
 * Options: `timeoutMs` (give up between jobs after this long) and `stopped()` (give up between
 * jobs when it returns true). Giving up rejects the promise; no job is ever left half moved.
 */
async function archive(jobsDir, candidates, checked, options) {
  const o = options || {};
  const root = path.dirname(jobsDir);
  const dirs = {
    jobs: jobsDir,
    locks: path.join(root, '.writer-locks'),
    dismissed: path.join(root, 'dismissed'),
    trash: path.join(root, 'trash'),
  };
  for (const dir of [dirs.locks, dirs.dismissed, dirs.trash]) fs.mkdirSync(dir, { recursive: true });
  if (!Array.isArray(candidates)) throw new TypeError('The jobs to archive must be a list');
  const result = { cleared: 0, skipped: 0, errors: [] };
  const began = Date.now();
  const giveUpIfAsked = () => {
    if (o.stopped && o.stopped()) throw new Error('Archive was stopped');
    if (o.timeoutMs && Date.now() - began >= o.timeoutMs) {
      throw new Error('Archive ran out of time after ' + Math.round(o.timeoutMs / 1000) + ' seconds');
    }
  };
  for (const candidate of candidates) {
    await new Promise(resolve => setImmediate(resolve));   // let the host breathe between jobs
    giveUpIfAsked();
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError('Each job to archive must be an object with an id');
    }
    const jid = get(candidate, 'id', '');
    if (typeof jid !== 'string' || !VALID_ID.test(jid)) {
      result.errors.push({ id: String(jid).slice(0, 128), error: 'Invalid job ID' });
      continue;
    }
    try {
      let handle = null;
      const deadline = Date.now() + BUSY_WAIT_MS;
      for (;;) {
        handle = lock.acquireSync(dirs.locks, lock.keyFor(jid), { wait: false });
        if (handle) break;
        if (Date.now() >= deadline) {
          throw Object.assign(new Error('Job is busy; try clearing again'), { code: 'ETIMEDOUT' });
        }
        await new Promise(resolve => timers.setTimeout(resolve, 25));
        giveUpIfAsked();
      }
      try { archiveLocked(dirs, jid, candidate, checked, result); }
      finally { handle.release(); }
    } catch (error) {
      if (!isFileFault(error)) throw error;
      result.errors.push({ id: jid, error: error.message });
    }
  }
  return result;
}

module.exports = { archive };

if (require.main === module) {
  // A stop signal is honoured between jobs, so the job in hand is always finished or put back.
  const stop = { signal: 0 };
  for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(name, () => { if (!stop.signal) stop.signal = os.constants.signals[name] || 1; });
  }
  const fail = error => {
    if (stop.signal) process.exit(128 + stop.signal);
    process.stderr.write(String((error && error.stack) || error) + '\n');
    process.exit(1);
  };
  let request;
  try {
    request = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (request === null || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('The request must be an object');
    if (!Object.prototype.hasOwnProperty.call(request, 'jobs')) throw new Error("The request has no 'jobs'");
    if (!process.argv[2]) throw new Error('usage: node archive-jobs.js <jobsDir>');
  } catch (error) { fail(error); }
  const flag = get(request, 'checked', false);
  const checked = Array.isArray(flag) ? flag.length > 0 :
    (flag !== null && typeof flag === 'object') ? Object.keys(flag).length > 0 : Boolean(flag);
  archive(process.argv[2], request.jobs, checked, { stopped: () => stop.signal !== 0 })
    .then(result => { process.stdout.write(pyJson(result) + '\n'); }, fail);
}
