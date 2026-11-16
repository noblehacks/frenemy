'use strict';
// Publish a record of real IDE activity as a job row, under the same per-job lock as every
// other writer of job rows. Whatever is newer on disk always wins.
//
// Inside the extension:  require('./publish-codex-event').publish(jobsDir, data, options)
// From outside:          node publish-codex-event.js <jobsDir>     (data as JSON on stdin)
// data = {row, trail:[{at,text}], cursor, eventAt}
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lock = require('./joblock');
const { pyJson } = require('./pyjson');

const VALID_ID = /^[A-Za-z0-9._-]+$/;

// Thrown where a value cannot be read as a number or cannot be compared with one. The one
// place that tolerates this (a foreign row's "beat") catches exactly this and nothing else.
class NotANumber extends Error {}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function need(object, key) {
  if (!has(object, key)) throw new Error('The event is missing "' + key + '"');
  return object[key];
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A number from a JSON value: numbers, true/false, and text that spells a number.
function toFloat(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const text = value.trim();
    const special = /^([+-]?)(inf|infinity|nan)$/i.exec(text);
    if (special) return /^nan$/i.test(special[2]) ? NaN : special[1] === '-' ? -Infinity : Infinity;
    const digits = '\\d+(?:_\\d+)*';
    const shape = new RegExp('^[+-]?(?:' + digits + '\\.?(?:' + digits + ')?|\\.' + digits + ')(?:[eE][+-]?' + digits + ')?$');
    if (shape.test(text)) return Number(text.replace(/_/g, ''));
  }
  throw new NotANumber('not a number');
}

// The same, but anything unreadable or endless counts as 0.
function number(value) {
  try {
    const n = toFloat(value);
    return Number.isFinite(n) ? n : 0;
  } catch (error) {
    if (error instanceof NotANumber) return 0;
    throw error;
  }
}

function sameNumber(a, b) {
  if (typeof b === 'boolean') return a === (b ? 1 : 0);
  return typeof b === 'number' && a === b;
}

function atLeast(a, b) {
  if (typeof b === 'boolean') return a >= (b ? 1 : 0);
  if (typeof b !== 'number') throw new NotANumber('cannot compare a number with ' + typeof b);
  return a >= b;
}

// Is the pair (a0, a1) at or after the pair (b0, b1)? The first parts decide unless equal.
function pairAtLeast(a, b) {
  for (let i = 0; i < 2; i++) {
    if (sameNumber(a[i], b[i])) continue;
    return atLeast(a[i], b[i]);
  }
  return true;
}

function plain(value) {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  return String(value);
}

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

function readRecord(file) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file))); }
  catch (_) { return {}; }
}

/**
 * Write the row and its trail unless something at least as new is already there. Returns true
 * when it wrote, false when there was nothing to do. Throws when the event is malformed, a file
 * cannot be written, or the job's lock stays taken for longer than options.timeoutMs.
 */
function publish(jobsDir, event, options) {
  const data = JSON.parse(JSON.stringify(event));   // exactly what would cross a process boundary
  if (!isRecord(data)) throw new TypeError('The event must be an object');
  const row = need(data, 'row');
  if (!isRecord(row)) throw new TypeError('The event row must be an object');
  const jobId = need(row, 'id');
  if (typeof jobId !== 'string') throw new TypeError('The job id must be text');
  if (!VALID_ID.test(jobId)) throw new Error('Invalid job id');
  const root = path.dirname(jobsDir);
  const locks = path.join(root, '.writer-locks');
  const temps = path.join(root, '.tmp');
  for (const dir of [jobsDir, locks, temps]) fs.mkdirSync(dir, { recursive: true });

  const atomic = (target, text) => {
    let fd, temp;
    for (let attempt = 0; ; attempt++) {
      temp = path.join(temps, jobId + '.ide-' + crypto.randomBytes(4).toString('hex'));
      try { fd = fs.openSync(temp, 'wx', 0o600); break; }
      catch (error) { if (error.code !== 'EEXIST' || attempt >= 20) throw error; }
    }
    try { fs.writeFileSync(fd, text); } finally { fs.closeSync(fd); }
    replace(temp, target);
  };

  return lock.withLockSync(locks, lock.keyFor(jobId), () => {
    const target = path.join(jobsDir, jobId + '.json');
    let old = readRecord(target);
    if (!fs.existsSync(target)) {
      const dismissal = readRecord(path.join(root, 'dismissed', jobId + '.json'));
      if (isRecord(dismissal)) {
        const at = number(need(data, 'eventAt')), cursor = number(need(data, 'cursor'));
        const cutoff = number(dismissal.cutoff), seen = number(dismissal.cursor);
        // An event the owner already cleared: no phantom row, and nothing to retry.
        if (at < cutoff || (at === cutoff && cursor <= seen)) return false;
      }
    }
    if (!isRecord(old)) old = {};
    if (has(old, 'source') && old.source === 'codex-ide-events') {
      if (pairAtLeast([number(old.event_at), number(old.event_cursor)],
        [need(data, 'eventAt'), need(data, 'cursor')])) return false;
    } else {
      // The reporters count in whole seconds; on a same-second tie their row is kept.
      try {
        const oldBeat = toFloat(has(old, 'beat') ? old.beat : 0);
        if (!has(row, 'beat')) throw new Error('The event row is missing "beat"');
        if (atLeast(oldBeat, row.beat)) return false;
      } catch (error) {
        if (!(error instanceof NotANumber)) throw error;
      }
    }
    row.event_at = need(data, 'eventAt');
    row.event_cursor = need(data, 'cursor');
    const trail = need(data, 'trail');
    if (!Array.isArray(trail)) throw new TypeError('The event trail must be a list');
    atomic(path.join(jobsDir, jobId + '.trail'),
      trail.map(item => plain(need(item, 'at')) + '\t1\t' + plain(need(item, 'text')) + '\n').join(''));
    atomic(target, pyJson(row) + '\n');
    return true;
  }, options);
}

module.exports = { publish };

if (require.main === module) {
  try {
    const data = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (!process.argv[2]) throw new Error('usage: node publish-codex-event.js <jobsDir>');
    // Wait for the job's lock for as long as it takes; a lock left by a dead writer clears itself.
    publish(process.argv[2], data, { timeoutMs: 600000 });
  } catch (error) {
    process.stderr.write(String((error && error.stack) || error) + '\n');
    process.exit(1);
  }
}
