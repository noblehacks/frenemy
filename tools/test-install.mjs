#!/usr/bin/env node
// Fresh-home install, refusal to overwrite, and installed MCP/CLI path smoke tests.
// Plain node assertions, no test framework. Run: node tools/test-install.mjs
//
// The release is copied to a temp folder first and gets a manifest of its own there, so this
// test does not depend on MANIFEST.json in the source folder being up to date. Every home
// folder is a temp folder; no real settings file is read or written and no real AI app starts.
import assert from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WIN, processSnapshot, stopProcessTree } from './platform.mjs';

const ROOT = path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))));
const join = path.join;
const SEATS = ['claude', 'codex', 'agy', 'kimi'];

let passed = 0, failed = 0, skipped = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (error) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + String((error && error.message) || error).split('\n').slice(0, 12).join('\n       '));
  }
}
function skip(name, why) { skipped++; console.log('  skip ' + name + ' (' + why + ')'); }
async function group(name, fn) {
  console.log(name);
  try { await fn(); }
  catch (error) {
    failed++;
    console.log('  FAIL ' + name + ' stopped early\n       ' + String((error && error.stack) || error).split('\n').slice(0, 8).join('\n       '));
  }
}

const read = file => fs.readFileSync(file, 'utf8');
const write = (file, text) => fs.writeFileSync(file, text);
const readJson = file => JSON.parse(read(file));
const mkdir = dir => { fs.mkdirSync(dir, { recursive: true }); return dir; };
const tempDir = prefix => fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), prefix)));
const modeOf = file => fs.statSync(file).mode & 0o7777;
const startsWithIn = (dir, start) => fs.readdirSync(dir).filter(name => name.startsWith(start));
const noStack = text => !/\n\s+at .+:\d+:\d+\)?/.test(text);
const sorted = list => [...list].sort();

function copyRelease(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    if (item.name === '.git' || item.name === '__pycache__' || item.name === '.DS_Store' || item.name.endsWith('.pyc')) continue;
    const a = join(from, item.name), b = join(to, item.name);
    if (item.isDirectory()) copyRelease(a, b);
    else if (item.isFile()) { fs.copyFileSync(a, b); if (!WIN) fs.chmodSync(b, fs.statSync(a).mode & 0o7777); }
  }
}
function canLink(dir) {
  try { fs.symlinkSync(dir, join(dir, 'link-probe')); fs.unlinkSync(join(dir, 'link-probe')); return true; }
  catch { return false; }
}

// ---- stand-ins for the AI apps -------------------------------------------------------------
// Small Node scripts. Unlike a script that only prints success, the Claude and Codex ones keep
// their connections in the same files the real commands were observed to use
// (~/.claude.json or $CLAUDE_CONFIG_DIR/.claude.json; ~/.codex/config.toml or
// $CODEX_HOME/config.toml), so a broken install cannot pass.
const HOME_OF = "(process.env.HOME || process.env.USERPROFILE)";
const FAKE_CLAUDE = `const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
fs.appendFileSync(@LOG@, 'claude ' + a.join(' ') + '\\n');
if (a[0] === 'mcp') {
  const p = path.join(process.env.CLAUDE_CONFIG_DIR || ${HOME_OF}, '.claude.json');
  const d = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  const t = d.mcpServers = d.mcpServers || {};
  if (a[1] === 'add-json') t[a[4]] = JSON.parse(a[5]);
  else if (a[1] === 'remove') delete t[a[4]];
  fs.writeFileSync(p, JSON.stringify(d)); process.exit(0);
}
console.log(@ANSWER@);
`;
const FAKE_CODEX = `const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
fs.appendFileSync(@LOG@, 'codex ' + a.join(' ') + '\\n');
if (a[0] === 'mcp') {
  const d = process.env.CODEX_HOME || path.join(${HOME_OF}, '.codex');
  fs.mkdirSync(d, { recursive: true }); const p = path.join(d, 'config.toml');
  const lines = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').match(/[^\\n]*\\n|[^\\n]+$/g) || [] : [];
  const name = a[2], out = []; let skip = false;
  for (const line of lines) {
    if (line.trimStart().startsWith('[')) skip = ['[mcp_servers.' + name + ']', '[mcp_servers.' + name + '.env]'].includes(line.trim());
    if (!skip) out.push(line);
  }
  if (a[1] === 'add') {
    let rest = a.slice(3); const env = {};
    while (rest.length && rest[0] === '--env') { const i = rest[1].indexOf('='); env[rest[1].slice(0, i)] = rest[1].slice(i + 1); rest = rest.slice(2); }
    rest = rest.slice(1);
    out.push('\\n[mcp_servers.' + name + ']\\ncommand = ' + JSON.stringify(rest[0]) + '\\nargs = [' + rest.slice(1).map(x => JSON.stringify(x)).join(', ') + ']\\n[mcp_servers.' + name + '.env]\\n');
    for (const [k, v] of Object.entries(env)) out.push(k + ' = ' + JSON.stringify(v) + '\\n');
  }
  fs.writeFileSync(p, out.join('')); process.exit(0);
}
console.log(@ANSWER@);
`;
const fakeOther = seat => `require('fs').appendFileSync(@LOG@, '${seat} ' + process.argv.slice(2).join(' ') + '\\n');
console.log(@ANSWER@);
`;
const SAYS_YES = 'process.exit(0);\n';

/** Write a stand-in app into `dir` and return the path to give as NAME_BIN. */
function fakeApp(dir, name, source, log = '', answer = '') {
  const code = source.replace(/@LOG@/g, () => JSON.stringify(String(log))).replace(/@ANSWER@/g, () => JSON.stringify(answer));
  if (WIN) {
    write(join(dir, name + '-fake.js'), code);
    write(join(dir, name + '.cmd'), '@echo off\r\nnode "%~dp0\\' + name + '-fake.js" %*\r\n');
    return join(dir, name + '.cmd');
  }
  write(join(dir, name), '#!/usr/bin/env node\n' + code);
  fs.chmodSync(join(dir, name), 0o755);
  return join(dir, name);
}

// ---- the release under test: a temp copy with its own manifest -----------------------------
const WORK = tempDir('frenemy-install-src-');
const SRC = join(WORK, 'frenemy-2.0.0');
copyRelease(ROOT, SRC);
const made = spawnSync(process.execPath, [join(SRC, 'tools', 'manifest.mjs')], { encoding: 'utf8' });
if (made.status !== 0) {
  console.log('  FAIL could not write a manifest for the temp copy: ' + made.stderr);
  process.exit(1);
}
const INSTALL = join(SRC, 'install.mjs');

// Nothing in this process may see the real home folder or the real apps' folder overrides.
const SAFE_HOME = mkdir(join(WORK, 'unused home'));
const cleanEnv = () => {
  const env = { ...process.env, HOME: SAFE_HOME, USERPROFILE: SAFE_HOME, FLEET_DIR: join(SAFE_HOME, 'fleet') };
  delete env.CLAUDE_CONFIG_DIR; delete env.CODEX_HOME;
  return env;
};
Object.assign(process.env, { HOME: SAFE_HOME, USERPROFILE: SAFE_HOME, FLEET_DIR: join(SAFE_HOME, 'fleet') });
delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CODEX_HOME;
const installer = await import(pathToFileURL(INSTALL).href);

const runInstall = (args, env, timeout = 60000) =>
  spawnSync(process.execPath, [INSTALL, ...args], { env, encoding: 'utf8', timeout });
const homeEnv = (home, extra = {}) => ({ ...cleanEnv(), HOME: home, USERPROFILE: home, FLEET_DIR: join(home, 'fleet'), ...extra });
const mine = { type: 'command', command: '/usr/bin/true mine' };
const LINKS = canLink(WORK);
/** Every "command" text anywhere inside a settings value. */
function commandsOf(value, found = []) {
  if (Array.isArray(value)) for (const child of value) commandsOf(child, found);
  else if (value && typeof value === 'object') {
    if (typeof value.command === 'string') found.push(value.command);
    for (const child of Object.values(value)) commandsOf(child, found);
  }
  return found;
}

/** The reporter command a correct installer registers, written out by hand. */
function expectedReporter(node, prefix, driver, word) {
  const file = driver === 'claude' ? 'claude-beat.mjs' : 'agent-beat.mjs';
  const tail = [driver === 'claude' ? '' : driver, word].filter(Boolean).map(part => ' ' + part).join('');
  if (WIN) return 'node "' + join(prefix, 'snitch', 'hooks', file).replace(/\\/g, '/') + '"' + tail;
  return "'" + node + "' '" + prefix + '/snitch/hooks/' + file + "'" + tail;
}

function waitExit(child, ms) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(true); return; }
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

/** Start one installed connection, ask it one question, and return its reply. */
function askServer(item, seat, home) {
  return new Promise((resolve, reject) => {
    // Windows programs need a few of the system's own variables; an AI app passes them on too.
    const system = {};
    if (WIN) for (const name of ['SystemRoot', 'windir', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA']) {
      if (process.env[name] !== undefined) system[name] = process.env[name];
    }
    const child = spawn(item.command, item.args, { cwd: home, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...system, ...item.env, HOME: home, USERPROFILE: home, FLEET_DIR: join(home, 'fleet') } });
    let out = '', err = '', done = false;
    const finish = async (error, reply) => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { child.stdin.end(); } catch { /* already closed */ }
      if (!(await waitExit(child, 10000))) await stopProcessTree(child.pid);
      if (error) reject(error); else resolve(reply);
    };
    const timer = setTimeout(() => finish(new Error(seat + ' did not answer')), 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      out += chunk;
      const end = out.indexOf('\n');
      if (end < 0) return;
      try { finish(null, JSON.parse(out.slice(0, end))); } catch (error) { finish(error); }
    });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => finish(error));
    child.on('exit', () => setTimeout(() => finish(new Error(seat + ' ended without an answer: ' + err.slice(0, 300))), 200));
    child.stdin.on('error', () => {});
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'ask_' + seat, arguments: { prompt: 'fixture', working_directory: home } } };
    child.stdin.write(JSON.stringify(request) + '\n');
  });
}

