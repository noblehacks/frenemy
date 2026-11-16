// Run one disposable browser for a test, for at most 30 seconds, and leave none of its
// processes behind.  Usage: node browser-runner.mjs <browser> <page>
// The finished page is written to stdout. The browser's own messages are kept in a temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WIN, stopProcessTree } from '../../tools/platform.mjs';

const LIMIT_MS = 30000;
const [browser, page] = process.argv.slice(2);
if (!browser || !page || process.argv.length !== 4) {
  process.stderr.write('usage: node browser-runner.mjs <browser> <page>\n');
  process.exit(1);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snitch-browser-profile-'));

// A fresh browser must not inherit the editor's own start-up switches, so it gets only the
// few settings a program needs to start at all.
const KEEP = ['HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL'];
const KEEP_WINDOWS = ['USERPROFILE', 'USERNAME', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'TEMP', 'TMP',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMSPEC', 'PATHEXT'];
const browserEnv = {};
for (const [key, value] of Object.entries(process.env)) {
  if (KEEP.includes(key) || (WIN && [...KEEP, ...KEEP_WINDOWS].includes(key.toUpperCase()))) browserEnv[key] = value;
}

const log = fs.openSync(path.join(profile, 'stderr.log'), 'w');
let child = null;
let code = 0;
try {
  const result = await new Promise((resolve, reject) => {
    // Its own process group on macOS and Linux, so every helper it starts can be ended with it.
    child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run',
      '--no-default-browser-check', '--user-data-dir=' + profile, '--virtual-time-budget=4000',
      '--dump-dom', page],
      { stdio: ['ignore', 'pipe', log], detached: !WIN, env: browserEnv, windowsHide: true });
    const chunks = [];
    const timer = setTimeout(() => resolve({ timedOut: true }), LIMIT_MS);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status: status === null ? 'signal ' + signal : status, output: Buffer.concat(chunks) });
    });
  });
  if (result.timedOut) {
    process.stderr.write('Browser test exceeded 30s; diagnostics retained at ' + profile + '\n');
    code = 1;
  } else if (result.status !== 0) {
    throw new Error('browser exited ' + result.status + '; diagnostics retained at ' + profile);
  } else {
    await new Promise(resolve => process.stdout.write(result.output, resolve));
  }
} catch (error) {
  process.stderr.write(String((error && error.stack) || error) + '\n');
  code = 1;
} finally {
  if (child && child.pid) {
    if (WIN) await stopProcessTree(child.pid, 0);
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the whole group has already gone */ } }
  }
  try { fs.closeSync(log); } catch { /* already closed */ }
}
process.exit(code);
