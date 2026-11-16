// Look for a marker word in each AI app's own recent logs.
//   node tools/prove.mjs MARKER-WORD  claude|codex|agy|kimi
// HOURS (default 24) sets how far back to look. Exit 0 when the marker is in the named app's
// logs, 1 when it is not, 2 when the command was not given what it needs.
// Finding the marker shows only that the text is there; it does not prove a consultation.
import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './platform.mjs';

const USAGE = 'usage: prove.mjs MARKER-WORD  claude|codex|agy|kimi';
const DASH = String.fromCharCode(0x2014);   // the long dash the earlier version printed

function refuse(message) {
  process.stderr.write(message + '\n');
  return 2;
}

// Read in pieces, so a very large log is never held in memory whole. A marker of several
// lines counts as found when any one of its lines is found.
function hasMarker(file, needles) {
  const overlap = Math.max(0, ...needles.map(needle => needle.length - 1));
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return false; }
  try {
    const piece = Buffer.allocUnsafe(1 << 20);
    let carried = Buffer.alloc(0);
    for (;;) {
      const count = fs.readSync(fd, piece, 0, piece.length, null);
      if (!count) return false;
      const view = Buffer.concat([carried, piece.subarray(0, count)]);
      if (needles.some(needle => needle.length === 0 || view.includes(needle))) return true;
      carried = Buffer.from(view.subarray(Math.max(0, view.length - overlap)));
    }
  } catch { return false; }
  finally { try { fs.closeSync(fd); } catch { /* already closed */ } }
}

// Every real file under `root` (links are not followed) whose name fits and which changed
// within the last `minutes`: how many hold the marker, and the first one that does.
function countHits(root, nameFits, minutes, needles) {
  let count = 0, first = '';
  const now = Date.now();
  const visit = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { visit(full); continue; }
      if (!entry.isFile() || !nameFits(entry.name)) continue;
      let changed;
      try { changed = fs.lstatSync(full).mtimeMs; } catch { continue; }
      if (now - changed >= minutes * 60000) continue;
      if (hasMarker(full, needles)) { count += 1; if (!first) first = full; }
    }
  };
  let top = null;
  try { top = fs.lstatSync(root); } catch { /* no such folder */ }
  if (top && top.isDirectory()) visit(root);
  return { count, first };
}

// The exit code is returned and the program left to end by itself, so no printed line is cut short.
function main() {
  const marker = process.argv[2] === undefined ? '' : process.argv[2];
  const who = (process.argv[3] === undefined ? '' : process.argv[3]).toLowerCase();
  const hours = process.env.HOURS ? process.env.HOURS : '24';
  if (/[^0-9]/.test(hours)) return refuse('HOURS must be a positive integer');
  if (hours.length > 5 || Number(hours) <= 0) return refuse('HOURS out of range');
  const minutes = Number(hours) * 60;
  if (!['claude', 'codex', 'agy', 'kimi'].includes(who)) return refuse(USAGE);
  if (!marker) return refuse(USAGE);

  const needles = marker.split('\n').map(line => Buffer.from(line, 'utf8'));
  const home = homeDir();
  const counts = {};
  const row = (label, root, nameFits) => {
    const { count, first } = countHits(root, nameFits, minutes, needles);
    counts[label] = count;
    if (count === 0) console.log('  ' + label.padEnd(7) + ' no trace');
    else {
      const shown = home && first.startsWith(home) ? '~' + first.slice(home.length) : first;
      console.log('  ' + label.padEnd(7) + ' ' + count + ' log(s), e.g. ' + shown);
    }
  };

  console.log('Marker : "' + marker + '"');
  console.log('Asked  : ' + who + '   (marker search only; provenance needs separate checks)');
  console.log('');
  row('CLAUDE', path.join(home, '.claude', 'projects'), name => name.endsWith('.jsonl'));
  row('CODEX', path.join(home, '.codex', 'sessions'),
    name => name.length >= 14 && name.startsWith('rollout-') && name.endsWith('.jsonl'));
  row('AGY', path.join(home, '.gemini', 'antigravity-cli', 'brain'), name => name === 'transcript.jsonl');
  row('KIMI', path.join(home, '.kimi-code', 'sessions'), name => name === 'wire.jsonl');
  console.log('');

  if (counts[who.toUpperCase()] > 0) {
    console.log('VERDICT: MARKER FOUND ' + DASH + ' literal text occurs in ' + who + "'s log. A real consultation is NOT PROVEN by this check.");
    return 0;
  }
  console.log('VERDICT: NOT PROVEN ' + DASH + ' nothing in ' + who + "'s log.");
  console.log('         Either the consult never happened, or the asking model reworded your');
  console.log('         marker instead of passing it through. Retry and say: pass the word EXACTLY.');
  return 1;
}

process.exitCode = main();
