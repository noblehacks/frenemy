// Copyright (c) 2026 Hive-Lite contributors. MIT: hive-lite/LICENSE.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { main, SKILL_FILES } from '../install-hive-lite.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-lite-install-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const homeDir = path.join(dir, 'test home');
  const logs = [];
  const options = {
    homeDir, env: {}, log: s => logs.push(s), errorLog: s => logs.push(s),
    runFrenemy: () => { throw new Error('Unexpected real provider setup in test'); },
  };
  return {
    dir, homeDir, logs,
    dest: client => path.join(homeDir, `.${client}`, 'skills', 'hive-lite'),
    run: (args = [], extra = {}) => main(args, { ...options, ...extra }),
  };
}

function assertInstalled(destination) {
  for (const file of SKILL_FILES) {
    assert.deepEqual(fs.readFileSync(path.join(destination, file)), fs.readFileSync(path.join(ROOT, 'hive-lite', file)));
  }
}

test('fresh installation copies usable skills for both clients and preserves settings', t => {
  const f = fixture(t);
  const settings = path.join(f.homeDir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, '{"existing":"keep"}\n');
  assert.equal(f.run(), 0);
  assertInstalled(f.dest('codex'));
  assertInstalled(f.dest('claude'));
  assert.equal(fs.readFileSync(settings, 'utf8'), '{"existing":"keep"}\n');
  assert.equal(fs.existsSync(path.join(f.homeDir, '.codex', 'config.toml')), false);
});

test('repeating an identical installation leaves files and timestamps alone', t => {
  const f = fixture(t);
  assert.equal(f.run(), 0);
  const file = path.join(f.dest('codex'), 'SKILL.md');
  fs.utimesSync(file, 1000, 1000);
  assert.equal(f.run(), 0);
  assert.equal(fs.statSync(file).mtimeMs, 1000000);
  assert.equal(fs.existsSync(path.join(f.homeDir, '.codex', 'hive-lite-backups')), false);
});

test('--check and --help do not create a home or install anything', t => {
  const f = fixture(t);
  assert.equal(f.run(['--check']), 0);
  assert.equal(f.run(['--help']), 0);
  assert.equal(fs.existsSync(f.homeDir), false);
});

test('target choice and configured roots are honoured, including paths with spaces', t => {
  const f = fixture(t);
  const config = path.join(f.dir, 'custom codex config');
  assert.equal(f.run(['--target', 'codex'], { env: { CODEX_HOME: config } }), 0);
  assertInstalled(path.join(config, 'skills', 'hive-lite'));
  assert.equal(fs.existsSync(f.dest('claude')), false);
  assert.equal(fs.existsSync(f.dest('codex')), false);
  const claude = path.join(f.dir, 'custom claude config');
  assert.equal(f.run(['--target', 'claude'], { env: { CLAUDE_CONFIG_DIR: claude } }), 0);
  assertInstalled(path.join(claude, 'skills', 'hive-lite'));
});

test('invalid options and relative config roots stop before writes', t => {
  const f = fixture(t);
  for (const args of [
    ['--target'], ['--target', 'other'], ['--typo'], ['--frenemy-prefix'],
    ['--with-frenemy', '--frenemy-prefix', 'relative/path'],
    ['--frenemy-prefix', path.join(f.dir, 'unused')],
  ]) assert.equal(f.run(args), 1);
  assert.equal(f.run([], { env: { CODEX_HOME: 'relative/config' } }), 1);
  assert.equal(fs.existsSync(f.homeDir), false);
});

test('a different existing copy is preserved; all destinations are checked before writes', t => {
  const f = fixture(t);
  fs.mkdirSync(f.dest('claude'), { recursive: true });
  const local = path.join(f.dest('claude'), 'notes.txt');
  fs.writeFileSync(local, 'local work');
  assert.equal(f.run(), 1);
  assert.equal(fs.existsSync(f.dest('codex')), false);
  assert.equal(fs.readFileSync(local, 'utf8'), 'local work');
  assert.equal(f.run(['--check']), 0);
  assert.equal(fs.readFileSync(local, 'utf8'), 'local work');
});

