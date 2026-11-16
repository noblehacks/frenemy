#!/usr/bin/env node
// Ask Claude one question, or (CLAUDE_WRITE=1) give it one piece of work. The prompt arrives
// on standard input and is handed to Claude on its own standard input.
//   node tools/ask-claude-wrapper.mjs < prompt.txt
// CLAUDE_BIN, CLAUDE_TIMEOUT (seconds, 0 = no limit) and CLAUDE_WRITE are honoured.
// Exit: Claude's own code, or 1 no usable answer, 2 bad prompt or time limit, 3 no scratch
// file, 124 timed out, 127 Claude not found.
import fs from 'node:fs';
import {
  MAX_PROMPT, MAX_OUT, ERR_SHOWN, resolveBin, emit, say, leave, readStdin,
  installCleanup, scratchFile, runApp, firstChars,
} from './wrapper-common.mjs';

installCleanup();
const bin = resolveBin('claude');
const limitText = process.env.CLAUDE_TIMEOUT || '570';
if (!/^[0-9]+$/.test(limitText)) leave(2, 'Invalid CLAUDE_TIMEOUT');
if (!bin) process.exit(127);

const out = scratchFile(), err = scratchFile(), input = scratchFile();
const prompt = await readStdin();
try { fs.writeFileSync(input, prompt); } catch { process.exit(2); }
if (!prompt.length || prompt.length > MAX_PROMPT) process.exit(2);

const args = ['-p', '--output-format', 'json'];
if (process.env.CLAUDE_WRITE === '1') {
  args.push('--permission-mode', 'acceptEdits', '--setting-sources', 'user');
} else {
  args.push('--safe-mode', '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', '--strict-mcp-config');
}

const code = await runApp({
  bin, args, out, err, input, seconds: Number(limitText), killOnTimeout: false,
  onTimeout: () => leave(124, `claude timed out after ${limitText}s`),
});

// Claude answers with one JSON object. These few helpers read it the way the earlier wrapper
// did, so the same answers pass and the same ones are refused.
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const blank = text => text.trim() === '';
// Empty lists and empty objects count as "no", like zero, false and the empty text.
const counts = value => Array.isArray(value) ? value.length > 0 : isObject(value) ? Object.keys(value).length > 0 : Boolean(value);
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

function kindOf(value, source) {
  if (Array.isArray(value)) return 'list';
  if (value === null) return 'NoneType';
  if (typeof value === 'string') return 'str';
  if (typeof value === 'boolean') return 'bool';
  return /^-?[0-9]+$/.test(source.trim()) ? 'int' : 'float';
}

const source = readText(out);
let data, notJson = null;
try { data = JSON.parse(source); } catch (error) {
  notJson = source.trim() === '' ? 'Expecting value: line 1 column 1 (char 0)' : 'Claude answer is not valid JSON: ' + error.message;
}

if (code !== 0) {
  if (!notJson && isObject(data)) {
    const reason = data.result;
    say(typeof reason === 'string' && !blank(reason) ? firstChars(reason, ERR_SHOWN) : 'Claude failed without an answer');
  } else {
    say(firstChars(readText(err), ERR_SHOWN) || 'Claude failed without usable output');
  }
  process.exit(code);
}

if (notJson) leave(1, notJson);
if (!isObject(data)) leave(1, `'${kindOf(data, source)}' object has no attribute 'get'`);
const answer = data.result;
if (counts(data.is_error) || typeof answer !== 'string' || blank(answer)) {
  const shown = !counts(answer) ? 'Claude returned no answer' : typeof answer === 'string' ? answer : JSON.stringify(answer);
  leave(1, shown);
}
emit(1, firstChars(answer, MAX_OUT) + '\n');
process.exit(0);