// ============================================================================================
await group('Checking the download (--check) and the launchers', async () => {
  const home = mkdir(join(WORK, 'check home'));
  const result = runInstall(['--check'], homeEnv(home));
  await check('--check passes on an intact download', () => assert.strictEqual(result.status, 0, result.stdout + result.stderr));
  await check('--check says in plain words that Node 18 is needed and Python is not', () => {
    assert.match(result.stdout, /Node\.js 18 or newer/);
    assert.doesNotMatch(result.stdout, /Python|WSL/);
  });
  await check('--check writes nothing', () => assert.deepStrictEqual(fs.readdirSync(home), []));
  // The launcher gets a home folder and a working folder of its own. Windows PowerShell itself
  // puts an AppData folder into a home folder it has not seen before (it does so even when asked
  // only to print the number 1), and that must not count against the installer in the checks below.
  const launcherHome = mkdir(join(WORK, 'launcher home')), launcherFolder = mkdir(join(WORK, 'launcher folder'));
  const launcher = WIN
    ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(SRC, 'install.ps1'), '--check'],
      { env: homeEnv(launcherHome), cwd: launcherFolder, encoding: 'utf8', timeout: 60000 })
    : spawnSync('sh', [join(SRC, 'install.sh'), '--check'], { env: homeEnv(launcherHome), cwd: launcherFolder, encoding: 'utf8', timeout: 60000 });
  await check((WIN ? 'install.ps1' : 'install.sh') + ' hands the same options to install.mjs', () => {
    assert.strictEqual(launcher.status, 0, launcher.stdout + launcher.stderr);
    assert.match(launcher.stdout, /This download is intact/);
  });
  await check((WIN ? 'install.ps1 --check writes nothing but PowerShell\'s own AppData folder' : 'install.sh --check writes nothing'), () => {
    assert.deepStrictEqual(fs.readdirSync(launcherHome).filter(name => !(WIN && name === 'AppData')), []);
    if (!WIN) assert.deepStrictEqual(fs.readdirSync(launcherFolder), []);
  });
  if (!WIN) {
    // A PATH with no node on it: the launcher says what to install, in one line.
    const none = spawnSync('/bin/sh', [join(SRC, 'install.sh'), '--check'], { env: { ...homeEnv(home), PATH: mkdir(join(WORK, 'empty bin')) }, encoding: 'utf8', timeout: 30000 });
    await check('install.sh without node says what to install', () => {
      assert.strictEqual(none.status, 1, none.stdout + none.stderr);
      assert.match(none.stdout, /Node\.js 18 or newer/); assert.match(none.stdout, /https:\/\/nodejs\.org/);
      assert.strictEqual(none.stdout.trim().split('\n').length, 1);
    });
  } else skip('install.sh without node says what to install', 'Mac and Linux only');
  const help = runInstall(['--help'], homeEnv(home));
  await check('--help lists the options', () => {
    assert.strictEqual(help.status, 0);
    for (const option of ['--check', '--no-connect', '--no-snitch', '--prefix', '--extension-dir']) assert.ok(help.stdout.includes(option), option);
  });
  const wrong = runInstall(['--nonsense'], homeEnv(home));
  await check('an unknown option stops with a plain line and changes nothing', () => {
    assert.strictEqual(wrong.status, 2); assert.match(wrong.stderr, /Unknown option: --nonsense/); assert.ok(noStack(wrong.stderr));
    assert.deepStrictEqual(fs.readdirSync(home), []);
  });
  // A changed file is caught.
  const tampered = join(WORK, 'tampered');
  copyRelease(SRC, tampered);
  fs.appendFileSync(join(tampered, 'LICENSE'), 'x');
  const bad = spawnSync(process.execPath, [join(tampered, 'install.mjs'), '--check'], { env: homeEnv(home), encoding: 'utf8', timeout: 60000 });
  await check('--check fails on a changed file and names it', () => {
    assert.strictEqual(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /Installation stopped: Release integrity check failed: LICENSE/);
    assert.ok(noStack(bad.stderr));
  });
});

