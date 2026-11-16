// Offline tests for agy-image-delivery.mjs.  Run: node tools/test-image-delivery.mjs
//
// The picture maker (FRENEMY_ASK_AGY) and the app's conversation store (HOME) are fakes. Most
// cases also fake the `file` and `sips` commands; the compact PNG case uses the computer's
// real ones. No real provider, no network, no picture is opened.
// Cases run strictly one at a time, each with a time limit. All evidence is kept under a temp
// folder that is never deleted.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WIN, resolveBin, stopProcessTree } from './platform.mjs';

const DELIVERY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agy-image-delivery.mjs');
const EVIDENCE = fs.mkdtempSync(path.join(os.tmpdir(), 'image-delivery-tests-'));
const REAL_PATH = process.env.PATH || process.env.Path || '';

const FAKE_FILE = `
process.stdout.write((process.env.FAKE_FILE_BAD ? 'data' : 'PNG image data') + '\\n');
`;

const FAKE_SIPS = `
const fs = require('fs');
const args = process.argv.slice(2);
if (process.env.FAKE_SIPS_FAIL && args.includes('--out')) {
  process.stderr.write('sips: simulated failure\\n');
  process.exit(1);
}
if (args.includes('-g')) {
  console.log('pixelWidth: 1024');
  console.log('pixelHeight: 1024');
} else {
  const at = args.indexOf('--out');
  fs.copyFileSync(args[at - 1], args[at + 1]);
}
`;

const FAKE_ASK = `
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const prompt = fs.readFileSync(0, 'utf8');
if (!prompt.startsWith('Generate an image: ')) process.exit(2);
const mode = process.env.FAKE_GEN_MODE || 'ok';
const uid = process.env.FAKE_UUID;
const log = process.env.AGY_LOG_FILE || 'invocation.log';
if (mode === 'fail') {
  process.stderr.write('simulated generator failure\\n');
  process.exit(3);
}
if (mode === 'ambiguous') {
  fs.writeFileSync(log, 'Created conversation 11111111-1111-1111-1111-111111111111\\n' +
    'Created conversation 22222222-2222-2222-2222-222222222222\\n');
  console.log('DONE');
  process.exit(0);
}
fs.writeFileSync(log, 'Created conversation ' + uid + '\\n');
if (process.env.FAKE_TOUCH_IMAGE) {
  // A real maker creates the picture during the request, so the check that the picture is
  // newer than the start of the request sees it as fresh.
  const source = process.env.FAKE_IMAGE_SOURCE;
  fs.writeFileSync(path.join(process.env.FAKE_CONV, 'image.png'),
    source ? fs.readFileSync(source) : require('crypto').randomBytes(60000));
}
if (mode === 'slow') {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { detached: true, stdio: 'ignore' });
  fs.writeFileSync(process.env.FAKE_PID_FILE, String(child.pid));
  setTimeout(() => process.exit(0), 600000);
} else {
  if (mode === 'conflict') fs.writeFileSync(process.env.FAKE_OUT, 'CHANGED WHILE GENERATING');
  console.log('DONE');
}
`;

