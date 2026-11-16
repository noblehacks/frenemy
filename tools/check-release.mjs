#!/usr/bin/env node
// Repeatable offline release checks; provider checks are separately recorded.
//
// No provider requests, config mutation or installation. A browser failure is a
// failure, and --skip-browser explicitly leaves visual validation incomplete.
// All logs and temporary test artifacts are retained.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIN, stopProcessTree } from './platform.mjs';

const ROOT = path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))));
const IGNORED = new Set(['.attic', '.git', '.worker-state', '.worker-verification', '__pycache__', 'node_modules']);

// The test suites, by the name each one has in the results.
const SUITES = [
  ['worker-job-status', 'tools/test-worker-status.mjs'],
  ['fresh-install', 'tools/test-install.mjs'],
  ['worker-guard', 'tools/test-worker-workspace.mjs'],
  ['worker-adversarial', 'tools/test-worker-adversarial.mjs'],
  ['worker-repairs', 'tools/test-worker-repairs.mjs'],
  ['relay-transactions', 'tools/test-relay-transactions.mjs'],
  ['relay-shutdown', 'tools/test-relay-shutdown.mjs'],
  ['relay-native-session-lifecycle', 'snitch/test/relay-session.test.mjs'],
  ['agy-quota-flow', 'tools/test-agy-quota.mjs'],
  ['fleet-writer-hooks', 'snitch/test/fleet.test.mjs'],
  ['fleet-command-lifecycle', 'snitch/test/run-job.test.mjs'],
  ['background-log-resolution', 'snitch/test/background-log.test.mjs'],
  ['background-exit-recording', 'snitch/test/close-background.test.mjs'],
  ['native-hook-replay', 'snitch/test/native-hooks.test.mjs'],
  ['process-sweep-safety', 'tools/test-sweep.mjs'],
  ['image-delivery', 'tools/test-image-delivery.mjs'],
  ['snitch-model', 'snitch/test/model.test.js'],
  ['snitch-activation', 'snitch/test/activate.test.js'],
  ['snitch-archive', 'snitch/test/archive.test.mjs'],
  ['snitch-clear-commands', 'snitch/test/clear-commands.test.js'],
  ['codex-ide-feed', 'snitch/test/codex-feed.test.js'],
  ['app-wrappers', 'tools/test-wrappers.mjs'],
  ['platform-and-locks', 'tools/test-platform.mjs'],
];
const BROWSER_SUITE = 'snitch/test/client.test.js';

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log('usage: node tools/check-release.mjs [--skip-browser]\n\nRepeatable offline release checks. ' +
    'No provider requests, no settings changes, no installation.');
  process.exit(0);
}
const unknown = argv.filter(word => word !== '--skip-browser');
if (unknown.length) {
  console.error('usage: node tools/check-release.mjs [--skip-browser]\nUnknown option: ' + unknown.join(' '));
  process.exit(2);
}
const skipBrowser = argv.includes('--skip-browser');

const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'frenemy-release-check-'));
const results = [];

/** Run one Node script with its output kept in a log. A script that hangs is stopped, with everything it started. */
async function run(name, args, timeoutSeconds = 120) {
  const log = path.join(evidence, name + '.log');
  const stream = fs.openSync(log, 'w');
  let status = 'fail';
  try {
    const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
    for (const seat of ['CLAUDE', 'CODEX', 'AGY', 'KIMI']) env[seat + '_BIN'] = path.join(evidence, 'disabled-real-provider');
    status = await new Promise(resolve => {
      let child, settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      try {
        child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', stream, stream], env, detached: !WIN, windowsHide: true });
      } catch (error) {
        fs.writeSync(stream, String(error.message || error) + '\n');
        finish('fail'); return;
      }
      let late = false;
      const timer = setTimeout(async () => {
        late = true;      // from here on only this path ends the check, so the log stays open for it
        try {
          fs.writeSync(stream, 'Stopped: still running after ' + timeoutSeconds + ' seconds\n');
          const stopped = await stopProcessTree(child.pid);
          if (!stopped) fs.writeSync(stream, 'Some of its processes could not be seen to stop.\n');
        } catch { /* the result is a failure either way */ }
        finish('fail');
      }, timeoutSeconds * 1000);
      child.on('error', error => {
        if (late) return;
        clearTimeout(timer);
        fs.writeSync(stream, String(error.message || error) + '\n');
        finish('fail');
      });
      child.on('exit', code => {
        if (late) return;
        clearTimeout(timer);
        finish(code === 0 ? 'pass' : 'fail');
      });
    });
  } finally {
    fs.closeSync(stream);
  }
  results.push({ check: name, status, log });
  console.log(status.toUpperCase(), name);
  if (status === 'fail') showFailure(log);
}

