#!/usr/bin/env node
// Regenerate the release integrity manifest after an intentional source edit.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))));

// Every file in the release, as lists of path parts. A git checkout's own folder is not part of it.
const files = [];
let links = false;
function walk(dir, parts) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '.git') continue;
    const here = parts.concat(item.name);
    if (item.isSymbolicLink()) links = true;
    else if (item.isDirectory()) walk(path.join(dir, item.name), here);
    else if (item.isFile() && item.name !== 'MANIFEST.json' && item.name !== '.DS_Store' && !here.includes('__pycache__')) files.push(here);
  }
}
walk(root, []);
if (links) {
  console.error('Refusing to package symlinks.');
  process.exit(1);
}

// Sorted folder by folder, the same order on every system.
files.sort((a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
});
const listed = {};
for (const parts of files) {
  listed[parts.join('/')] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, ...parts))).digest('hex');
}
const text = JSON.stringify({ version: '2.0.0', files: listed }, null, 2)
  .replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
fs.writeFileSync(path.join(root, 'MANIFEST.json'), text);