// ============================================================================================
await group('Symlinks, Finder metadata and a failed preparation', async () => {
  const base = tempDir('frenemy-installer-edges-');
  if (LINKS) {
    const target = join(base, 'version-1'); write(target, '#!/bin/sh\nexit 0\n'); fs.chmodSync(target, 0o755);
    const link = join(base, 'stable-link'); fs.symlinkSync(target, link);
    await check('an app reached through a stable link keeps the link path', () => {
      const was = process.env.CLAUDE_BIN;
      process.env.CLAUDE_BIN = link;
      try { assert.strictEqual(installer.executable('claude'), link); }
      finally { if (was === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = was; }
    });
  } else skip('an app reached through a stable link keeps the link path', 'this system does not allow links here');
  const copied = join(base, 'source'); copyRelease(SRC, copied);
  write(join(copied, '.DS_Store'), 'Finder metadata');
  await check('Finder metadata does not fail the integrity check', () => installer.verify(copied));
  await check('the manifest tool leaves Finder metadata out', () => {
    const again = spawnSync(process.execPath, [join(copied, 'tools', 'manifest.mjs')], { encoding: 'utf8' });
    assert.strictEqual(again.status, 0, again.stderr);
    assert.ok(!('.DS_Store' in readJson(join(copied, 'MANIFEST.json')).files));
  });
  await check('the manifest tool writes the same bytes each time, with / in every name', () => {
    const first = read(join(copied, 'MANIFEST.json'));
    assert.strictEqual(spawnSync(process.execPath, [join(copied, 'tools', 'manifest.mjs')]).status, 0);
    assert.strictEqual(read(join(copied, 'MANIFEST.json')), first);
    const names = Object.keys(JSON.parse(first).files);
    assert.ok(names.includes('tools/manifest.mjs') && names.includes('install.mjs') && !names.some(name => name.includes('\\')));
    assert.strictEqual(JSON.parse(first).version, '2.0.0');
  });
  if (LINKS) {
    fs.symlinkSync(base, join(copied, 'untracked-link'), 'dir');
    await check('a link inside the release is refused', () => assert.throws(() => installer.verify(copied), /symlink/));
    await check('the manifest tool refuses to package links', () => {
      const refused = spawnSync(process.execPath, [join(copied, 'tools', 'manifest.mjs')], { encoding: 'utf8' });
      assert.strictEqual(refused.status, 1); assert.match(refused.stderr, /Refusing to package symlinks/);
    });
  } else {
    skip('a link inside the release is refused', 'this system does not allow links here');
    skip('the manifest tool refuses to package links', 'this system does not allow links here');
  }
  const prefix = join(base, 'destination');
  const injected = Object.assign(new Error('injected preparation failure'), { code: 'EIO' });
  await check('a failure while preparing is passed on', () =>
    assert.rejects(installer.main(['--prefix', prefix], { generate: () => { throw injected; } }), /injected/));
  await check('a failed preparation leaves no install folder', () => assert.ok(!fs.existsSync(prefix)));
  await check('a failed preparation keeps its staging folder for inspection', () =>
    assert.ok(startsWithIn(base, 'destination.staging-').length > 0));
});

// ============================================================================================
await group('Clean install and all generated routes (home folder with a space in its path)', async () => {
  const base = tempDir('frenemy-install-');
  const home = mkdir(join(base, 'fresh home'));
  const prefix = join(home, 'runtime with spaces'), extension = join(home, 'extensions', 'snitch');
  const env = homeEnv(home);
  const calls = join(base, 'cli-calls.log');
  for (const seat of SEATS) {
    const answer = { claude: JSON.stringify({ result: 'fixture answer' }), kimi: JSON.stringify({ role: 'assistant', content: 'fixture answer' }) }[seat] || 'fixture answer';
    const source = seat === 'claude' ? FAKE_CLAUDE : seat === 'codex' ? FAKE_CODEX : fakeOther(seat);
    env[seat.toUpperCase() + '_BIN'] = fakeApp(base, seat + '-not-on-path', source, calls, answer);
  }
  // Settings the person already had. None of it may be lost or reworded.
  for (const folder of ['.claude', '.codex', join('.gemini', 'config'), '.kimi-code']) mkdir(join(home, folder));
  write(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'keep', hooks: { Stop: [{ matcher: '*', hooks: [mine] }] } }));
  write(join(home, '.codex', 'hooks.json'), JSON.stringify({ hooks: { PostToolUse: [{ matcher: '', hooks: [mine] }] } }));
  write(join(home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { other: { command: 'x', args: ['y'] }, codex: { command: 'mine', args: ['my-own-server'] } } }));
  write(join(home, '.gemini', 'config', 'hooks.json'), JSON.stringify({ 'other-tool': { Stop: [mine] } }));
  write(join(home, '.kimi-code', 'mcp.json'), JSON.stringify({ mcpServers: { claude: { command: 'old', args: ['/old/frenemy/ask-claude-mcp.mjs'] } } }));
  const kimiBefore = '# my comment\ndefault_model = "keep"\n\n[[hooks]]\nevent = "Stop"\ncommand = "/usr/bin/true mine"\n';
  write(join(home, '.kimi-code', 'config.toml'), kimiBefore);
  const args = ['--prefix', prefix, '--extension-dir', extension];

  // First: the look-only mode changes no settings at all.
  const quiet = runInstall(['--prefix', join(home, 'look only'), '--no-snitch', '--no-connect'], env, 30000);
  await check('--no-connect installs', () => assert.strictEqual(quiet.status, 0, quiet.stderr));
  await check('--no-connect changes no settings', () => assert.strictEqual(read(join(home, '.kimi-code', 'config.toml')), kimiBefore));
  await check('--no-connect runs no app command', () => assert.ok(!fs.existsSync(calls)));
  await check('--no-connect says where the entries are', () => assert.match(quiet.stdout, /No app settings were changed\. The entries to add are in /));

  const result = runInstall(args, env);
  await check('the install succeeds', () => assert.strictEqual(result.status, 0, result.stdout + result.stderr));
  await check('all four apps are connected', () => assert.ok(result.stdout.includes('Connected to each other: Claude, Codex, Gemini (agy), Kimi'), result.stdout));
  await check('the Snitch panel is copied whole', () =>
    assert.ok(fs.readFileSync(join(extension, 'extension.js')).equals(fs.readFileSync(join(SRC, 'snitch', 'extension', 'extension.js')))));
  // Claude and Codex are connected through their own commands.
  const log = fs.existsSync(calls) ? read(calls) : '';
  await check('Claude is connected through its own command', () => { for (const name of ['codex', 'agy', 'kimi']) assert.ok(log.includes('claude mcp add-json -s user ' + name + ' '), name); });
  await check('Codex is connected through its own command', () => { for (const name of ['claude', 'agy', 'kimi']) assert.ok(log.includes('codex mcp add ' + name + ' --env '), name); });
  await check('nothing was removed on a first install', () => assert.ok(!log.includes('mcp remove')));
  await check('Claude lists the three others', () => assert.deepStrictEqual(sorted(Object.keys(readJson(join(home, '.claude.json')).mcpServers)), ['agy', 'codex', 'kimi']));
  await check('Codex lists the three others', () =>
    assert.deepStrictEqual(sorted(Object.keys(installer.parseToml(read(join(home, '.codex', 'config.toml'))).mcp_servers)), ['agy', 'claude', 'kimi']));
  // Hooks are added beside the person's own, never instead of them.
  const claude = readJson(join(home, '.claude', 'settings.json'));
  await check("Claude's own settings are kept", () => assert.strictEqual(claude.model, 'keep'));
  await check('Claude gets its four reporter events', () => assert.deepStrictEqual(sorted(Object.keys(claude.hooks)), ['PostToolUse', 'SessionEnd', 'Stop', 'UserPromptSubmit']));
  await check("Claude's own hook stays first, the reporter is added beside it", () => {
    assert.deepStrictEqual(claude.hooks.Stop[0].hooks[0], mine); assert.strictEqual(claude.hooks.Stop.length, 2);
  });
  const codex = readJson(join(home, '.codex', 'hooks.json')).hooks;
  await check("Codex's own hook stays, the reporter is added beside it", () => {
    assert.deepStrictEqual(codex.PostToolUse[0].hooks[0], mine); assert.strictEqual(codex.PostToolUse.length, 2);
  });
  const kimiText = read(join(home, '.kimi-code', 'config.toml'));
  await check('Kimi gets its reporters', () => assert.ok(installer.parseToml(kimiText).hooks.map(hook => hook.event).includes('StopFailure')));
  await check("Kimi's settings text is kept as it was, with the reporters after it", () => assert.ok(kimiText.startsWith(kimiBefore)));
  const agyHooks = readJson(join(home, '.gemini', 'config', 'hooks.json'));
  await check("agy keeps another tool's hooks and gets the reporter", () => {
    assert.deepStrictEqual(agyHooks['other-tool'], { Stop: [mine] }); assert.ok('PostToolUse' in agyHooks.snitch);
  });
  // A server of the person's own with one of our names is left alone and said so;
  // an older Frenemy entry is refreshed.
  const agy = readJson(join(home, '.gemini', 'config', 'mcp_config.json')).mcpServers;
  await check('a server of your own named "codex" is left alone', () => {
    assert.deepStrictEqual(agy.codex, { command: 'mine', args: ['my-own-server'] }); assert.ok('other' in agy);
    assert.deepStrictEqual(sorted(Object.keys(agy)), ['claude', 'codex', 'kimi', 'other']);
  });
  await check('and the installer says so', () => assert.ok(result.stdout.includes('left your own "codex" entry'), result.stdout));
  const kimi = readJson(join(home, '.kimi-code', 'mcp.json')).mcpServers;
  await check("an older Frenemy's connection is refreshed", () => assert.deepStrictEqual(kimi.claude.args, [join(prefix, 'tools', 'ask-claude-mcp.mjs')]));
  // Every changed file has a copy of how it was.
  for (const [folder, name] of [['.claude', 'settings.json'], ['.codex', 'hooks.json'], [join('.gemini', 'config'), 'mcp_config.json'],
    [join('.gemini', 'config'), 'hooks.json'], ['.kimi-code', 'mcp.json'], ['.kimi-code', 'config.toml']]) {
    await check('a backup copy exists for ' + name + ' in ' + folder, () => assert.ok(startsWithIn(join(home, folder), name + '.before-frenemy-').length > 0));
  }
  await check('the backup holds the file as it was', () =>
    assert.strictEqual(read(join(home, '.kimi-code', startsWithIn(join(home, '.kimi-code'), 'config.toml.before-frenemy-')[0])), kimiBefore));
  await check('each backup is printed', () => assert.match(result.stdout, /Backup of .*settings\.json -> settings\.json\.before-frenemy-\d{8}-\d{6}/));

  // The reporter commands, with a space in every path.
  const node = fs.existsSync(join(prefix, 'config', 'dependencies.json')) ? readJson(join(prefix, 'config', 'dependencies.json')).node : '';
  await check('the reporter command is written the expected way for a folder with a space', () => {
    const stop = claude.hooks.Stop[1].hooks[0].command;
    assert.strictEqual(stop, expectedReporter(node, prefix, 'claude', 'done'));
    const words = installer.shSplit(stop);
    assert.strictEqual(words.length, 3);
    assert.strictEqual(words[1].replace(/\\/g, '/'), join(prefix, 'snitch', 'hooks', 'claude-beat.mjs').replace(/\\/g, '/'));
    assert.strictEqual(words[2], 'done');
    assert.strictEqual(codex.PostToolUse[1].hooks[0].command, expectedReporter(node, prefix, 'codex', ''));
    assert.strictEqual(agyHooks.snitch.Stop[0].command, expectedReporter(node, prefix, 'agy', 'done'));
    assert.ok(installer.parseToml(kimiText).hooks.some(hook => hook.event === 'StopFailure' && hook.command === expectedReporter(node, prefix, 'kimi', 'fail')));
  });
  await check('the connections use a full node path and the .mjs file', () => {
    const item = readJson(join(home, '.claude.json')).mcpServers.codex;
    assert.ok(path.isAbsolute(item.command)); assert.strictEqual(item.command, node);
    assert.deepStrictEqual(item.args, [join(prefix, 'tools', 'ask-codex-mcp.mjs')]);
    assert.strictEqual(item.env.FRENEMY_DRIVER, 'claude'); assert.strictEqual(item.type, 'stdio');
  });

  // Running it again is safe: nothing is copied over, nothing is added twice.
  const sentinel = join(prefix, 'sentinel');
  if (fs.existsSync(prefix)) write(sentinel, 'keep me');
  const settingsOnce = read(join(home, '.claude', 'settings.json')), kimiOnce = read(join(home, '.kimi-code', 'config.toml'));
  const backupsOnce = fs.readdirSync(join(home, '.claude')).length;
  const again = runInstall(args, env);
  await check('a second run succeeds', () => assert.strictEqual(again.status, 0, again.stdout + again.stderr));
  await check('a second run copies nothing over the install', () => assert.strictEqual(read(sentinel), 'keep me'));
  await check('a second run says it is already installed', () => assert.ok(again.stdout.includes('Already installed')));
  await check("a second run leaves Claude's settings byte for byte", () => assert.strictEqual(read(join(home, '.claude', 'settings.json')), settingsOnce));
  await check("a second run leaves Kimi's settings byte for byte", () => assert.strictEqual(read(join(home, '.kimi-code', 'config.toml')), kimiOnce));
  await check('a second run makes no new backup of an unchanged file', () => assert.strictEqual(fs.readdirSync(join(home, '.claude')).length, backupsOnce));
  await check('a second run leaves the Snitch panel as it is and says so', () => assert.ok(again.stdout.includes('Snitch is already at ')));
  // A different folder already sitting at the destination is never written into.
  const foreign = mkdir(join(home, 'someone elses folder')); write(join(foreign, 'file'), 'theirs');
  const refuse = runInstall(['--prefix', foreign, '--no-snitch'], env, 30000);
  await check("someone else's folder at the destination is refused and untouched", () => {
    assert.notStrictEqual(refuse.status, 0); assert.strictEqual(read(join(foreign, 'file')), 'theirs');
    assert.deepStrictEqual(fs.readdirSync(foreign), ['file']);
    assert.match(refuse.stderr, /Installation stopped: Destination exists and is not this release/);
  });
  await check('installing inside the unpacked download is refused', () => {
    const inside = runInstall(['--prefix', join(SRC, 'inside'), '--no-snitch', '--no-connect'], env, 30000);
    assert.strictEqual(inside.status, 1); assert.match(inside.stderr, /Install outside the unpacked release directory/);
    assert.ok(!fs.existsSync(join(SRC, 'inside')));
  });

  for (const driver of SEATS) {
    await check('config/' + driver + '-mcp.json lists the three others', () => {
      const config = readJson(join(prefix, 'config', driver + '-mcp.json')).mcpServers;
      assert.deepStrictEqual(sorted(Object.keys(config)), sorted(SEATS.filter(seat => seat !== driver)));
    });
  }
  await check('config/codex-mcp.toml can be read and lists the three others', () =>
    assert.deepStrictEqual(sorted(Object.keys(installer.parseToml(read(join(prefix, 'config', 'codex-mcp.toml'))).mcp_servers)), ['agy', 'claude', 'kimi']));
  await check('config/kimi-hooks.toml holds seven reporters', () =>
    assert.strictEqual(installer.parseToml(read(join(prefix, 'config', 'kimi-hooks.toml'))).hooks.length, 7));
  await check('config/claude-hooks.json has the four events with their words', () => {
    const hooks = readJson(join(prefix, 'config', 'claude-hooks.json')).hooks;
    assert.deepStrictEqual(sorted(Object.keys(hooks)), ['PostToolUse', 'SessionEnd', 'Stop', 'UserPromptSubmit']);
    assert.ok(hooks.UserPromptSubmit[0].hooks[0].command.endsWith(' beat'));
    assert.ok(hooks.SessionEnd[0].hooks[0].command.endsWith(' done'));
  });
  for (const seat of SEATS) {
    await check('the installed connection to ' + seat + ' answers', async () => {
      const driver = seat !== 'codex' ? 'codex' : 'claude';
      const item = readJson(join(prefix, 'config', driver + '-mcp.json')).mcpServers[seat];
      const reply = await askServer(item, seat, home);
      assert.ok(!reply.result.isError, JSON.stringify(reply));
      assert.ok(reply.result.content[0].text.includes('fixture answer'), JSON.stringify(reply));
    });
  }
  await check('each of the four questions left a finished job row', () => {
    const jobs = join(home, 'fleet', 'jobs');
    const rows = fs.readdirSync(jobs).filter(name => name.endsWith('.json')).map(name => readJson(join(jobs, name)));
    assert.strictEqual(rows.length, 4); assert.ok(rows.every(row => row.state === 'done'), JSON.stringify(rows.map(row => row.state)));
  });
  for (const seat of SEATS) {
    await check('the installed reporter for ' + seat + ' runs', () => {
      const hook = join(prefix, 'snitch', 'hooks', seat === 'claude' ? 'claude-beat.mjs' : 'agent-beat.mjs');
      assert.ok(fs.existsSync(hook), 'missing: ' + path.relative(prefix, hook));
      const payload = { session_id: 'install-' + seat, cwd: home, tool_name: 'Read', tool_input: {} };
      const run = spawnSync(process.execPath, [hook, ...(seat === 'claude' ? [] : [seat])], { input: JSON.stringify(payload), env, encoding: 'utf8', timeout: 10000 });
      assert.strictEqual(run.status, 0, run.stderr);
    });
  }
  console.log('Retained install fixture:', base);
});