/** Print what a failed check said, so the reason is on screen and not only in a log file. */
function showFailure(log) {
  try {
    const lines = fs.readFileSync(log, 'utf8').split(/\r?\n/);
    // Every line that reports a failure, with the 14 lines after it (the reason usually follows).
    const keep = new Set();
    lines.forEach((line, at) => {
      if (/fail|not ok|error|stopped/i.test(line) && !/^\s*(PASS|ok)\b/.test(line)) for (let i = at; i <= at + 14 && i < lines.length; i++) keep.add(i);
    });
    const bad = lines.filter((line, at) => keep.has(at) && !/^\s*ok\b/.test(line));
    const shown = lines.length <= 150 ? lines : [...bad.slice(0, 160), '...', ...lines.slice(-25)];
    console.log(shown.map(line => '    | ' + line).join('\n'));
  } catch { /* the log could not be read; the FAIL line above still stands */ }
}

function releaseFiles(dir, parts = []) {
  const found = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(item.name)) continue;
    const here = parts.concat(item.name), full = path.join(dir, item.name);
    let info;
    try { info = fs.statSync(full); } catch { continue; }
    if (info.isDirectory() && !item.isSymbolicLink()) found.push(...releaseFiles(full, here));
    else if (info.isFile()) found.push(here);
  }
  return found;
}

const files = releaseFiles(ROOT).sort((a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return a.length - b.length;
});
for (const parts of files) {
  const file = path.join(ROOT, ...parts), name = parts.join('-'), ending = path.extname(file);
  if (ending === '.js' || ending === '.mjs') await run('syntax-' + name, ['--check', file], 15);
  else if (ending === '.json') {
    try {
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)));
      results.push({ check: 'json-' + name, status: 'pass' });
    } catch (error) {
      results.push({ check: 'json-' + name, status: 'fail', detail: String(error.message || error) });
      console.log('FAIL', 'json-' + name);
    }
  }
}

async function suite(name, script, timeoutSeconds) {
  if (!fs.existsSync(path.join(ROOT, ...script.split('/')))) {
    results.push({ check: name, status: 'fail', detail: 'missing: ' + script });
    console.log('FAIL', name, '(missing: ' + script + ')');
    return;
  }
  await run(name, [path.join(ROOT, ...script.split('/'))], timeoutSeconds);
}
for (const [name, script] of SUITES) await suite(name, script, 240);
if (skipBrowser) {
  results.push({ check: 'snitch-browser', status: 'unverified', detail: 'Explicitly skipped; no visual pass claimed.' });
} else await suite('snitch-browser', BROWSER_SUITE, 600);
results.push({ check: 'live-provider-routes', status: 'unverified',
  detail: 'Offline suite makes no provider requests; consult the dated live audit.' });

function localTime(now = new Date()) {
  const pad = (n, width = 2) => String(Math.trunc(Math.abs(n))).padStart(width, '0');
  const offset = -now.getTimezoneOffset();
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + 'T' + pad(now.getHours()) + ':' +
    pad(now.getMinutes()) + ':' + pad(now.getSeconds()) + '.' + pad(now.getMilliseconds(), 3) + '000' +
    (offset < 0 ? '-' : '+') + pad(offset / 60) + ':' + pad(offset % 60);
}

const report = { time: localTime(), root: ROOT, results, evidence };
fs.writeFileSync(path.join(evidence, 'RESULTS.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Evidence:', path.join(evidence, 'RESULTS.json'));
const failed = results.filter(result => result.status === 'fail').length;
console.log('Failed checks:', failed);
console.log('This result is not a certification of live providers or the installed IDE.');
process.exit(failed ? 1 : 0);
