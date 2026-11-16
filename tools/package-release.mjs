#!/usr/bin/env node
// Build a reproducible source bundle from the verified manifest; never overwrite.
//   node tools/package-release.mjs <output.zip>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { verify } from '../install.mjs';
import { homeDir } from './platform.mjs';

const ROOT = path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))));
const WIN = process.platform === 'win32';

function stop(message) {
  console.error(message);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log('usage: node tools/package-release.mjs <output.zip>\n\nBuild a reproducible source bundle from the verified manifest; never overwrite.');
  process.exit(0);
}
if (argv.length !== 1 || argv[0].startsWith('-')) {
  console.error('usage: node tools/package-release.mjs <output.zip>');
  process.exit(2);
}

try { verify(ROOT); } catch (error) { stop(error.message); }

let wanted = argv[0];
if (wanted === '~') wanted = homeDir();
else if (wanted.startsWith('~/') || (WIN && wanted.startsWith('~\\'))) wanted = path.join(homeDir(), wanted.slice(2));
const output = path.resolve(wanted);
const sumFile = output + '.sha256';
if (fs.existsSync(output) || fs.existsSync(sumFile)) stop('Output exists; choose a fresh destination.');
const rel = path.relative(ROOT, output);
if (rel === '' || !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))) stop('Output must be outside the release source.');

// ---- a zip file, written by hand so that the same files always give the same bytes --------

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 15;      // every entry is dated 2026-11-15 00:00:00
const DOS_TIME = 0;
const REGULAR_FILE = 0o100000;

// On macOS and Linux a file that can be run stays runnable. Windows keeps no such mark, so
// there a shell script is marked runnable, and so is a file without an ending that starts with "#!".
function runnable(file, bytes) {
  if (!WIN) return (fs.statSync(file).mode & 0o111) !== 0;
  const ending = path.extname(file);
  return ending === '.sh' || (ending === '' && bytes.length > 1 && bytes[0] === 0x23 && bytes[1] === 0x21);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8'));
const names = [...Object.keys(manifest.files), 'MANIFEST.json'].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
if (names.length > 0xFFFE) stop('Too many files for this packer.');

const chunks = [], central = [];
let offset = 0;
for (const name of names) {
  const file = path.join(ROOT, ...name.split('/'));
  const bytes = fs.readFileSync(file);
  const packed = zlib.deflateRawSync(bytes, { level: 9 });
  const nameBytes = Buffer.from('frenemy-2.0.0/' + name, 'utf8');
  const flags = /[^\u0000-\u007f]/.test(name) ? 0x0800 : 0;      // the name is UTF-8
  const crc = crc32(bytes);
  if (bytes.length > 0xFFFFFFFE || packed.length > 0xFFFFFFFE) stop('A file is too large for this packer: ' + name);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);                 // version needed
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(8, 8);                  // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE((3 << 8) | 20, 4);      // made on Unix
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(flags, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(DOS_TIME, 12);
  entry.writeUInt16LE(DOS_DATE, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(bytes.length, 24);
  entry.writeUInt16LE(nameBytes.length, 28);
  entry.writeUInt16LE(0, 30);                 // extra
  entry.writeUInt16LE(0, 32);                 // comment
  entry.writeUInt16LE(0, 34);                 // disk
  entry.writeUInt16LE(0, 36);                 // internal attributes
  entry.writeUInt32LE(((REGULAR_FILE | (runnable(file, bytes) ? 0o755 : 0o644)) << 16) >>> 0, 38);
  entry.writeUInt32LE(offset, 42);

  chunks.push(local, nameBytes, packed);
  central.push(entry, nameBytes);
  offset += local.length + nameBytes.length + packed.length;
  if (offset > 0xFFFFFFFE) stop('The bundle is too large for this packer.');
}
const centralBytes = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(names.length, 8);
end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(centralBytes.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

const bundle = Buffer.concat([...chunks, centralBytes, end]);
try { fs.writeFileSync(output, bundle, { flag: 'wx' }); }      // never over an existing file
catch (error) { stop(error.code === 'EEXIST' ? 'Output exists; choose a fresh destination.' : 'Could not write ' + output + ': ' + error.message); }
const digest = crypto.createHash('sha256').update(bundle).digest('hex');
fs.writeFileSync(sumFile, digest + '  ' + path.basename(output) + '\n');
console.log(output);
console.log('SHA256', digest);
