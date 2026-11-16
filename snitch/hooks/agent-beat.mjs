#!/usr/bin/env node
// Snitch reporter for Codex, Kimi and agy. Each app starts it as a hook:
//
//   <node> agent-beat.mjs <codex|kimi|agy> [beat|done|fail]      with the hook's JSON note on standard input
//
// It keeps the chat's row in the Snitch panel up to date. agy expects a JSON object back and
// gets "{}"; the other apps get no output at all. The work is in beat-lib.mjs. Whatever goes
// wrong there, this file ends quietly with success: a reporter is never allowed to break the
// app that calls it.
import fs from 'node:fs';

const received = typeof performance === 'object' && performance.timeOrigin ? performance.timeOrigin : Date.now();
let answered = false;
const answer = () => {
  if (answered || process.argv[2] !== 'agy') return;
  answered = true;
  try { fs.writeSync(1, '{}\n'); } catch { /* nobody is listening */ }
};
process.on('uncaughtException', () => { answer(); process.exit(0); });
process.on('unhandledRejection', () => { answer(); process.exit(0); });
try {
  const reporter = await import('./beat-lib.mjs');
  reporter.agentMain(process.argv.slice(2), received);
} catch { /* the row is simply not updated this time */ }
answer();
process.exitCode = 0;