// ============================================================================================
// Found by an independent audit (2026-11-15): each case once damaged a person's settings.
await group('Upgrade from an older Frenemy, permissions and half-way failures', async () => {
  const base = tempDir('frenemy-install-hard-');
  const home = mkdir(join(base, 'home \u{1F600}'));
  const env = homeEnv(home);
  for (const seat of ['agy', 'kimi']) env[seat.toUpperCase() + '_BIN'] = fakeApp(base, seat, SAYS_YES);
  env.CLAUDE_BIN = fakeApp(base, 'claude', FAKE_CLAUDE, join(base, 'calls.log'), 'x');
  const lookalike = { type: 'command', command: 'echo /x/snitch/hooks/agent-beat.sh' };    // the person's own: only mentions the name
  const lookalike2 = { type: 'command', command: 'echo /x/snitch/hooks/agent-beat.mjs' };  // the same, for the Node reporter's name
  // Codex's own command takes the old entry out, then fails to put the new one in.
  env.CODEX_BIN = fakeApp(base, 'codex', `const a = process.argv.slice(2);
if (a[1] === 'remove') { require('fs').writeFileSync(${JSON.stringify(join(home, '.codex', 'config.toml'))}, ''); process.exit(0); }
console.error('add refused'); process.exit(1);
`);
  for (const folder of ['.claude', '.codex', join('.gemini', 'config'), '.kimi-code']) mkdir(join(home, folder));
  const old = "'/old place/frenemy/snitch/hooks/claude-beat.sh'";
  write(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: {
    Stop: [{ matcher: '*', hooks: [{ type: 'command', command: old + ' done' }] }, { matcher: '*', hooks: [mine] }],
    PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: old }, mine, lookalike, lookalike2] }] } }));
  if (!WIN) fs.chmodSync(join(home, '.claude', 'settings.json'), 0o600);
  const codexBefore = '[mcp_servers.claude]\ncommand = "node"\nargs = ["/old place/frenemy/ask-claude-mcp.mjs"]\n';
  write(join(home, '.codex', 'config.toml'), codexBefore);
  write(join(home, '.codex', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: [mine] }] } }));
  write(join(home, '.gemini', 'config', 'hooks.json'), '{"keep":1}');
  write(join(home, '.gemini', 'config', 'mcp_config.json'), '{"mcpServers":[]}');      // wrong shape
  const kimiBefore = '# mine\n[[hooks]]\nevent = "Stop"\ncommand = "\\"/old place/frenemy/snitch/hooks/agent-beat.sh\\" kimi done"\n\n' +
    '[[hooks]]\nevent = "Stop"\ncommand = "/usr/bin/true mine"\n\n[[hooks]]\nevent = "Stop"\ncommand = "echo /x/snitch/hooks/agent-beat.sh"\n\n[other]\nkey = 1\n';
  write(join(home, '.kimi-code', 'config.toml'), kimiBefore);
  write(join(home, '.kimi-code', 'mcp.json'), '{}');
  if (!WIN) fs.chmodSync(join(home, '.kimi-code', 'mcp.json'), 0o600);
  const rt = join(home, 'rt');
  const result = runInstall(['--prefix', rt, '--no-snitch'], env);
  await check('a run with two failing apps ends with exit code 1', () => assert.strictEqual(result.status, 1, result.stdout + result.stderr));
  await check('no stack trace is shown', () => assert.ok(noStack(result.stderr), result.stderr));
  await check('the two healthy apps are connected', () => assert.ok(result.stdout.includes('Connected to each other: Claude, Kimi'), result.stdout));
  // Codex: the failed swap is undone, both of its files are as they were.
  await check('Codex: the failure is reported with its own words', () => {
    assert.ok(result.stdout.includes('Could not connect Codex'));
    assert.match(result.stdout, /Could not connect Codex: add refused \(its settings were put back as they were\) - its entries are in /);
  });
  await check('Codex: the half-done swap is undone', () => assert.strictEqual(read(join(home, '.codex', 'config.toml')), codexBefore));
  await check("Codex: its hooks file is as it was", () =>
    assert.deepStrictEqual(readJson(join(home, '.codex', 'hooks.json')), { hooks: { Stop: [{ matcher: '', hooks: [mine] }] } }));
  // agy: a file in the wrong shape is a plain message, and its other file is untouched.
  await check('agy: a file in the wrong shape is a plain message', () => assert.ok(result.stdout.includes('Could not connect Gemini (agy)')));
  await check("agy: its hooks file is untouched", () => assert.strictEqual(read(join(home, '.gemini', 'config', 'hooks.json')), '{"keep":1}'));
  await check("agy: its server file is untouched", () => assert.strictEqual(read(join(home, '.gemini', 'config', 'mcp_config.json')), '{"mcpServers":[]}'));
  // Claude: the old reporter is gone, exactly one new one per event, the person's own hooks stay
  // (also inside a group that held an old reporter, also one that only mentions the script's name),
  // and the file is still private.
  const node = fs.existsSync(join(rt, 'config', 'dependencies.json')) ? readJson(join(rt, 'config', 'dependencies.json')).node : '';
  const hooks = readJson(join(home, '.claude', 'settings.json')).hooks;
  await check("Claude: the older Frenemy's .sh reporter is replaced by the new one, with no duplicate", () => {
    const stops = hooks.Stop.flatMap(group_ => group_.hooks.map(hook => hook.command));
    assert.deepStrictEqual(sorted(stops), sorted(['/usr/bin/true mine', expectedReporter(node, rt, 'claude', 'done')]));
    assert.ok(!JSON.stringify(hooks).includes('.sh\''), 'an old reporter is still there');
  });
  await check("Claude: your own hooks in the old reporter's group stay, look-alikes included", () => {
    assert.deepStrictEqual(hooks.PostToolUse[0].hooks, [mine, lookalike, lookalike2]);
    assert.strictEqual(hooks.PostToolUse.length, 2);
  });
  if (!WIN) {
    await check('Claude: a private settings file stays private', () => assert.strictEqual(modeOf(join(home, '.claude', 'settings.json')), 0o600));
    await check('Kimi: a private settings file stays private', () => assert.strictEqual(modeOf(join(home, '.kimi-code', 'mcp.json')), 0o600));
  } else {
    skip('Claude: a private settings file stays private', 'Windows has no such permission bits');
    skip('Kimi: a private settings file stays private', 'Windows has no such permission bits');
  }
  // Kimi: old reporter block removed, own hook and other tables kept, seven new reporters, emoji path valid.
  const kimiText = read(join(home, '.kimi-code', 'config.toml'));
  const kimi = installer.parseToml(kimiText);
  const commands = (kimi.hooks || []).map(hook => hook.command);
  await check('Kimi: other settings are kept', () => assert.ok(installer.same(kimi.other, { key: 1 })));
  await check('Kimi: your own hook is kept once', () => assert.strictEqual(commands.filter(command => command === '/usr/bin/true mine').length, 1));
  await check("Kimi: the older Frenemy's .sh reporter is gone", () => assert.deepStrictEqual(commands.filter(command => command.includes('/old place/')), []));
  await check('Kimi: a look-alike of your own is kept once', () => assert.strictEqual(commands.filter(command => command === 'echo /x/snitch/hooks/agent-beat.sh').length, 1));
  await check('Kimi: seven new reporters, nine hooks in all', () => {
    assert.strictEqual(commands.length, 9);
    assert.strictEqual(commands.filter(command => installer.isReporter(command)).length, 7);
    assert.strictEqual(new Set(commands).size, commands.length - 3);    // "done" is the word for four events
  });
  await check('Kimi: the text before the reporters is kept', () => assert.ok(kimiText.startsWith('# mine\n')));
  await check('Kimi: a path with an emoji is written and read back', () =>
    assert.ok(commands.includes(expectedReporter(node, rt, 'kimi', 'fail'))));
  // A hooks file in a shape nobody expects stops that app cleanly instead of crashing.
  for (const bad of ['{"hooks":[]}', '{"hooks":{"Stop":{}}}']) {
    write(join(home, '.claude', 'settings.json'), bad);
    const again = runInstall(['--prefix', rt, '--no-snitch'], env);
    await check('a hooks file shaped ' + bad + ' stops Claude cleanly and stays as it is', () => {
      assert.ok(noStack(again.stderr), again.stderr);
      assert.ok(again.stdout.includes('Could not connect Claude'), again.stdout);
      assert.strictEqual(read(join(home, '.claude', 'settings.json')), bad);
    });
  }
  console.log('Retained hard-case fixture:', base);
});

