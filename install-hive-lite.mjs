#!/usr/bin/env node
// Copyright (c) 2026 Hive-Lite contributors. MIT: hive-lite/LICENSE.
// Install the Hive-Lite skill; optionally delegate Frenemy setup to its installer.
// Node.js 18+, no dependencies. Importing this module does not install anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_FILES = [
  'SKILL.md', 'LICENSE', 'routing.md', 'roles/controller.md',
  'roles/executive.md', 'roles/worker.md',
];
const HELP = `Hive-Lite installer (Node.js 18+)

  node install-hive-lite.mjs                    Install Hive-Lite for Codex and Claude
  node install-hive-lite.mjs --with-frenemy     Also install/connect bundled Frenemy
  node install-hive-lite.mjs --check            Preview Hive-Lite installation; no writes
  node install-hive-lite.mjs --target codex     Install the Codex skill only
  node install-hive-lite.mjs --target claude    Install the Claude skill only
  node install-hive-lite.mjs --replace          Back up and replace a different skill copy
  node install-hive-lite.mjs --with-frenemy --frenemy-prefix <absolute-new-folder>
                                    Install Frenemy in a separate destination

Options can be combined. --target accepts codex, claude or both (default).
--target controls Hive-Lite only; Frenemy connects the apps it discovers.
--check --with-frenemy also validates Frenemy without installing it.
CODEX_HOME and CLAUDE_CONFIG_DIR are respected when set to absolute paths.
No administrator privileges are required.
`;

function parseArgs(argv) {
  const args = { target: 'both', check: false, frenemy: false, prefix: null, replace: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target') args.target = argv[++i];
    else if (arg === '--frenemy-prefix') {
      args.prefix = argv[++i];
      if (!args.prefix || !path.isAbsolute(args.prefix)) {
        throw new Error('--frenemy-prefix needs an absolute destination path.');
      }
    }
    else if (arg === '--check') args.check = true;
    else if (arg === '--with-frenemy') args.frenemy = true;
    else if (arg === '--replace') args.replace = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}. Run node install-hive-lite.mjs --help.`);
  }
  if (!['both', 'codex', 'claude'].includes(args.target)) {
    throw new Error('--target must be codex, claude or both.');
  }
  if (args.prefix && !args.frenemy) throw new Error('--frenemy-prefix requires --with-frenemy.');
  return args;
}

function statIfPresent(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function loadSkill(sourceDir) {
  const files = new Map();
  for (const relative of SKILL_FILES) {
    const file = path.join(sourceDir, relative);
    const stat = statIfPresent(file);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Missing or unsupported skill source: ${file}`);
    }
    files.set(relative, fs.readFileSync(file));
  }
  if (!/^name: hive-lite\r?$/m.test(files.get('SKILL.md').toString('utf8'))) {
    throw new Error('The bundled skill must be named hive-lite.');
  }
  return files;
}

