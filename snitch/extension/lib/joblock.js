'use strict';
// One lock for every Frenemy and Snitch writer, on macOS, Linux and Windows, with Node alone.
//
// A lock is a directory made with mkdir, which either succeeds or fails as one step on every
// system. The holder leaves a small owner file inside. A lock whose holder has died, or that
// has been held far longer than any real job needs, is cleared by one process at a time (the
// "breaker" directory beside it), so two waiting processes can never both take it.
//
// CommonJS on purpose: the VS Code extension loads it with require(), and the .mjs tools load
// it with a plain import.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = { wait: true, timeoutMs: 30000, maxHoldMs: 120000, pollMs: 20 };
// What Windows answers to mkdir while a folder of the same name is still being removed.
const WINDOWS_BUSY = process.platform === 'win32' ? ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'] : [];

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms));
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

/** The file-safe name the writers use for a job id or session key. */
function keyFor(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function readOwner(lockDir) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
    return owner && typeof owner === 'object' ? owner : null;
  } catch { return null; }
}

function ageMs(target) {
  try { return Date.now() - fs.statSync(target).mtimeMs; } catch { return null; }
}

function remove(target) {
  // Windows can hold a folder for a moment while another process looks inside it, so try a few times.
  try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 15 }); }
  catch { /* another process got there first */ }
}

function isStale(lockDir, maxHoldMs) {
  const age = ageMs(lockDir);
  if (age === null) return false;                 // already gone
  const owner = readOwner(lockDir);
  if (!owner) return age > 5000;                  // died between mkdir and writing the owner file
  return !alive(owner.pid) || age > maxHoldMs;
}

// Clear a dead holder's lock. Only the process that holds the breaker may remove it, and it
// looks again first, so a lock taken by a live process in the meantime is never removed.
function breakStale(lockDir, maxHoldMs) {
  const breaker = lockDir + '.break';
  try { fs.mkdirSync(breaker); }
  catch (error) {
    // The same Windows answers as in tryAcquire, while another process removes its breaker.
    if (WINDOWS_BUSY.includes(error.code)) return;
    if (error.code !== 'EEXIST') throw error;
    const age = ageMs(breaker);
    if (age !== null && age > 10000) { try { fs.rmdirSync(breaker); } catch { /* raced */ } }
    return;
  }
  try { if (isStale(lockDir, maxHoldMs)) remove(lockDir); }
  finally { try { fs.rmdirSync(breaker); } catch { /* raced */ } }
}

function tryAcquire(lockDir, maxHoldMs) {
  try { fs.mkdirSync(lockDir); }
  catch (error) {
    if (error.code === 'EEXIST') {
      if (isStale(lockDir, maxHoldMs)) breakStale(lockDir, maxHoldMs);
      return null;
    }
    // Windows answers "not permitted" or "busy" while the last holder's folder is still being
    // removed. That is a taken lock, not a fault: wait and try again. A real permission fault
    // ends as the caller's timeout.
    if (WINDOWS_BUSY.includes(error.code)) return null;
    throw error;
  }
  const token = crypto.randomBytes(8).toString('hex');
  try {
    fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, token, at: Date.now() }));
  } catch (error) { remove(lockDir); throw error; }
  let released = false;
  return {
    path: lockDir,
    release() {
      if (released) return;
      released = true;
      const owner = readOwner(lockDir);
      if (owner && owner.token === token) remove(lockDir);   // never remove a lock that is no longer ours
    },
  };
}

function lockPath(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, String(name) + '.d');
}

/**
 * Take the lock `name` inside `dir`. Returns a handle with release(), or null when
 * options.wait is false and somebody else holds it. Throws after options.timeoutMs.
 */
function acquireSync(dir, name, options) {
  const o = Object.assign({}, DEFAULTS, options);
  const target = lockPath(dir, name);
  const deadline = Date.now() + o.timeoutMs;
  for (;;) {
    const handle = tryAcquire(target, o.maxHoldMs);
    if (handle) return handle;
    if (!o.wait) return null;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the lock ' + target);
    sleepSync(o.pollMs);
  }
}

/** Run fn while holding the lock. With wait:false, returns options.busy when it is taken. */
function withLockSync(dir, name, fn, options) {
  const handle = acquireSync(dir, name, options);
  if (!handle) return options && options.busy;
  try { return fn(); } finally { handle.release(); }
}

/** The same for a holder that waits on other things (a child process, a timer) while it holds the lock. */
async function withLock(dir, name, fn, options) {
  const o = Object.assign({}, DEFAULTS, options);
  const target = lockPath(dir, name);
  const deadline = Date.now() + o.timeoutMs;
  let handle;
  for (;;) {
    handle = tryAcquire(target, o.maxHoldMs);
    if (handle) break;
    if (!o.wait) return o.busy;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the lock ' + target);
    await new Promise(resolve => setTimeout(resolve, o.pollMs));
  }
  try { return await fn(); } finally { handle.release(); }
}

module.exports = { acquireSync, withLockSync, withLock, keyFor, sleepSync, alive };