// ============================================================================================
// Custom settings folders, a command that lies, Ctrl-C, an empty Kimi list, exact restore.
await group('Second audit cases', async () => {
  const base = tempDir('frenemy-install-audit2-');
  const home = mkdir(join(base, 'home'));
  const log = join(base, 'calls.log');
  // 1. CLAUDE_CONFIG_DIR and CODEX_HOME: the installer works where the apps work.
  const nowhere = join(base, 'not-installed');
  const pathLeft = (process.env.PATH || process.env.Path || '').split(path.delimiter)
    .filter(dir => dir && !['agy', 'kimi'].some(name => fs.existsSync(join(dir, name)))).join(path.delimiter);
  mkdir(join(base, 'my claude')); mkdir(join(base, 'my codex'));
  const claudeBin = fakeApp(base, 'claude', FAKE_CLAUDE, log, 'x'), codexBin = fakeApp(base, 'codex', FAKE_CODEX, log, 'x');
  const env = homeEnv(home, { CLAUDE_CONFIG_DIR: join(base, 'my claude'), CODEX_HOME: join(base, 'my codex'),
    CLAUDE_BIN: claudeBin, CODEX_BIN: codexBin, AGY_BIN: nowhere, KIMI_BIN: nowhere, PATH: pathLeft });
  const result = runInstall(['--prefix', join(home, 'rt'), '--no-snitch'], env);
  await check('custom settings folders: the install succeeds', () => assert.strictEqual(result.status, 0, result.stdout + result.stderr));
  await check('two apps are enough', () => assert.ok(result.stdout.includes('Connected to each other: Claude, Codex'), result.stdout));
  await check('apps that are not installed are named', () => assert.ok(result.stdout.includes('Not found on this computer (skipped): Gemini (agy), Kimi'), result.stdout));
  await check('CLAUDE_CONFIG_DIR is used', () => {
    assert.deepStrictEqual(Object.keys(readJson(join(base, 'my claude', '.claude.json')).mcpServers), ['codex']);
    assert.ok(fs.existsSync(join(base, 'my claude', 'settings.json')));
  });
  await check('CODEX_HOME is used', () => assert.ok(fs.existsSync(join(base, 'my codex', 'hooks.json'))));
  await check('nothing is written to the default folders then', () => {
    for (const name of ['.claude.json', '.claude', '.codex']) assert.ok(!fs.existsSync(join(home, name)), name);
  });
  // 2. A command that says yes and writes nothing is not believed.
  const liar = fakeApp(base, 'liar', SAYS_YES);
  const home2 = join(base, 'home2'); mkdir(join(home2, '.claude'));
  write(join(home2, '.claude', 'settings.json'), '{"mine":true}');
  const env2 = homeEnv(home2, { CLAUDE_BIN: liar, CODEX_BIN: codexBin, AGY_BIN: nowhere, KIMI_BIN: nowhere, PATH: pathLeft });
  const lied = runInstall(['--prefix', join(home2, 'rt'), '--no-snitch'], env2);
  await check('a command that says yes and writes nothing is not believed', () => {
    assert.strictEqual(lied.status, 1, lied.stdout + lied.stderr);
    assert.ok(lied.stdout.includes('Could not connect Claude')); assert.ok(lied.stdout.includes('is not in .claude.json'), lied.stdout);
  });
  await check('and its settings are put back', () => assert.strictEqual(read(join(home2, '.claude', 'settings.json')), '{"mine":true}'));
  await check('one connected app is not enough, and the installer says so', () =>
    assert.ok(lied.stdout.includes('Frenemy needs at least two of the four AI apps. Found: Codex'), lied.stdout));
  // 3. Ctrl-C between taking the old connection out and putting the new one in.
  const home3 = join(base, 'home3'); mkdir(join(home3, '.codex'));
  const prefix = join(home2, 'rt');
  const before = '[mcp_servers.claude]\ncommand = "node"\nargs = ["/old/frenemy/ask-claude-mcp.mjs"]\n';
  write(join(home3, '.codex', 'config.toml'), before);
  if (!WIN) fs.chmodSync(join(home3, '.codex', 'config.toml'), 0o600);
  const swap = [];
  const interrupted = (binary, args) => {
    if (binary === claudeBin) throw new installer.Stop('claude is not the app under test here');
    swap.push(args[1]);
    if (args[1] === 'remove') { write(join(home3, '.codex', 'config.toml'), ''); return; }
    throw new installer.Interrupted();
  };
  await check('an interruption half-way is passed on', () => assert.rejects(
    installer.connect(prefix, { claude: claudeBin, codex: codexBin, agy: null, kimi: null }, home3, { node: process.execPath, run: interrupted }),
    installer.Interrupted));
  await check('the old entry really was taken out before the interruption', () => assert.deepStrictEqual(swap, ['remove', 'add']));
  await check("the interrupted app's settings are put back", () => assert.strictEqual(read(join(home3, '.codex', 'config.toml')), before));
  await check('a file made during the interrupted attempt is taken away again', () => assert.ok(!fs.existsSync(join(home3, '.codex', 'hooks.json'))));
  if (!WIN) await check('the restored file keeps its permissions', () => assert.strictEqual(modeOf(join(home3, '.codex', 'config.toml')), 0o600));
  else skip('the restored file keeps its permissions', 'Windows has no such permission bits');
  // 3b. The same with a real Ctrl-C signal sent to a running installer.
  if (!WIN) {
    const home3b = join(base, 'home3b'); mkdir(join(home3b, '.codex'));
    const before3b = '[mcp_servers.kimi]\ncommand = "node"\nargs = ["/old/frenemy/ask-kimi-mcp.mjs"]\n';
    write(join(home3b, '.codex', 'config.toml'), before3b);
    const slowLog = join(base, 'slow.log'), slowPid = join(base, 'slow.pid');
    const slow = fakeApp(base, 'slow-codex', `const fs = require('fs'); const a = process.argv.slice(2);
if (a[1] === 'remove') { fs.writeFileSync(${JSON.stringify(join(home3b, '.codex', 'config.toml'))}, ''); process.exit(0); }
fs.writeFileSync(${JSON.stringify(slowPid)}, String(process.pid)); fs.appendFileSync(${JSON.stringify(slowLog)}, 'adding\\n');
setTimeout(() => process.exit(0), 30000);
`);
    const env3 = homeEnv(home3b, { CLAUDE_BIN: nowhere, CODEX_BIN: slow, AGY_BIN: nowhere, KIMI_BIN: fakeApp(base, 'kimi', SAYS_YES), PATH: pathLeft });
    const child = spawn(process.execPath, [INSTALL, '--prefix', join(home3b, 'rt'), '--no-snitch'], { env: env3, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { err += chunk; }); child.stdout.resume();
    const reached = await new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (fs.existsSync(slowLog)) { clearInterval(timer); resolve(true); }
        else if (Date.now() - started > 30000 || child.exitCode !== null) { clearInterval(timer); resolve(false); }
      }, 50);
    });
    if (reached) child.kill('SIGINT');
    const ended = await waitExit(child, 20000);
    if (!ended) await stopProcessTree(child.pid);
    await check('a real Ctrl-C while an app command runs ends the installer with code 130', () => {
      assert.ok(reached, 'the app command was never started: ' + err); assert.ok(ended, 'the installer did not end');
      assert.strictEqual(child.exitCode, 130, err);
    });
    await check('it says which app was being connected and that its settings were put back', () =>
      assert.ok(err.includes('Stopped while connecting Codex; its settings were put back as they were'), err));
    await check('and the settings really are as they were', () => {
      assert.strictEqual(read(join(home3b, '.codex', 'config.toml')), before3b);
      assert.ok(!fs.existsSync(join(home3b, '.codex', 'hooks.json')));
      assert.ok(!fs.existsSync(join(home3b, '.kimi-code')), 'Kimi was touched after the interruption');
    });
    await check("the app's unfinished command is not left running", () => {
      const pid = Number(read(slowPid));
      assert.ok(!processSnapshot().has(pid), 'process ' + pid + ' is still alive');
    });
  } else skip('a real Ctrl-C while an app command runs', 'a signal cannot be sent to another program on Windows');
  // 4. Restore puts the permissions back even when the bytes never changed, and names what it could not restore.
  const f = join(base, 'same.json'); write(f, '{}');
  if (!WIN) {
    fs.chmodSync(f, 0o644);
    await check('restore puts the permissions back even when the bytes never changed', () => {
      assert.deepStrictEqual(installer.putBack(new Map([[f, { bytes: Buffer.from('{}'), mode: 0o100600 }]])), []);
      assert.strictEqual(modeOf(f), 0o600);
    });
  } else skip('restore puts the permissions back even when the bytes never changed', 'Windows has no such permission bits');
  await check('restore names a file it could not put back', () =>
    assert.deepStrictEqual(installer.putBack(new Map([[join(base, 'no such folder', 'x.json'), { bytes: Buffer.from('{}'), mode: 0o100600 }]])), ['x.json']));
  // 5. Kimi: an empty inline list is replaced by the reporter blocks; everything else stays.
  const where = { node: process.execPath };
  const k = join(base, 'config.toml'); write(k, 'default_model = "keep"\nhooks = []\n\n[other]\nkey = 1\n');
  await check('Kimi: an empty hooks list is replaced by the reporter blocks; everything else stays', () => {
    installer.mergeKimiHooks(k, prefix, new Map(), where);
    const parsed = installer.parseToml(read(k));
    assert.strictEqual(parsed.hooks.length, 7); assert.strictEqual(parsed.default_model, 'keep'); assert.ok(installer.same(parsed.other, { key: 1 }));
  });
  // 5b. Settings kept through a link (dotfiles): the real file changes, the link stays a link,
  //     and a second backup in the same second does not write over the first.
  if (LINKS) {
    const real = mkdir(join(base, 'dotfiles')); write(join(real, 'mcp.json'), '{"mcpServers":{}}');
    const link = join(base, 'linked-mcp.json'); fs.symlinkSync(join(real, 'mcp.json'), link);
    const done = new Map();
    await check('settings kept through a link: the real file changes, the link stays a link', () => {
      installer.mergeJsonServers(link, { codex: { command: 'node', args: ['/p/tools/ask-codex-mcp.mjs'], env: {} } }, done, []);
      assert.ok(fs.lstatSync(link).isSymbolicLink()); assert.ok('codex' in readJson(join(real, 'mcp.json')).mcpServers);
    });
    await check('a second backup in the same second does not write over the first', () => {
      const first = done.get(link);
      assert.deepStrictEqual(readJson(first), { mcpServers: {} });
      const again = new Map(); installer.backup(link, again);
      assert.notStrictEqual(again.get(link), first); assert.deepStrictEqual(readJson(first), { mcpServers: {} });
    });
  } else {
    skip('settings kept through a link: the real file changes, the link stays a link', 'this system does not allow links here');
    skip('a second backup in the same second does not write over the first', 'this system does not allow links here');
  }
  // 6. Only a command whose PROGRAM is a reporter script counts as a reporter.
  await check("an older Frenemy's shell reporters are recognised", () => {
    assert.ok(installer.isReporter("'/a b/snitch/hooks/agent-beat.sh' kimi done"));
    assert.ok(installer.isReporter('"/a b/snitch/hooks/claude-beat.sh"'));
    assert.ok(installer.isReporter('/plain/snitch/hooks/claude-beat.sh done'));
  });
  await check('the Node reporters are recognised, in the Mac and the Windows form', () => {
    assert.ok(installer.isReporter("'/usr/local/bin/node' '/a b/snitch/hooks/agent-beat.mjs' kimi done"));
    assert.ok(installer.isReporter("/usr/bin/nodejs /a/snitch/hooks/claude-beat.mjs"));
    assert.ok(installer.isReporter('node "C:/Users/Jane Doe/.local/share/frenemy/2.0.0/snitch/hooks/claude-beat.mjs" done'));
    assert.ok(installer.isReporter('node "C:\\Users\\Jane\\frenemy\\snitch\\hooks\\agent-beat.mjs" codex'));
    assert.ok(installer.isReporter('"C:/Program Files/nodejs/node.exe" "C:/f/snitch/hooks/agent-beat.mjs" agy done'));
  });
  await check('a command of your own is never taken for a reporter', () => {
    for (const yours of ['echo /x/snitch/hooks/agent-beat.sh', 'echo /x/snitch/hooks/agent-beat.mjs', '/usr/bin/true', '', "'unterminated",
      'node', 'node /x/other.mjs /x/snitch/hooks/agent-beat.mjs', 'cat /x/snitch/hooks/claude-beat.mjs', 'node /x/snitch/hooks/claude-beat.mjs.bak']) {
      assert.ok(!installer.isReporter(yours), yours);
    }
    assert.ok(!installer.isReporter(undefined)); assert.ok(!installer.isReporter(7));
  });
  console.log('Retained second-audit fixture:', base);
});

