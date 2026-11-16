#!/usr/bin/env node
// Snitch reporter for Claude Code. Claude Code starts it as a hook:
//
//   <node> claude-beat.mjs [beat|done|fail]      with the hook's JSON note on standard input
//
// It keeps the chat's row in the Snitch panel up to date and prints nothing. The work is in
// beat-lib.mjs. Whatever goes wrong there, this file ends quietly with success: a reporter is
// never allowed to break the app that calls it.
const received = typeof performance === 'object' && performance.timeOrigin ? performance.timeOrigin : Date.now();
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));
try {
  const reporter = await import('./beat-lib.mjs');
  reporter.claudeMain(process.argv.slice(2), received);
} catch { /* the row is simply not updated this time */ }
process.exitCode = 0;
