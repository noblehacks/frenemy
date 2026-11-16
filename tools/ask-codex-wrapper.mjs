#!/usr/bin/env node
// Ask Codex one question, or give it one piece of work. The prompt arrives on standard input
// and is handed to Codex on its own standard input.
//   node tools/ask-codex-wrapper.mjs < prompt.txt
// CODEX_BIN, CODEX_TIMEOUT (seconds, 0 = no limit), CODEX_WRITE (1 = may write inside the
// folder it runs in; otherwise read-only) and FRENEMY_DRIVER are honoured.
// Exit: Codex's own code, or 1 no answer, 2 bad prompt, 3 no scratch file, 124 timed out,
// 127 Codex not found.
import fs from 'node:fs';
import {
  MAX_PROMPT, resolveBin, leave, defaultDriver, timeLimit, readStdin, trimPrompt,
  installCleanup, scratchFile, runApp, deliver,
} from './wrapper-common.mjs';

defaultDriver();
const bin = resolveBin('codex');
if (!bin) leave(127, `ask-codex: codex not found/executable at ${process.env.CODEX_BIN || ''}`);
const limit = timeLimit('CODEX_TIMEOUT', text => `ask-codex: CODEX_TIMEOUT must be a number, got '${text}'`);

const prompt = trimPrompt(await readStdin());
if (!prompt.length) leave(2, 'ask-codex: empty prompt');
if (prompt.length > MAX_PROMPT) leave(2, `ask-codex: prompt is ${prompt.length} bytes; cap is ${MAX_PROMPT}`);

installCleanup();
const out = scratchFile(), err = scratchFile(), input = scratchFile();
try { fs.writeFileSync(input, prompt); } catch { process.exit(3); }

const sandbox = process.env.CODEX_WRITE === '1' ? 'workspace-write' : 'read-only';
const code = await runApp({
  bin, args: ['exec', '--sandbox', sandbox, '--skip-git-repo-check', '-'],
  out, err, input, seconds: limit.seconds,
  onTimeout: () => leave(124, `ask-codex: codex timed out after ${limit.text}s and was killed`),
});
deliver('ask-codex', out, err, code);
