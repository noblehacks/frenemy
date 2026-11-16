#!/usr/bin/env node
// Ask Kimi one question, or (KIMI_FULL=1) give it one piece of work with full rights.
//   node ask-kimi.mjs "PROMPT"      or the prompt on standard input
// KIMI_BIN, KIMI_TIMEOUT (seconds, 0 = no limit), KIMI_FULL, KIMI_AGENT_FILE, NODE_BIN and
// FRENEMY_DRIVER are honoured. Without KIMI_FULL=1 Kimi runs under the read-only consult
// profile, and the wrapper refuses to run when that profile is missing.
// Exit: Kimi's own code, or 1 no answer, 2 bad prompt or usage, 3 no Node, no profile or no
// scratch file, 124 timed out, 127 Kimi not found.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_OUT, ERR_SHOWN, resolveBin, emit, say, leave, defaultDriver, timeLimit, argumentPrompt,
  installCleanup, scratchFile, runApp, sizeOf, head,
} from './tools/wrapper-common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

defaultDriver();
const agentFile = process.env.KIMI_AGENT_FILE || path.join(HERE, 'tools', 'kimi-consult-agent.md');

const bin = resolveBin('kimi');
if (!bin) leave(127, `ask-kimi: kimi not found/executable at ${process.env.KIMI_BIN || ''}`);
// The answer is read by this same Node. NODE_BIN is still checked, as before, when it is set.
if (process.env.NODE_BIN && !resolveBin('node')) leave(3, `ask-kimi: node not found/executable at ${process.env.NODE_BIN}`);

const limit = timeLimit('KIMI_TIMEOUT', text => `ask-kimi: KIMI_TIMEOUT must be a number, got '${text}'`);
const prompt = await argumentPrompt('ask-kimi');

const modeArgs = [];
if (process.env.KIMI_FULL === '1') {
  say('ask-kimi: FULL-RIGHTS seat (Kimi may write files and run shell commands)');
} else {
  let present = false;
  try { present = fs.statSync(agentFile).isFile(); } catch { /* missing */ }
  if (!present) {
    say(`ask-kimi: consult profile missing at ${agentFile} — refusing to run.`);
    say('ask-kimi: without it Kimi would have full write/shell rights. Restore the');
    say('ask-kimi: file, or set KIMI_FULL=1 deliberately if that is what you want.');
    process.exit(3);
  }
  modeArgs.push('--agent-file', agentFile);
}

installCleanup();
const out = scratchFile(), err = scratchFile();

const code = await runApp({
  bin, args: ['-p', prompt, '--output-format', 'stream-json', ...modeArgs],
  out, err, seconds: limit.seconds,
  onTimeout: () => leave(124, `ask-kimi: kimi timed out after ${limit.text}s and was killed`),
});

// Kimi writes one JSON object per line. The answer is every assistant message, in order.
function answerText() {
  let text;
  try { text = fs.readFileSync(out, 'utf8'); } catch { return ''; }
  const parts = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message;
    try { message = JSON.parse(trimmed); } catch { continue; }
    // Kept from the earlier wrapper: a line that is the bare word null makes the whole run
    // count as having no answer.
    if (message === null) return '';
    if (message.role === 'assistant' && typeof message.content === 'string' && message.content) parts.push(message.content);
  }
  return parts.join('\n').replace(/\n+$/, '');
}

const answer = Buffer.from(answerText(), 'utf8');
if (!answer.length) {
  say(`ask-kimi: kimi produced no answer text (exit ${code})`);
  emit(2, head(err, ERR_SHOWN));
  emit(2, head(out, 2000));
  process.exit(code !== 0 ? code : 1);
}

emit(1, answer.subarray(0, MAX_OUT));
emit(1, answer.length > MAX_OUT ? `\n[ask-kimi: answer truncated at ${MAX_OUT} bytes]\n` : '\n');
if (sizeOf(err)) emit(2, head(err, ERR_SHOWN));
process.exit(code);