// ============================================================================================
await group('Reporter commands: Windows form, Mac and Linux form, and a real shell', async () => {
  await check('Windows form: bare node, path in double quotes with forward slashes', () => {
    const prefix = 'C:\\Users\\Jane Doe\\.local\\share\\frenemy\\2.0.0', win = { platform: 'win32' };
    assert.strictEqual(installer.hookCommand('claude', prefix, '', win), 'node "C:/Users/Jane Doe/.local/share/frenemy/2.0.0/snitch/hooks/claude-beat.mjs"');
    assert.strictEqual(installer.hookCommand('claude', prefix, 'done', win), 'node "C:/Users/Jane Doe/.local/share/frenemy/2.0.0/snitch/hooks/claude-beat.mjs" done');
    assert.strictEqual(installer.hookCommand('codex', prefix, '', win), 'node "C:/Users/Jane Doe/.local/share/frenemy/2.0.0/snitch/hooks/agent-beat.mjs" codex');
    assert.strictEqual(installer.hookCommand('agy', prefix, 'done', win), 'node "C:/Users/Jane Doe/.local/share/frenemy/2.0.0/snitch/hooks/agent-beat.mjs" agy done');
    assert.strictEqual(installer.hookCommand('kimi', prefix, 'fail', win), 'node "C:/Users/Jane Doe/.local/share/frenemy/2.0.0/snitch/hooks/agent-beat.mjs" kimi fail');
    // The node path of this computer plays no part in the Windows form.
    assert.strictEqual(installer.hookCommand('kimi', prefix, 'beat', { platform: 'win32', node: 'C:\\Program Files\\nodejs\\node.exe' }),
      'node "C:/Users/Jane Doe/.local/share/frenemy/2.0.0/snitch/hooks/agent-beat.mjs" kimi beat');
  });
  await check('Windows form: every event of every app is a recognised reporter with no backslash', () => {
    for (const driver of SEATS) {
      const entries = installer.hookEntries(driver, 'D:\\Apps\\frenemy', { platform: 'win32' });
      const commands = commandsOf(entries);
      assert.strictEqual(commands.length, installer.EVENTS[driver].length);
      for (const command of commands) {
        assert.ok(installer.isReporter(command), command); assert.ok(!command.includes('\\'), command);
        assert.ok(command.startsWith('node "D:/Apps/frenemy/snitch/hooks/'), command);
      }
    }
  });
  await check('Windows form: a folder name a command window would change is refused in plain words', () => {
    for (const bad of ['C:\\Users\\100%\\frenemy', 'C:\\Users\\$me\\frenemy', 'C:\\Users\\a`b\\frenemy']) {
      assert.throws(() => installer.hookCommand('claude', bad, 'done', { platform: 'win32' }), /Choose another folder with --prefix/);
    }
  });
  await check('Mac and Linux form: full node path and script path, each in single quotes', () => {
    const unix = { platform: 'linux', node: '/opt/node 22/bin/node' };
    assert.strictEqual(installer.hookCommand('claude', '/home/jane doe/.local/share/frenemy/2.0.0', 'done', unix),
      "'/opt/node 22/bin/node' '/home/jane doe/.local/share/frenemy/2.0.0/snitch/hooks/claude-beat.mjs' done");
    assert.strictEqual(installer.hookCommand('kimi', '/home/jane/f', '', { platform: 'darwin', node: '/usr/local/bin/node' }),
      "'/usr/local/bin/node' '/home/jane/f/snitch/hooks/agent-beat.mjs' kimi");
    const quote = installer.hookCommand('agy', "/home/o'brien/f", 'done', { platform: 'linux', node: '/usr/bin/node' });
    assert.deepStrictEqual(installer.shSplit(quote), ['/usr/bin/node', "/home/o'brien/f/snitch/hooks/agent-beat.mjs", 'agy', 'done']);
    assert.ok(installer.isReporter(quote));
  });
  // The command as a real shell reads it: a stand-in reporter in a folder with a space
  // writes down the words it was given.
  const base = tempDir('frenemy-install-shell-');
  const prefix = join(base, WIN ? 'jane doe' : "jane o'brien doe", 'frenemy');
  mkdir(join(prefix, 'snitch', 'hooks'));
  const seen = join(base, 'seen.json');
  write(join(prefix, 'snitch', 'hooks', 'agent-beat.mjs'),
    "import fs from 'node:fs';\nfs.writeFileSync(" + JSON.stringify(seen) + ', JSON.stringify(process.argv.slice(2)));\n');
  let node = process.execPath;
  if (!WIN && LINKS) { node = join(mkdir(join(base, 'node folder')), 'node'); fs.symlinkSync(process.execPath, node); }
  const command = installer.hookCommand('kimi', prefix, 'done', { node });
  const ran = spawnSync(command, { shell: true, encoding: 'utf8', timeout: 20000, input: '{}' });
  await check("the system's own shell runs the command from a folder with a space and passes both words", () => {
    assert.strictEqual(ran.status, 0, command + '\n' + ran.stderr);
    assert.deepStrictEqual(readJson(seen), ['kimi', 'done']);
  });
});