// A fake command for PATH: an executable Node script on macOS and Linux, and on Windows a
// script with the small .cmd launcher that npm would put in front of it.
function writeCommand(dir, name, code) {
  if (WIN) {
    fs.writeFileSync(path.join(dir, name + '.cjs'), code);
    fs.writeFileSync(path.join(dir, name + '.cmd'), '@node "%~dp0\\' + name + '.cjs" %*\r\n');
    return path.join(dir, name + '.cmd');
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/usr/bin/env node' + code);
  fs.chmodSync(file, 0o755);
  return file;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitDead(pid, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await sleep(100);
  }
  return !pidAlive(pid);
}

// One isolated delivery, with its fakes wired in through the environment.
class Case {
  constructor(name) {
    this.dir = path.join(EVIDENCE, name);
    fs.mkdirSync(this.dir);
    this.home = path.join(this.dir, 'home');
    this.uuid = crypto.randomUUID();
    this.conv = path.join(this.home, '.gemini', 'antigravity-cli', 'brain', this.uuid);
    fs.mkdirSync(this.conv, { recursive: true });
    this.out = path.join(this.dir, 'output.png');
    this.bin = path.join(this.dir, 'bin');
    fs.mkdirSync(this.bin);
    writeCommand(this.bin, 'file', FAKE_FILE);
    writeCommand(this.bin, 'sips', FAKE_SIPS);
    this.ask = path.join(this.dir, 'fake-ask.cjs');
    fs.writeFileSync(this.ask, FAKE_ASK);
    this.pidfile = path.join(this.dir, 'fake-child.pid');
  }

  seedImage(fresh = true, size = 60000) {
    const img = path.join(this.conv, 'image.png');
    fs.writeFileSync(img, crypto.randomBytes(size));
    if (!fresh) fs.utimesSync(img, 1000000000, 1000000000);
    return img;
  }

  env(mode = 'ok') {
    const env = { ...process.env,
      HOME: this.home,
      USERPROFILE: this.home,
      // The fakes first; then this Node's own folder, so "env node" finds the Node running the test.
      PATH: [this.bin, path.dirname(process.execPath), REAL_PATH].join(path.delimiter),
      FRENEMY_ASK_AGY: this.ask,
      FAKE_UUID: this.uuid,
      FAKE_GEN_MODE: mode,
      FAKE_OUT: this.out,
      FAKE_PID_FILE: this.pidfile,
      FAKE_CONV: this.conv,
      FAKE_TOUCH_IMAGE: '1',
    };
    for (const name of ['Path', 'FAKE_SIPS_FAIL', 'FAKE_FILE_BAD', 'FAKE_IMAGE_SOURCE', 'FRENEMY_SIPS']) delete env[name];
    return env;
  }

  cmd() { return [DELIVERY, 'a pony', this.out]; }

  run(mode = 'ok', env = this.env(mode)) {
    const done = spawnSync(process.execPath, this.cmd(), { env, encoding: 'utf8', timeout: 60000 });
    if (done.error) throw done.error;
    return done;
  }
}

function check(condition, label) {
  if (!condition) throw new Error(label);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function check512(file) {
  const sips = resolveBin('sips', '', { PATH: REAL_PATH });
  const fileTool = resolveBin('file', '', { PATH: REAL_PATH });
  let ok;
  if (sips) {
    const dimensions = spawnSync(sips, ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8', timeout: 30000 }).stdout || '';
    ok = dimensions.includes('pixelWidth: 512') && dimensions.includes('pixelHeight: 512');
  } else if (fileTool) {
    ok = (spawnSync(fileTool, ['-b', file], { encoding: 'utf8', timeout: 30000 }).stdout || '').includes('512 x 512');
  } else {
    const bytes = fs.readFileSync(file);     // no picture tools on this computer: read the PNG header
    ok = bytes.readUInt32BE(16) === 512 && bytes.readUInt32BE(20) === 512;
  }
  check(ok, 'delivered image must decode at the original dimensions');
}

async function testSuccess() {
  const c = new Case('success');
  const rc = c.run('ok');
  check(rc.status === 0, 'exit ' + rc.status + ': ' + rc.stderr);
  check(fs.readFileSync(c.out).equals(fs.readFileSync(path.join(c.conv, 'image.png'))), 'delivered content mismatch');
  check(rc.stdout.includes(c.out), 'stdout missing delivered path');
}

async function testGenerationFailure() {
  const c = new Case('generation-failure');
  fs.writeFileSync(c.out, 'ORIGINAL');
  const rc = c.run('fail');
  check(rc.status === 1, 'exit ' + rc.status + ': ' + rc.stdout);
  check(rc.stderr.includes('generation failed'), 'stderr: ' + rc.stderr);
  check(fs.readFileSync(c.out, 'utf8') === 'ORIGINAL', 'destination not preserved');
}

// A real, flat 512px PNG. It compresses well below 50KB: size is not image validity.
function writeRealPng(dir) {
  const chunk = (kind, data) => {
    const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const source = path.join(dir, 'source.png');
  const line = Buffer.concat([Buffer.from([0]), Buffer.alloc(512 * 3)]);
  for (let i = 0; i < 512; i++) line.set([0x00, 0x60, 0xff], 1 + i * 3);
  const pixels = Buffer.concat(Array.from({ length: 512 }, () => line));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(512, 0); header.writeUInt32BE(512, 4); header[8] = 8; header[9] = 2;
  fs.writeFileSync(source, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
  check(fs.statSync(source).size < 51200, 'fixture must be a compact real PNG');
  return source;
}

async function testSmallValidPngWithRealValidators() {
  const c = new Case('small-real-png');
  const source = writeRealPng(c.dir);
  let env = c.env();
  env.PATH = REAL_PATH;   // The computer's real file (and sips on macOS), not the test fakes.
  env.FAKE_IMAGE_SOURCE = source;
  let rc = c.run('ok', env);
  check(rc.status === 0, rc.stderr);
  check512(c.out);
  // The same real picture on a computer without sips (Linux): size from `file`, no conversion needed.
  const other = new Case('small-real-png-no-sips');
  env = other.env();
  env.PATH = REAL_PATH;
  env.FAKE_IMAGE_SOURCE = source;
  env.FRENEMY_SIPS = WIN ? 'C:\\nonexistent\\sips' : '/nonexistent/sips';
  rc = other.run('ok', env);
  check(rc.status === 0, rc.stderr);
  check(fs.readFileSync(other.out).equals(fs.readFileSync(source)), 'a PNG asked for as PNG is delivered unchanged');
  check512(other.out);
}

// Not in the original: a computer with no picture tools at all (Windows itself). The type
// and size then come from the file's own first bytes.
async function testNoPictureTools() {
  const c = new Case('no-picture-tools');
  const source = writeRealPng(c.dir);
  const empty = path.join(c.dir, 'empty-path');
  fs.mkdirSync(empty);
  const bare = other => {
    const env = other.env();
    env.PATH = empty;
    env.FAKE_IMAGE_SOURCE = source;
    return env;
  };
  let rc = c.run('ok', bare(c));
  check(rc.status === 0, rc.stderr);
  check(fs.readFileSync(c.out).equals(fs.readFileSync(source)), 'the PNG is delivered unchanged');
  // A JPEG was asked for, the maker made a PNG, and nothing here can convert it.
  const jpeg = new Case('no-picture-tools-jpeg');
  jpeg.out = path.join(jpeg.dir, 'output.jpg');
  fs.writeFileSync(jpeg.out, 'ORIGINAL');
  rc = jpeg.run('ok', bare(jpeg));
  check(rc.status === 1, 'exit ' + rc.status + ': ' + rc.stdout);
  check(rc.stderr.includes('image conversion needs sips (macOS) or ImageMagick'), 'stderr: ' + rc.stderr);
  check(fs.readFileSync(jpeg.out, 'utf8') === 'ORIGINAL', 'destination not preserved');
  // Bytes that are not a picture are refused.
  const junk = new Case('no-picture-tools-junk');
  const env = bare(junk);
  delete env.FAKE_IMAGE_SOURCE;
  rc = junk.run('ok', env);
  check(rc.status === 1, 'exit ' + rc.status + ': ' + rc.stdout);
  check(rc.stderr.includes('generated file failed real-image validation'), 'stderr: ' + rc.stderr);
}

async function testConversionFailure() {
  const c = new Case('conversion-failure');
  fs.writeFileSync(c.out, 'ORIGINAL');
  const env = c.env('ok');
  env.FAKE_SIPS_FAIL = '1';
  const rc = c.run('ok', env);
  check(rc.status === 1, 'exit ' + rc.status + ': ' + rc.stdout);
  check(rc.stderr.includes('conversion failed'), 'stderr: ' + rc.stderr);
  check(fs.readFileSync(c.out, 'utf8') === 'ORIGINAL', 'destination not preserved');
}

async function testStaleProvenance() {
  const c = new Case('stale-provenance');
  c.seedImage(false);
  const env = c.env('ok');
  delete env.FAKE_TOUCH_IMAGE;   // the maker leaves the old picture from before the request alone
  const rc = c.run('ok', env);
  check(rc.status === 1, 'exit ' + rc.status + ': ' + rc.stdout);
  check(rc.stderr.includes('found 0'), 'stderr: ' + rc.stderr);
}

async function testAmbiguousProvenance() {
  const c = new Case('ambiguous-provenance');
  const rc = c.run('ambiguous');
  check(rc.status === 1, 'exit ' + rc.status + ': ' + rc.stdout);
  check(rc.stderr.includes('cannot identify one originating conversation'), 'stderr: ' + rc.stderr);
}

async function testDestinationConflict() {
  const c = new Case('destination-conflict');
  fs.writeFileSync(c.out, 'ORIGINAL');
  const rc = c.run('conflict');
  check(rc.status === 1, 'exit ' + rc.status + ': ' + rc.stdout);
  check(rc.stderr.includes('destination changed during generation'), 'stderr: ' + rc.stderr);
  check(fs.readFileSync(c.out, 'utf8') === 'CHANGED WHILE GENERATING', 'mid-run content overwritten');
}

async function testCancellationAndNoOrphan() {
  const c = new Case('cancellation');
  c.seedImage();
  fs.writeFileSync(c.out, 'ORIGINAL');
  const proc = spawn(process.execPath, c.cmd(), { env: c.env('slow'), stdio: 'ignore' });
  const ended = new Promise(resolve => proc.on('exit', (code, signal) => resolve(code === null ? signal : code)));
  let childPid = null;
  try {
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(c.pidfile) && Date.now() < deadline && proc.exitCode === null && proc.signalCode === null) await sleep(50);
    check(fs.existsSync(c.pidfile), 'fake child never started');
    await sleep(50);                       // the pid is written a moment after the file appears
    childPid = Number(fs.readFileSync(c.pidfile, 'utf8'));
    check(Number.isInteger(childPid) && childPid > 0, 'fake child pid unreadable');
    proc.kill('SIGTERM');
    const rc = await Promise.race([ended, sleep(10000).then(() => 'still running after 10s')]);
    check(rc === 128 + os.constants.signals.SIGTERM, 'exit ' + rc);
    check(fs.readFileSync(c.out, 'utf8') === 'ORIGINAL', 'destination not preserved on cancellation');
    check(await waitDead(childPid), 'orphan owned child ' + childPid + ' still alive');
    await sleep(100);
    check(!pidAlive(childPid), 'child remained after second check');
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) { proc.kill('SIGKILL'); await ended; }
    if (childPid && pidAlive(childPid)) await stopProcessTree(childPid, 0);
  }
}

const cases = [
  ['success', testSuccess],
  ['small valid png with real validators', testSmallValidPngWithRealValidators],
  ['generation failure', testGenerationFailure],
  ['conversion failure', testConversionFailure],
  ['stale provenance', testStaleProvenance],
  ['ambiguous provenance', testAmbiguousProvenance],
  ['destination conflict', testDestinationConflict],
  ['cancellation and no orphan', testCancellationAndNoOrphan],
  ['no picture tools: type and size read from the file itself', testNoPictureTools],
];

let pass = 0;
const failures = [];
for (const [name, fn] of cases) {
  if (WIN && fn === testCancellationAndNoOrphan) {
    console.log('  skip  ' + name + ' (a stop signal cannot be caught on Windows)');
    continue;
  }
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (error) { failures.push(name); console.log('  FAIL  ' + name + ' -> ' + ((error && error.message) || error)); }
}
console.log('evidence retained at ' + EVIDENCE);
console.log('\n' + pass + '/' + (pass + failures.length) + ' image delivery tests passed' +
  (failures.length ? '; FAILED: ' + failures.join(', ') : ''));
process.exit(failures.length ? 1 : 0);