test('--replace preserves the old tree outside skill discovery, including local additions', t => {
  const f = fixture(t);
  assert.equal(f.run(['--target', 'codex']), 0);
  fs.writeFileSync(path.join(f.dest('codex'), 'SKILL.md'), 'local edited skill');
  fs.writeFileSync(path.join(f.dest('codex'), 'notes.txt'), 'local notes');
  assert.equal(f.run(['--target', 'codex', '--replace']), 0);
  assertInstalled(f.dest('codex'));
  assert.deepEqual(fs.readdirSync(path.dirname(f.dest('codex'))), ['hive-lite']);
  const backups = path.join(f.homeDir, '.codex', 'hive-lite-backups');
  const backup = path.join(backups, fs.readdirSync(backups)[0], 'hive-lite');
  assert.equal(fs.readFileSync(path.join(backup, 'SKILL.md'), 'utf8'), 'local edited skill');
  assert.equal(fs.readFileSync(path.join(backup, 'notes.txt'), 'utf8'), 'local notes');
});

test('a failed replacement restores the old skill and leaves no discoverable partial copy', t => {
  const f = fixture(t);
  fs.mkdirSync(f.dest('codex'), { recursive: true });
  fs.writeFileSync(path.join(f.dest('codex'), 'SKILL.md'), 'previous contents');
  const rename = (from, to) => {
    if (path.basename(from).startsWith('.hive-lite-stage-')) throw new Error('simulated rename failure');
    fs.renameSync(from, to);
  };
  assert.equal(f.run(['--target', 'codex', '--replace'], { rename }), 1);
  assert.equal(fs.readFileSync(path.join(f.dest('codex'), 'SKILL.md'), 'utf8'), 'previous contents');
  assert.equal(fs.readdirSync(path.join(f.homeDir, '.codex')).some(n => n.startsWith('.hive-lite-stage-')), false);
});

test('a symlink destination is refused without touching its target', t => {
  const f = fixture(t);
  const outside = path.join(f.dir, 'linked skill');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'SKILL.md'), 'keep');
  fs.mkdirSync(path.dirname(f.dest('codex')), { recursive: true });
  fs.symlinkSync(outside, f.dest('codex'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(f.run(['--replace']), 1);
  assert.equal(fs.readFileSync(path.join(outside, 'SKILL.md'), 'utf8'), 'keep');
  assert.equal(fs.existsSync(f.dest('claude')), false);
});