// ============================================================================================
await group("An older Frenemy's reporters are replaced, never doubled", async () => {
  const base = tempDir('frenemy-install-upgrade-');
  const prefix = join(base, 'frenemy', '2.0.0');
  const where = { node: process.execPath };
  const count = (text, part) => text.split(part).length - 1;
  // The shell reporters of the earlier build at this very folder, and of one in another folder;
  // a Node reporter in another folder; and the person's own hook.
  const here = prefix.replace(/\\/g, '/');
  const olds = [here + '/snitch/hooks/claude-beat.sh', "'" + here + "/snitch/hooks/claude-beat.sh' done",
    "'/other place/frenemy/snitch/hooks/claude-beat.sh' beat", "'/usr/local/bin/node' '/other place/frenemy/snitch/hooks/claude-beat.mjs' done"];
  const claudeFile = join(base, 'settings.json');
  write(claudeFile, JSON.stringify({ hooks: {
    PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: olds[0] }] }],
    Stop: [{ matcher: '*', hooks: [{ type: 'command', command: olds[1] }, mine] }, { matcher: '*', hooks: [{ type: 'command', command: olds[3] }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: olds[2], timeout: 10 }] }],
    Notification: [{ matcher: '*', hooks: [mine] }] } }));
  const done = new Map();
  installer.mergeJsonHooks(claudeFile, installer.hookEntries('claude', prefix, where), done);
  const after = read(claudeFile), hooks = readJson(claudeFile).hooks;
  await check('Claude: no .sh reporter and no reporter from another folder is left', () => {
    assert.strictEqual(count(after, 'claude-beat.sh'), 0); assert.strictEqual(count(after, '/other place/'), 0);
  });
  await check('Claude: exactly one reporter for each of its four events', () => {
    for (const [event, word] of installer.EVENTS.claude) {
      const commands = hooks[event].flatMap(group_ => group_.hooks.map(hook => hook.command)).filter(command => installer.isReporter(command));
      assert.deepStrictEqual(commands, [installer.hookCommand('claude', prefix, word, where)], event);
    }
    assert.strictEqual(count(after, 'claude-beat.mjs'), 4);
  });
  await check("Claude: the person's own hooks are all still there", () => {
    assert.deepStrictEqual(hooks.Stop[0].hooks, [mine]); assert.deepStrictEqual(hooks.Notification, [{ matcher: '*', hooks: [mine] }]);
  });
  await check('Claude: the file as it was is kept as a backup', () => assert.ok(read(done.get(claudeFile)).includes('claude-beat.sh')));
  await check('Claude: doing it again changes nothing and makes no second backup', () => {
    const again = new Map();
    installer.mergeJsonHooks(claudeFile, installer.hookEntries('claude', prefix, where), again);
    assert.strictEqual(read(claudeFile), after); assert.strictEqual(again.size, 0);
  });
  const codexFile = join(base, 'hooks.json');
  write(codexFile, JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: "'" + here + "/snitch/hooks/agent-beat.sh' codex done", timeout: 10 }] }],
    PostToolUse: [{ matcher: '', hooks: [mine] }] } }));
  installer.mergeJsonHooks(codexFile, installer.hookEntries('codex', prefix, where), new Map());
  await check('Codex: the .sh reporters are replaced, one reporter per event, own hook kept', () => {
    const text = read(codexFile), table = readJson(codexFile).hooks;
    assert.strictEqual(count(text, 'agent-beat.sh'), 0); assert.strictEqual(count(text, 'agent-beat.mjs'), 6);
    assert.deepStrictEqual(table.PostToolUse[0].hooks, [mine]); assert.strictEqual(table.Stop.length, 1);
  });
  const agyFile = join(base, 'agy-hooks.json');
  write(agyFile, JSON.stringify({ keep: { Stop: [mine] }, snitch: { Stop: [{ type: 'command', command: here + '/snitch/hooks/agent-beat.sh agy done' }] } }));
  installer.mergeJsonHooks(agyFile, installer.hookEntries('agy', prefix, where), new Map(), 'snitch');
  await check('agy: the .sh reporters are replaced, the other tool is kept', () => {
    const text = read(agyFile);
    assert.strictEqual(count(text, 'agent-beat.sh'), 0); assert.strictEqual(count(text, 'agent-beat.mjs'), 2);
    assert.deepStrictEqual(readJson(agyFile).keep, { Stop: [mine] });
  });
  const kimiFile = join(base, 'config.toml');
  const kimiBefore = 'model = "k"\n\n[[hooks]]\nevent = "Stop"\ncommand = "\'' + here + '/snitch/hooks/agent-beat.sh\' kimi done"\n\n' +
    '[[hooks]]\nevent = "PostToolUse"\ncommand = "' + here + '/snitch/hooks/agent-beat.sh kimi"\n\n' +
    '[[hooks]]\nevent = "Stop"\ncommand = "/usr/bin/true mine"\n';
  write(kimiFile, kimiBefore);
  installer.mergeKimiHooks(kimiFile, prefix, new Map(), where);
  const kimiAfter = read(kimiFile);
  await check('Kimi: the .sh reporters are replaced by seven new ones, own hook and settings kept', () => {
    const parsed = installer.parseToml(kimiAfter);
    assert.strictEqual(count(kimiAfter, 'agent-beat.sh'), 0);
    assert.strictEqual(parsed.hooks.length, 8); assert.strictEqual(parsed.model, 'k');
    assert.strictEqual(parsed.hooks.filter(hook => hook.command === '/usr/bin/true mine').length, 1);
    assert.strictEqual(parsed.hooks.filter(hook => installer.isReporter(hook.command)).length, 7);
  });
  await check('Kimi: doing it again changes nothing', () => {
    const again = new Map();
    installer.mergeKimiHooks(kimiFile, prefix, again, where);
    assert.strictEqual(read(kimiFile), kimiAfter); assert.strictEqual(again.size, 0);
  });
  await check('a reporter that used a different node is replaced, not doubled', () => {
    const file = join(base, 'other-node.json');
    write(file, JSON.stringify({ hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: installer.hookCommand('claude', prefix, 'done', { platform: process.platform, node: '/elsewhere/bin/node' }) }] }] } }));
    installer.mergeJsonHooks(file, installer.hookEntries('claude', prefix, where), new Map());
    assert.strictEqual(readJson(file).hooks.Stop.length, 1);
    if (!WIN) assert.strictEqual(count(read(file), '/elsewhere/bin/node'), 0);
  });
});