function installedState(destination, files) {
  const stat = statIfPresent(destination);
  if (!stat) return 'new';
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Destination is a link or non-directory; left unchanged: ${destination}`);
  }
  let equal = true;
  const found = new Set();
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, relative);
      else if (entry.isFile()) {
        found.add(relative);
        if (!files.has(relative) || !fs.readFileSync(full).equals(files.get(relative))) equal = false;
      } else equal = false;
    }
  }
  walk(destination);
  return equal && found.size === files.size ? 'same' : 'different';
}

function targets(args, homeDir, env) {
  const selected = args.target === 'both' ? ['codex', 'claude'] : [args.target];
  const unique = new Map();
  for (const client of selected) {
    const key = client === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
    const configDir = env[key] || path.join(homeDir, `.${client}`);
    if (!path.isAbsolute(configDir)) throw new Error(`${key} must be an absolute path.`);
    const destination = path.join(path.resolve(configDir), 'skills', 'hive-lite');
    if (unique.has(destination)) unique.get(destination).clients.push(client);
    else unique.set(destination, { clients: [client], configDir: path.resolve(configDir), destination });
  }
  return [...unique.values()];
}

function installTarget(target, files, { replace, log, rename }) {
  const { configDir, destination } = target;
  const state = installedState(destination, files);
  if (state === 'same') { log(`Already installed: ${destination}`); return; }
  if (state === 'different' && !replace) {
    throw new Error(`Existing copy differs; use --replace to keep a backup and update: ${destination}`);
  }
  fs.mkdirSync(configDir, { recursive: true });
  // Staging and backups live outside skills/ so clients cannot discover duplicate skills.
  const staging = fs.mkdtempSync(path.join(configDir, '.hive-lite-stage-'));
  let backup = null;
  try {
    for (const [relative, bytes] of files) {
      const file = path.join(staging, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
    }
    if (installedState(staging, files) !== 'same') throw new Error('Staged skill verification failed.');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (state === 'different') {
      const backupsDir = path.join(configDir, 'hive-lite-backups');
      fs.mkdirSync(backupsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = fs.mkdtempSync(path.join(backupsDir, `${stamp}-`));
      backup = path.join(backupDir, 'hive-lite');
      rename(destination, backup);
      log(`Backup: ${backup}`);
    } else if (statIfPresent(destination)) {
      throw new Error(`Destination appeared during installation; left unchanged: ${destination}`);
    }
    rename(staging, destination);
    log(`Installed for ${target.clients.join(' and ')}: ${destination}`);
  } catch (error) {
    if (backup && statIfPresent(backup) && !statIfPresent(destination)) {
      try { rename(backup, destination); log(`Restored previous copy: ${destination}`); }
      catch (restoreError) {
        throw new Error(`${error.message}\nRestore failed: ${restoreError.message}\nPrevious copy retained at: ${backup}`);
      }
    }
    throw error;
  } finally {
    if (statIfPresent(staging)) fs.rmSync(staging, { recursive: true });
  }
}

function runFrenemy(script, argv, env) {
  const result = spawnSync(process.execPath, [script, ...argv], {
    cwd: path.dirname(script), env, stdio: 'inherit', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Frenemy stopped by ${result.signal}.`);
  return result.status ?? 1;
}

// Dependency injection keeps installer tests inside disposable directories.
export function main(argv = process.argv.slice(2), options = {}) {
  const root = options.root ?? ROOT;
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const errorLog = options.errorLog ?? console.error;
  const invokeFrenemy = options.runFrenemy ?? runFrenemy;
  const rename = options.rename ?? fs.renameSync;
  try {
    const args = parseArgs(argv);
    if (args.help) { log(HELP); return 0; }
    if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Install Node.js 18 or newer first.');
    const files = loadSkill(path.join(root, 'hive-lite'));
    const planned = targets(args, homeDir, env);
    // Preflight every skill destination before changing any of them.
    for (const target of planned) {
      const state = installedState(target.destination, files);
      log(`${target.clients.join(' / ')}: ${state === 'same' ? 'up to date' : state === 'new' ? 'ready to install' : 'update requires --replace'} — ${target.destination}`);
      if (state === 'different' && !args.replace && !args.check) {
        throw new Error('An existing skill differs. Run again with --replace to back it up and update it.');
      }
    }
    const frenemyScript = path.join(root, 'install.mjs');
    if (args.frenemy) {
      if (!fs.existsSync(frenemyScript)) throw new Error('Bundled Frenemy installer is missing. Extract the complete repository.');
      const check = invokeFrenemy(frenemyScript, ['--check'], env);
      if (check !== 0) throw new Error(`Frenemy preflight failed (exit ${check}); Hive-Lite was not installed.`);
    }
    if (args.check) { log('Check complete. No files were changed.'); return 0; }
    for (const target of planned) installTarget(target, files, { replace: args.replace, log, rename });
    if (args.frenemy) {
      log('Hive-Lite is installed. Starting Frenemy setup…');
      const result = invokeFrenemy(frenemyScript, args.prefix ? ['--prefix', args.prefix] : [], env);
      if (result !== 0) {
        errorLog(`Hive-Lite is installed, but Frenemy setup did not complete (exit ${result}). See its output above; rerunning this command leaves identical skills alone.`);
        return result;
      }
    }
    log('Done. Open a new Codex or Claude session to discover hive-lite.');
    log('Codex: $hive-lite setup    |    Claude: /hive-lite setup');
    log('Include your project, objective and mission directory in the request.');
    return 0;
  } catch (error) {
    errorLog(`Installation stopped: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
