// Shared by the relay and wrapper tests: temp folders, fake AI apps, a safe environment and a
// reader for a relay's answers. Nothing here starts a real AI app or touches the real home.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WIN = process.platform === 'win32';
export const PKG = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const NODE = process.execPath;

let pass = 0, fail = 0;

/** One check: a line when it passes, a line and the reason when it fails. */
export async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (error) {
    fail++;
    console.log('  FAIL  ' + name + '\n        ' + String((error && error.stack) || error).split('\n').join('\n        '));
  }
}

/** A check this system cannot run, said in the open. */
export function skip(name, why) { console.log('  skip  ' + name + ' (' + why + ')'); }

/** Print the count and end the test run: exit 0 only when every check passed. */
export function finish(what) {
  console.log('\n' + pass + '/' + (pass + fail) + ' ' + what + ' passed');
  process.exit(fail ? 1 : 0);
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A new temp folder, by its real path (the worker guard refuses a path through a link). */
export function tempRoot(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

/** True when the process is seen to be gone on two looks a moment apart, within `withinMs`. */
export async function gone(pid, withinMs = 3000) {
  const deadline = Date.now() + withinMs;
  for (;;) {
    if (!alive(pid)) { await sleep(150); if (!alive(pid)) return true; }
    if (Date.now() >= deadline) return false;
    await sleep(50);
  }
}

export function stopHard(pid) {
  if (!pid || !alive(pid)) return;
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

/**
 * A fake AI app: a small Node script. Returns the path to put in CLAUDE_BIN, CODEX_BIN, AGY_BIN
 * or KIMI_BIN. On Windows that is a .cmd launcher beside the script, the shape npm installs.
 */
export function fakeApp(dir, name, source) {
  fs.mkdirSync(dir, { recursive: true });
  if (WIN) {
    fs.writeFileSync(path.join(dir, name + '.js'), source);
    const launcher = path.join(dir, name + '.cmd');
    fs.writeFileSync(launcher, '@ECHO off\r\nnode "%~dp0\\' + name + '.js" %*\r\n');
    return launcher;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/usr/bin/env node\n' + source);
  fs.chmodSync(file, 0o755);
  return file;
}

/** Source for a fake app that ignores a polite stop, writes its process number and sleeps. */
export function sleeperSource(pidFile) {
  return 'const fs = require("fs");\n' +
    'process.on("SIGTERM", () => {});\n' +
    'const file = ' + JSON.stringify(pidFile) + ';\n' +
    'fs.writeFileSync(file + ".ready", String(process.pid));\n' +
    'fs.renameSync(file + ".ready", file);\n' +
    'setTimeout(() => {}, 40000);\n';
}

/**
 * The environment for anything a test starts: home and job folders inside `root`, this Node
 * first on the search path, and all four AI apps pointed at a file that does not exist, so a
 * test can only ever start the fakes it names in `extra`.
 */
export function safeEnv(root, extra = {}) {
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(CLAUDE|CODEX|AGY|KIMI)_(BIN|TIMEOUT|WRITE|FULL|AGENT_FILE|LOG_FILE)$/.test(key)) delete env[key];
  }
  for (const key of ['NODE_BIN', 'FLEET_BIN', 'FRENEMY_DRIVER', 'FRENEMY_RELAY_JOB', 'SNITCH_CAPTURE']) delete env[key];
  const pathName = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  env[pathName] = [path.dirname(NODE), env[pathName] || ''].filter(Boolean).join(path.delimiter);
  const absent = path.join(root, 'no-real-app');
  return { ...env, HOME: home, USERPROFILE: home, FLEET_DIR: path.join(root, 'fleet'),
    CLAUDE_BIN: absent, CODEX_BIN: absent, AGY_BIN: absent, KIMI_BIN: absent, ...extra };
}

/** Run a program to its end. Resolves { code, signal, stdout, stderr, timedOut }. */
export function run(command, args, { input = '', env, cwd, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out = [], err = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/**
 * Start a relay (or any program that answers one JSON object per line) and talk to it.
 * Returns { child, send(message), receive(timeoutMs, complaint), exited(timeoutMs), stderr() }.
 */
export function talk(command, args, { env, cwd } = {}) {
  const child = spawn(command, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = [], waiting = [];
  let buffer = '', errText = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      if (waiting.length) waiting.shift()(line); else lines.push(line);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { errText += chunk; });
  child.stdin.on('error', () => {});
  const ended = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  return {
    child,
    stderr: () => errText,
    send(message) { child.stdin.write(JSON.stringify(message) + '\n'); },
    receive(timeoutMs = 3000, complaint = 'no answer in time') {
      if (lines.length) return Promise.resolve(JSON.parse(lines.shift()));
      return new Promise((resolve, reject) => {
        const take = line => { clearTimeout(timer); resolve(JSON.parse(line)); };
        const timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(take), 1);
          reject(new Error(complaint + '\n' + errText));
        }, timeoutMs);
        waiting.push(take);
      });
    },
    async exited(timeoutMs = 5000) {
      const result = await Promise.race([ended, sleep(timeoutMs).then(() => null)]);
      if (!result) throw new Error('still running after ' + timeoutMs + ' ms\n' + errText);
      return result;
    },
    /** For the end of a check: close it down whatever state it is in. */
    async close() {
      try { child.stdin.end(); } catch { /* closed */ }
      if (child.exitCode === null && child.signalCode === null) {
        const result = await Promise.race([ended, sleep(3000).then(() => null)]);
        if (!result) { child.kill('SIGKILL'); await ended; }
      }
    },
  };
}
