// Deliver only the picture that belongs to this request's own recorded conversation.
//   node tools/agy-image-delivery.mjs PROMPT /absolute/output.png
// Asks agy (through the ask-agy runner) for one picture, finds the file that conversation
// made, checks it is a real picture of a sensible size, and moves it into place in one step.
// Whatever was at the destination before is kept unless a good new picture replaces it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lock from '../snitch/extension/lib/joblock.js';
import { WIN, sleepSync, resolveBin, spawnCli, stopProcessTree, homeDir } from './platform.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// A stop signal ends the app that is running, then this program, before anything is delivered.
let running = null;       // the one child process this program owns right now
let stopSignal = 0;
const never = () => new Promise(() => {});

function onStop(name) {
  if (stopSignal) return;
  stopSignal = os.constants.signals[name] || 15;
  const leave = () => process.exit(128 + stopSignal);
  if (running && running.pid && running.exitCode === null && running.signalCode === null) {
    stopProcessTree(running.pid, 1000).then(leave, leave);
  } else leave();
}

/**
 * Run one program this delivery owns, in its own process group, and wait for it.
 * Resolves {rc, out}. A program that outlives `timeoutMs` is stopped with everything under it.
 */
function runOwned(command, args, options = {}) {
  const { input, timeoutMs = 30000, stdout = 'pipe', stderr = 'pipe', env = process.env } = options;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnCli(command, args, { stdio: [input === undefined ? 'ignore' : 'pipe', stdout, stderr], env, group: true });
    } catch (error) { reject(error); return; }
    running = child;
    const chunks = [];
    let timer = null, timedOut = false;
    if (child.stdout) child.stdout.on('data', chunk => chunks.push(chunk));
    if (child.stderr) child.stderr.on('data', () => {});
    if (child.stdin) {
      child.stdin.on('error', () => {});   // the program may stop reading early
      child.stdin.end(input);
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => { timedOut = true; stopProcessTree(child.pid, 1000); }, timeoutMs);
    }
    child.on('error', error => {
      if (timer) clearTimeout(timer);
      if (running === child) running = null;
      if (!stopSignal) reject(error);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (stopSignal) return;              // the stop handler ends the program
      if (running === child) running = null;
      if (timedOut) {
        const shown = [command, ...args].map(part => "'" + part + "'").join(', ');
        reject(new Error("Command '[" + shown + "]' timed out after " + Math.round(timeoutMs / 1000) + ' seconds'));
        return;
      }
      const rc = code === null ? -(os.constants.signals[signal] || 1) : code;
      resolve({ rc, out: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

// The command `name` from PATH, or the file itself when a path was given; null when absent.
function which(name) {
  if (!name) return null;
  if (name.includes('/') || (WIN && name.includes('\\'))) return resolveBin('chosen', 'CHOSEN', { CHOSEN: name });
  // One folder of PATH at a time, in PATH's own order, the way the system itself finds a command.
  // (Asked for all of PATH at once, resolveBin on Windows takes an .exe from a later folder ahead
  // of a .cmd launcher in an earlier one.)
  for (const dir of String(process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)) {
    const found = resolveBin(name, '', { PATH: dir });
    if (found) return found;
  }
  return null;
}

function isDir(target) {
  try { return fs.statSync(target).isDirectory(); } catch { return false; }
}

function isLink(target) {
  try { return fs.lstatSync(target).isSymbolicLink(); } catch { return false; }
}

function fingerprint(target) {
  if (isLink(target)) throw new Error('symlink destination refused');
  if (!fs.existsSync(target)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

// A copy that keeps the file's times as well as its contents.
function copyWithTimes(from, to) {
  fs.copyFileSync(from, to);
  try { const info = fs.statSync(from); fs.utimesSync(to, info.atime, info.mtime); } catch { /* contents are what matter */ }
}

function replace(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (error) {
      const retry = WIN && attempt < 10 && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code);
      if (!retry) throw error;
      sleepSync(20);
    }
  }
}

// The path as given, without doubled separators or "." parts ("..", like links, is left alone).
function tidyPath(text) {
  if (WIN) {
    const root = path.win32.parse(text).root;
    const rest = text.slice(root.length).split(/[\\/]+/).filter(part => part && part !== '.');
    return root.replace(/\//g, '\\') + rest.join('\\');
  }
  const lead = text.startsWith('/') ? '/' : '';
  return lead + text.split('/').filter(part => part && part !== '.').join('/') || lead || '.';
}

// What kind of picture a file is, and its size, read from the file's own first bytes. Used
// where the `file` command is not installed (Windows). Worded like that command's report.
function describePicture(target) {
  let b;
  try { b = fs.readFileSync(target); } catch { return 'cannot open'; }
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    if (b.length >= 24 && b.toString('latin1', 12, 16) === 'IHDR') {
      return 'PNG image data, ' + b.readUInt32BE(16) + ' x ' + b.readUInt32BE(20);
    }
    return 'PNG image data';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 <= b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const mark = b[i + 1];
      if (mark === 0xff) { i += 1; continue; }
      if (mark === 0x01 || (mark >= 0xd0 && mark <= 0xd9)) { i += 2; continue; }
      if (mark === 0xda) break;                      // picture data starts; no size was declared
      if (mark >= 0xc0 && mark <= 0xcf && mark !== 0xc4 && mark !== 0xc8 && mark !== 0xcc) {
        return 'JPEG image data, ' + b.readUInt16BE(i + 7) + 'x' + b.readUInt16BE(i + 5);
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return 'JPEG image data';
  }
  if (b.length >= 16 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const kind = b.toString('latin1', 12, 16);
    let size = '';
    if (kind === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      size = ', ' + (b.readUInt16LE(26) & 0x3fff) + 'x' + (b.readUInt16LE(28) & 0x3fff);
    } else if (kind === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      size = ', ' + ((bits & 0x3fff) + 1) + 'x' + (((bits >>> 14) & 0x3fff) + 1);
    } else if (kind === 'VP8X' && b.length >= 30) {
      size = ', ' + (b.readUIntLE(24, 3) + 1) + 'x' + (b.readUIntLE(27, 3) + 1);
    }
    return 'RIFF (little-endian) data, Web/P image' + size;
  }
  return 'data';
}

// The `file` command's report on a picture when that command is installed, else our own reading.
async function probe(target) {
  const tool = which('file');
  if (!tool) return { rc: 0, kind: describePicture(target) };
  const { rc, out } = await runOwned(tool, ['-b', target]);
  return { rc, kind: out };
}

// How the picture is asked for. FRENEMY_ASK_AGY replaces the runner in offline tests.
function askCommand() {
  let ask = process.env.FRENEMY_ASK_AGY;
  if (!ask) {
    const places = [path.join(HERE, '..', 'ask-agy.mjs'), path.join(HERE, 'ask-agy.mjs')];
    ask = places.find(place => fs.existsSync(place)) || places[0];
  }
  if (!/\.[cm]?js$/i.test(ask)) return [ask, []];
  if (!fs.existsSync(ask)) throw new Error('the agy runner was not found at ' + ask);
  return [process.execPath, [ask]];
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 2 || !argv[0].trim()) {
    throw new Error('usage: ask-agy-image.mjs PROMPT /absolute/output.png');
  }
  const prompt = argv[0];
  const out = tidyPath(argv[1]);
  const folder = path.dirname(out);
  if (!path.isAbsolute(out) || !isDir(folder)) {
    throw new Error('destination must be absolute with an existing parent');
  }
  const before = fingerprint(out);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'frenemy-image-'));
  const log = path.join(work, 'invocation.log'), answer = path.join(work, 'answer.txt');
  const started = BigInt(Date.now()) * 1000000n;
  const [command, commandArgs] = askCommand();
  const instruction = 'Generate an image: ' + prompt + '. Use built-in image generation. ' +
    'Do not save, copy, convert, move files, run shell commands, or delegate. ' +
    'After generation reply DONE.';
  const answerFd = fs.openSync(answer, 'w');
  let rc;
  try {
    ({ rc } = await runOwned(command, commandArgs, { input: instruction, timeoutMs: 0,
      stdout: answerFd, stderr: answerFd, env: { ...process.env, AGY_LOG_FILE: log } }));
  } finally { fs.closeSync(answerFd); }
  if (rc) {
    const detail = Array.from(fs.readFileSync(answer, 'utf8').slice(-4000)).slice(-2000).join('');
    throw new Error('generation failed (exit ' + rc + '); evidence retained at ' + work + '\n' + detail);
  }
  const data = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  const ids = new Set(Array.from(data.matchAll(/Created conversation ([0-9a-fA-F-]{36})\b/g), found => found[1]));
  if (ids.size !== 1) {
    throw new Error('cannot identify one originating conversation; evidence: ' + work);
  }
  const brain = path.join(homeDir(), '.gemini', 'antigravity-cli', 'brain');
  const conversation = path.join(brain, [...ids][0]);
  if (isLink(conversation) || !isDir(conversation)) {
    throw new Error('originating conversation directory missing or unsafe');
  }
  const candidates = fs.readdirSync(conversation).map(name => path.join(conversation, name)).filter(file => {
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(file).toLowerCase())) return false;
    const info = fs.lstatSync(file, { bigint: true });
    return !info.isSymbolicLink() && info.isFile() && info.mtimeNs >= started;
  });
  if (candidates.length !== 1) {
    throw new Error('expected one image from this request, found ' + candidates.length);
  }
  const src = candidates[0];
  const first = await probe(src);
  if (first.rc) throw new Error('image type probe failed');
  const kind = first.kind;
  if (!fs.statSync(src).size || !['JPEG image data', 'PNG image data', 'Web/P image'].some(type => kind.includes(type))) {
    throw new Error('generated file failed real-image validation');
  }
  // macOS ships sips. Elsewhere the size is read from the same report used above, whose last
  // "W x H" pair is the picture's own size.
  const sips = which(process.env.FRENEMY_SIPS === undefined ? 'sips' : process.env.FRENEMY_SIPS);
  let dims;
  if (sips) {
    const measured = await runOwned(sips, ['-g', 'pixelWidth', '-g', 'pixelHeight', src]);
    if (measured.rc) throw new Error('image dimension probe failed');
    dims = Array.from(measured.out.matchAll(/pixel(?:Width|Height):\s*(\d+)/g), found => found[1]);
  } else {
    const pairs = Array.from(kind.matchAll(/(\d+)\s*x\s*(\d+)/g));
    dims = pairs.length ? [pairs[pairs.length - 1][1], pairs[pairs.length - 1][2]] : [];
  }
  if (dims.length !== 2 || Math.min(...dims.map(Number)) < 256) {
    throw new Error('generated image dimensions are too small');
  }
  // Staged in the destination's own folder, so the last move is a single step.
  const delivery = fs.mkdtempSync(path.join(folder, '.frenemy-image-'));
  const staged = path.join(delivery, path.basename(out));
  const suffix = path.extname(out).toLowerCase();
  let want;
  if (['.png', '.jpg', '.jpeg'].includes(suffix)) {
    const format = suffix === '.png' ? 'png' : 'jpeg';
    want = format === 'png' ? 'PNG image data' : 'JPEG image data';
    // On Windows "convert" is a disk tool of the system, never ImageMagick.
    const converter = which('magick') || (WIN ? null : which('convert'));
    let converted;
    if (sips) {
      ({ rc: converted } = await runOwned(sips, ['-s', 'format', format, src, '--out', staged], { stdout: 'ignore', stderr: 'inherit' }));
    } else if (kind.includes(want)) {
      copyWithTimes(src, staged); converted = 0;      // already the wanted format: nothing to convert
    } else if (converter) {
      ({ rc: converted } = await runOwned(converter, [src, staged], { stdout: 'ignore', stderr: 'inherit' }));
    } else {
      throw new Error('image conversion needs sips (macOS) or ImageMagick; original destination preserved');
    }
    if (converted) throw new Error('image conversion failed; original destination preserved');
  } else {
    copyWithTimes(src, staged);
    want = 'image';
  }
  const second = await probe(staged);
  if (second.rc) throw new Error('converted output probe failed');
  let stagedFile = null;
  try { stagedFile = fs.statSync(staged); } catch { /* nothing was written */ }
  if (!stagedFile || !stagedFile.isFile() || !stagedFile.size || !second.kind.includes(want)) {
    throw new Error('converted output failed validation; original destination preserved');
  }
  // One delivery at a time into this folder.
  await lock.withLock(folder, '.frenemy-image', () => {
    if (stopSignal) return;
    if (fingerprint(out) !== before) {
      throw new Error('destination changed during generation; refusing overwrite');
    }
    if (fs.existsSync(out)) copyWithTimes(out, path.join(delivery, 'previous-output'));
    replace(staged, out);
  }, { timeoutMs: 130000 });
  if (stopSignal) await never();
  console.log(out);
}

for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(name, () => onStop(name));
main().catch(error => {
  if (stopSignal) return;
  process.stderr.write('ask-agy-image: ' + ((error && error.message) || error) + '\n');
  process.exitCode = 1;
});
