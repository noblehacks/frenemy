'use strict';
// Test cleanup must keep the evidence recoverable, like production cleanup.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
module.exports = function retire(file) {
  try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const dest = path.join(os.tmpdir(), 'snitch-test-retired');
  fs.mkdirSync(dest, {recursive:true});
  fs.renameSync(file, path.join(dest, randomUUID()+'-'+path.basename(file)));
};