test('incomplete source fails before creating target folders', t => {
  const f = fixture(t);
  const root = path.join(f.dir, 'incomplete source');
  fs.mkdirSync(path.join(root, 'hive-lite'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hive-lite', 'SKILL.md'), '---\nname: hive-lite\n---\n');
  assert.equal(f.run([], { root }), 1);
  assert.equal(fs.existsSync(f.homeDir), false);
});

test('Frenemy preflight failure prevents installing either skill', t => {
  const f = fixture(t);
  const calls = [];
  assert.equal(f.run(['--with-frenemy'], { runFrenemy: (_script, args) => { calls.push(args); return 1; } }), 1);
  assert.deepEqual(calls, [['--check']]);
  assert.equal(fs.existsSync(f.homeDir), false);
});

test('combined check does not invoke the write phase', t => {
  const f = fixture(t);
  const calls = [];
  assert.equal(f.run(['--check', '--with-frenemy'], { runFrenemy: (_script, args) => { calls.push(args); return 0; } }), 0);
  assert.deepEqual(calls, [['--check']]);
  assert.equal(fs.existsSync(f.homeDir), false);
});

test('partial combined installation reports Frenemy failure while preserving installed HL', t => {
  const f = fixture(t);
  assert.equal(f.run(['--with-frenemy'], { runFrenemy: (_script, args) => args.length ? 0 : 3 }), 3);
  assertInstalled(f.dest('codex'));
  assert.match(f.logs.join('\n'), /Hive-Lite is installed, but Frenemy setup did not complete/);
  assert.equal(f.logs.some(s => s.startsWith('Done.')), false);
});

test('combined setup invokes the bundled child installer correctly from paths with spaces', t => {
  const f = fixture(t);
  const root = path.join(f.dir, 'source with spaces');
  fs.cpSync(path.join(ROOT, 'hive-lite'), path.join(root, 'hive-lite'), { recursive: true });
  const calls = path.join(f.dir, 'child-calls.txt');
  fs.writeFileSync(path.join(root, 'install.mjs'),
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');`);
  assert.equal(f.run(['--with-frenemy'], { root, runFrenemy: undefined }), 0);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse), [['--check'], []]);
  assertInstalled(f.dest('codex'));
  assertInstalled(f.dest('claude'));
});

test('the published CLI runs in a fresh process with an isolated config destination', t => {
  const f = fixture(t);
  const config = path.join(f.dir, 'cli config');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'install-hive-lite.mjs'), '--target', 'codex'], {
    env: { ...process.env, CODEX_HOME: config }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assertInstalled(path.join(config, 'skills', 'hive-lite'));
  assert.match(result.stdout, /Done\./);
});

test('a custom Frenemy destination is forwarded as one argument after preflight', t => {
  const f = fixture(t);
  const prefix = path.join(f.dir, 'separate frenemy runtime');
  const calls = [];
  const runFrenemy = (_script, args) => { calls.push(args); return 0; };
  assert.equal(f.run(['--with-frenemy', '--frenemy-prefix', prefix], { runFrenemy }), 0);
  assert.deepEqual(calls, [['--check'], ['--prefix', prefix]]);
  assertInstalled(f.dest('codex'));
});

test('combined setup installs the real Frenemy package in isolation with all providers disabled', t => {
  const f = fixture(t);
  const root = path.join(f.dir, 'release source');
  fs.cpSync(ROOT, root, {
    recursive: true,
    filter: file => !['.git', 'node_modules', '.worker-state', '.fleet'].includes(path.basename(file)),
  });
  const manifest = spawnSync(process.execPath, [path.join(root, 'tools', 'manifest.mjs')], { encoding: 'utf8' });
  assert.equal(manifest.status, 0, manifest.stderr);
  const prefix = path.join(f.dir, 'installed runtime');
  const env = {
    ...process.env, NODE_BIN: process.execPath,
    CODEX_HOME: path.join(f.homeDir, '.codex'),
    CLAUDE_CONFIG_DIR: path.join(f.homeDir, '.claude'),
  };
  for (const seat of ['CLAUDE', 'CODEX', 'AGY', 'KIMI']) env[seat + '_BIN'] = path.join(f.dir, 'disabled-provider');
  const runFrenemy = (script, args, childEnv) => {
    const safeArgs = args.includes('--check') ? args : [...args, '--no-connect', '--no-snitch'];
    const result = spawnSync(process.execPath, [script, ...safeArgs], { env: childEnv, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return result.status;
  };
  assert.equal(f.run(['--with-frenemy', '--frenemy-prefix', prefix], { root, env, runFrenemy }), 0);
  assertInstalled(f.dest('codex'));
  assertInstalled(f.dest('claude'));
  assert.ok(fs.existsSync(path.join(prefix, 'tools', 'ask-claude-mcp.mjs')));
  const dependencies = JSON.parse(fs.readFileSync(path.join(prefix, 'config', 'dependencies.json'), 'utf8'));
  assert.ok(Object.values(dependencies.cli_paths).every(bin => bin === null));
  assert.equal(fs.existsSync(path.join(f.homeDir, '.codex', 'config.toml')), false);
});