// ============================================================================================
await group('TOML that cannot be read with certainty is left untouched', async () => {
  const base = tempDir('frenemy-install-toml-');
  const home = mkdir(join(base, 'home'));
  for (const folder of ['.codex', '.kimi-code']) mkdir(join(home, folder));
  const log = join(base, 'calls.log');
  const env = homeEnv(home, { CLAUDE_BIN: fakeApp(base, 'claude', FAKE_CLAUDE, log, 'x'), CODEX_BIN: fakeApp(base, 'codex', FAKE_CODEX, log, 'x'),
    AGY_BIN: join(base, 'not-installed'), KIMI_BIN: fakeApp(base, 'kimi', SAYS_YES) });
  // Kimi: a table written over several lines, which only a newer TOML allows. Codex: a name set twice.
  const kimiOdd = '# mine\nmodel = "k"\nlimits = {\n  daily = 5,\n}\n\n[[hooks]]\nevent = "Stop"\ncommand = "/usr/bin/true mine"\n';
  const codexOdd = 'model = "a"\nmodel = "b"\n\n[mcp_servers.mine]\ncommand = "x"\n';
  write(join(home, '.kimi-code', 'config.toml'), kimiOdd);
  write(join(home, '.codex', 'config.toml'), codexOdd);
  const result = runInstall(['--prefix', join(home, 'rt'), '--no-snitch'], env);
  await check('the install goes on for the other apps and ends with exit code 1', () => {
    assert.strictEqual(result.status, 1, result.stdout + result.stderr); assert.ok(noStack(result.stderr), result.stderr);
  });
  await check('Kimi: the installer says plainly that it could not read the file and changed nothing', () =>
    assert.match(result.stdout, /Could not connect Kimi: could not read config\.toml with certainty \(line 3: .*\), so nothing in it was changed/));
  await check("Kimi: config.toml is byte for byte as it was, with no backup and no leftover file", () => {
    assert.strictEqual(read(join(home, '.kimi-code', 'config.toml')), kimiOdd);
    assert.deepStrictEqual(fs.readdirSync(join(home, '.kimi-code')), ['config.toml']);
  });
  await check('Codex: the installer says plainly that it could not read the file and changed nothing', () =>
    assert.match(result.stdout, /Could not connect Codex: could not read config\.toml with certainty \(line 2: .*\), so nothing in it was changed/));
  await check("Codex: config.toml is byte for byte as it was, its own command was never run, nothing was added", () => {
    assert.strictEqual(read(join(home, '.codex', 'config.toml')), codexOdd);
    assert.deepStrictEqual(fs.readdirSync(join(home, '.codex')), ['config.toml']);
    assert.ok(!(fs.existsSync(log) ? read(log) : '').includes('codex mcp'));
  });
  // The same, straight at the function that changes Kimi's file.
  const where = { node: process.execPath };
  const cases = {
    'a byte-order mark at the start': '\ufeffmodel = "k"\n',
    'a string that is never closed': 'model = "k\n',
    'a table defined twice': '[a]\nx = 1\n[a]\ny = 2\n',
    'a hooks list that cannot take more entries': 'hooks = [{ event = "Stop", command = "/usr/bin/true mine" }]\n',
    'an escape only a newer TOML knows': 'name = "a\\eb"\n',
    'a date that does not exist': 'when = 2026-02-30\n',
    'a lone carriage return': 'a = 1\rb = 2\n',
  };
  let n = 0;
  for (const [what, text] of Object.entries(cases)) {
    const file = join(mkdir(join(base, 'case' + (++n))), 'config.toml');
    write(file, text);
    await check('left untouched: ' + what, () => {
      const done = new Map();
      assert.throws(() => installer.mergeKimiHooks(file, join(home, 'rt'), done, where), error => error instanceof installer.Stop && /nothing in it was changed/.test(error.message));
      assert.strictEqual(read(file), text); assert.strictEqual(done.size, 0);
      assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['config.toml']);
    });
  }
  await check('bytes that are not UTF-8 text are left untouched', () => {
    const file = join(mkdir(join(base, 'case-bytes')), 'config.toml');
    const bytes = Buffer.from([0x6d, 0x20, 0x3d, 0x20, 0x22, 0xff, 0xfe, 0x22, 0x0a]);
    fs.writeFileSync(file, bytes);
    assert.throws(() => installer.mergeKimiHooks(file, join(home, 'rt'), new Map(), where), installer.Stop);
    assert.ok(fs.readFileSync(file).equals(bytes));
  });
  await check('the reader gives the right values for TOML it does know', () => {
    const parsed = installer.parseToml('# c\ntitle = "a \\"b\\" \\u00e9"\nraw = \'C:\\Users\\x\'\nn = 1_000\nhex = 0xFF\nf = 1.5\nyes = true\n' +
      'list = [1, "two", [3.0], { k = "v" }]\nwhen = 1979-05-27T07:32:00Z\nmulti = """\nline one\nline two"""\n\n' +
      '[mcp_servers.claude]\ncommand = "/usr/local/bin/node"\nargs = ["/a b/tools/ask-claude-mcp.mjs"]\n[mcp_servers.claude.env]\nFRENEMY_DRIVER = "codex"\n\n' +
      '[projects."/Users/x/y z"]\ntrust_level = "trusted"\n\n[[hooks]]\nevent = "Stop"\n[[hooks]]\nevent = "Start"\n');
    assert.strictEqual(parsed.title, 'a "b" \u00e9'); assert.strictEqual(parsed.raw, 'C:\\Users\\x');
    assert.strictEqual(parsed.n, 1000); assert.strictEqual(parsed.hex, 255); assert.strictEqual(parsed.f, 1.5); assert.strictEqual(parsed.yes, true);
    assert.ok(installer.same(parsed.list.slice(0, 3), [1, 'two', [3]])); assert.strictEqual(parsed.list[3].k, 'v');
    assert.ok(parsed.when instanceof installer.TomlDate); assert.strictEqual(parsed.multi, 'line one\nline two');
    assert.strictEqual(parsed.mcp_servers.claude.command, '/usr/local/bin/node');
    assert.deepStrictEqual(parsed.mcp_servers.claude.args, ['/a b/tools/ask-claude-mcp.mjs']);
    assert.strictEqual(parsed.mcp_servers.claude.env.FRENEMY_DRIVER, 'codex');
    assert.strictEqual(parsed.projects['/Users/x/y z'].trust_level, 'trusted');
    assert.deepStrictEqual(parsed.hooks.map(hook => hook.event), ['Stop', 'Start']);
    assert.ok(installer.same(installer.parseToml('a = 1\r\n[t]\r\nb = "x"\r\n'), { a: 1, t: { b: 'x' } }));
  });
  await check('the reader refuses what is not valid TOML', () => {
    for (const bad of ['a = 1\na = 2\n', 'a = \n', 'a = 01\n', 'a = [1, 2\n', 'a = {b = 1,}\n', '[t]\n[t]\n', 'a.b = 1\na = 2\n', 'x = "\\q"\n',
      'a = 1 b = 2\n', '[t\n', 'h = []\n[[h]]\n', 't = {a = 1}\nt.b = 2\n', 'a = "x"\rb = 2\n', '\ufeffa = 1\n', 'a = truex\n', 'a = 1979-05-27T25:00:00\n']) {
      assert.throws(() => installer.parseToml(bad), installer.TomlError, JSON.stringify(bad));
    }
  });
  await check('a JSON settings file that is not valid, or holds a number too large to copy, is left untouched', () => {
    const hooks = installer.hookEntries('claude', join(home, 'rt'), where);
    for (const text of ['{"hooks": ', '\ufeff{"hooks":{}}', '{"id": 12345678901234567890, "hooks": {}}', '[1]']) {
      const file = join(mkdir(join(base, 'json' + (++n))), 'settings.json');
      write(file, text);
      assert.throws(() => installer.mergeJsonHooks(file, hooks, new Map()), installer.Stop, text);
      assert.strictEqual(read(file), text); assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
    }
  });
});

// ============================================================================================
await group('The release bundle', async () => {
  const base = tempDir('frenemy-install-zip-');
  const tool = join(SRC, 'tools', 'package-release.mjs');
  const one = join(base, 'one.zip'), two = join(base, 'two.zip');
  const first = spawnSync(process.execPath, [tool, one], { encoding: 'utf8', timeout: 60000 });
  await check('the bundle is built', () => assert.strictEqual(first.status, 0, first.stdout + first.stderr));
  const bytes = fs.existsSync(one) ? fs.readFileSync(one) : Buffer.alloc(0);
  await check('its checksum file matches and is printed', () => {
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.strictEqual(read(one + '.sha256'), digest + '  one.zip\n');
    assert.ok(first.stdout.includes('SHA256 ' + digest));
  });
  await check('building it again gives the same bytes', () => {
    const second = spawnSync(process.execPath, [tool, two], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(second.status, 0, second.stderr); assert.ok(fs.readFileSync(two).equals(bytes));
  });
  await check('an existing bundle is never written over', () => {
    const again = spawnSync(process.execPath, [tool, one], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(again.status, 1); assert.match(again.stderr, /Output exists; choose a fresh destination/);
    assert.ok(fs.readFileSync(one).equals(bytes));
  });
  await check('a bundle inside the release folder is refused', () => {
    const inside = spawnSync(process.execPath, [tool, join(SRC, 'inside.zip')], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(inside.status, 1); assert.match(inside.stderr, /Output must be outside the release source/);
    assert.ok(!fs.existsSync(join(SRC, 'inside.zip')));
  });
  await check('every file is in the bundle with the right bytes, a fixed date, sorted names and its run permission', () => {
    // Read the bundle back by its own index.
    const end = bytes.length - 22;
    assert.strictEqual(bytes.readUInt32LE(end), 0x06054b50);
    const total = bytes.readUInt16LE(end + 10);
    let at = bytes.readUInt32LE(end + 16);
    const manifest = readJson(join(SRC, 'MANIFEST.json')).files;
    const names = [];
    const modes = {};
    for (let i = 0; i < total; i++) {
      assert.strictEqual(bytes.readUInt32LE(at), 0x02014b50);
      const packedSize = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24), nameLength = bytes.readUInt16LE(at + 28);
      const name = bytes.toString('utf8', at + 46, at + 46 + nameLength), local = bytes.readUInt32LE(at + 42);
      assert.strictEqual(bytes.readUInt16LE(at + 4) >> 8, 3, 'made on Unix');
      assert.strictEqual(bytes.readUInt16LE(at + 12), 0); assert.strictEqual(bytes.readUInt16LE(at + 14), ((2026 - 1980) << 9) | (11 << 5) | 15);
      assert.strictEqual(bytes.readUInt32LE(local), 0x04034b50);
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const content = zlib.inflateRawSync(bytes.subarray(start, start + packedSize));
      assert.strictEqual(content.length, size, name);
      assert.ok(name.startsWith('frenemy-2.0.0/'), name);
      const inner = name.slice('frenemy-2.0.0/'.length);
      if (inner !== 'MANIFEST.json') assert.strictEqual(crypto.createHash('sha256').update(content).digest('hex'), manifest[inner], name);
      else assert.ok(content.equals(fs.readFileSync(join(SRC, 'MANIFEST.json'))));
      modes[inner] = (bytes.readUInt32LE(at + 38) >>> 16) & 0o7777;
      names.push(inner);
      at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    }
    assert.deepStrictEqual(names, sorted([...Object.keys(manifest), 'MANIFEST.json']));
    assert.strictEqual(modes['install.sh'], 0o755); assert.strictEqual(modes['README.md'], 0o644); assert.strictEqual(modes['install.mjs'], 0o644);
  });
});

console.log('');
console.log('Retained temp copy of the release:', WORK);
console.log(passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
process.exit(failed ? 1 : 0);
