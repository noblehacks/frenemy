// Checks the two shared parts everything else stands on: the lock and the cross-system helpers.
// Run: node tools/test-platform.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lock from '../snitch/extension/lib/joblock.js';
import * as P from './platform.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK_FILE = path.join(HERE, '..', 'snitch', 'extension', 'lib', 'joblock.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frenemy-platform-test-'));
let passed = 0, failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS: ' : 'FAIL: ') + name + (extra ? ' (' + extra + ')' : '')); ok ? passed++ : failed++; };
const closed = child => new Promise(resolve => child.on('close', resolve));
const node = (code, args = [], options = {}) => spawn(process.execPath, ['-e', code, ...args], options);

// 1. Many processes changing one file under the lock never lose an update.
const counter = path.join(dir, 'count.txt');
const worker = `const {withLockSync}=require(process.argv[1]);const fs=require('fs');
for(let i=0;i<40;i++)withLockSync(process.argv[2],'count',()=>{let v=0;try{v=Number(fs.readFileSync(process.argv[3],'utf8'))}catch{}fs.writeFileSync(process.argv[3],String(v+1))});`;
await Promise.all(Array.from({ length: 6 }, () => closed(node(worker, [LOCK_FILE, dir, counter], { stdio: 'inherit' }))));
check('6 processes x 40 locked updates give 240', fs.readFileSync(counter, 'utf8') === '240', fs.readFileSync(counter, 'utf8'));
check('no lock is left behind', !fs.existsSync(path.join(dir, 'count.d')));

// 2. A holder that dies without releasing does not block the next one.
const holder = node(`require(process.argv[1]).acquireSync(process.argv[2],'dead');console.log('held');setInterval(()=>{},1000);`,
  [LOCK_FILE, dir], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(resolve => holder.stdout.once('data', resolve));
check('a held lock is refused when not waiting', lock.acquireSync(dir, 'dead', { wait: false }) === null);
holder.kill('SIGKILL'); await closed(holder);
let taken = null;
try { taken = lock.acquireSync(dir, 'dead', { timeoutMs: 8000 }); } catch { /* reported below */ }
check('a dead holder\'s lock is taken over', Boolean(taken));
if (taken) taken.release();
check('a released lock is gone', !fs.existsSync(path.join(dir, 'dead.d')));

// 3. Holders that wait on other things never overlap.
const order = [];
await Promise.all([1, 2, 3].map(i => lock.withLock(dir, 'turns', async () => {
  order.push('in' + i); await new Promise(resolve => setTimeout(resolve, 30)); order.push('out' + i);
})));
check('waiting holders never overlap', /^(in(\d),out\2,?){3}$/.test(order.join(',')), order.join(','));

// 4. Finding and starting a command.
check('resolveBin finds node', Boolean(P.resolveBin('node')));
check('resolveBin gives nothing for a switched-off app',
  P.resolveBin('codex', 'CODEX_BIN', { ...process.env, CODEX_BIN: path.join(dir, 'not-there') }) === null);
const text = 'two\nlines "quoted" $HOME `tick` 100%';
const echo = P.spawnCli(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', text], { stdio: ['ignore', 'pipe', 'inherit'], group: true });
let out = ''; echo.stdout.on('data', chunk => { out += chunk; }); await closed(echo);
check('spawnCli passes awkward text unchanged', out === text);

// 5. Listing and stopping a process tree.
const parent = node(`const {spawn}=require('child_process');for(let i=0;i<2;i++)spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('up');setInterval(()=>{},1000);`,
  [], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(resolve => parent.stdout.once('data', resolve));
await new Promise(resolve => setTimeout(resolve, 300));
const before = P.ownedTree(parent.pid, P.processSnapshot());
check('the snapshot sees a parent and its two children', before.size === 3, 'saw ' + before.size);
const stopped = await P.stopProcessTree(parent.pid, 500);
const after = P.processSnapshot();
check('stopProcessTree says it stopped them', stopped === true);
check('none of them is still running', ![...before.values()].some(target => P.stillOwned(target, after)));

// 6. Windows launcher text. The sample is the well-known shape npm writes; it has not been
// run on a Windows computer from here, only read by this function.
const shimText = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n' +
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
const shim = P.readCmdShim(shimText, 'C:\\Users\\a b\\AppData\\Roaming\\npm\\codex.cmd');
check('an npm launcher gives up its real program', Boolean(shim) && shim.node === true &&
  shim.target === 'C:\\Users\\a b\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js');
check('a launcher it cannot read gives nothing', P.readCmdShim('@echo off\r\necho hi\r\n', 'C:\\x\\y.cmd') === null);
check('a Windows argument is quoted whole', P.quoteCmdArg('a "b" & c') === '^"a^ \\^"b\\^"^ ^&^ c^"');
check('portablePath leaves a Mac or Linux path alone', P.WIN || P.portablePath('/a/b c') === '/a/b c');

console.log(passed + '/' + (passed + failed) + ' platform and lock tests passed');
process.exit(failed ? 1 : 0);
