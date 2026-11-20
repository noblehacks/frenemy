#!/usr/bin/env node
import fs from 'node:fs';
import {
  MAX_PROMPT, MAX_OUT, ERR_SHOWN, resolveBin, emit, say, leave, readStdin,
  installCleanup, scratchFile, runApp, firstChars,
} from './wrapper-common.mjs';

installCleanup();
const bin = resolveBin('qwen');
const limitText = process.env.QWEN_TIMEOUT || '570';
if (!/^[0-9]+$/.test(limitText)) leave(2, 'Invalid QWEN_TIMEOUT');
if (!bin) process.exit(127);

const out = scratchFile(), err = scratchFile(), input = scratchFile();
const prompt = await readStdin();
try { fs.writeFileSync(input, prompt); } catch { process.exit(2); }
if (!prompt.length || prompt.length > MAX_PROMPT) process.exit(2);

const write = process.env.QWEN_WRITE === '1';
const args = ['--output-format', 'json', '--safe-mode'];
if (write) {
  const wall = limitText === '0' ? '24h' : String(Math.max(1, Number(limitText) - 30));
  args.push('--yolo', '--max-wall-time', wall, '--max-session-turns', '300');
  process.env.QWEN_CODE_SUPPRESS_YOLO_WARNING = '1';
} else {
  args.push('--approval-mode', 'plan');
}

const code = await runApp({
  bin, args, out, err, input, seconds: Number(limitText), killOnTimeout: false,
  onTimeout: () => leave(124, `qwen timed out after ${limitText}s`),
});

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const blank = text => text.trim() === '';
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

const source = readText(out);
let messages = null, notJson = null;
try { messages = JSON.parse(source); }
catch (error) { notJson = source.trim() === '' ? 'Qwen wrote no output' : 'Qwen answer is not valid JSON: ' + error.message; }

const result = Array.isArray(messages) ? messages.findLast(message => isObject(message) && message.type === 'result') : null;

if (code !== 0) {
  const reason = result && typeof result.result === 'string' && !blank(result.result) ? result.result : '';
  say(reason || firstChars(readText(err), ERR_SHOWN) || 'Qwen failed without an answer');
  process.exit(code);
}

if (!Array.isArray(messages)) leave(1, notJson || 'Qwen answer is not a list of messages');
if (!result) leave(1, 'Qwen answered without a result message');
const answer = result.result;
if (result.is_error || typeof answer !== 'string' || blank(answer)) {
  leave(1, typeof answer === 'string' && !blank(answer) ? firstChars(answer, ERR_SHOWN) : 'Qwen returned no answer');
}
emit(1, firstChars(answer, MAX_OUT) + '\n');
process.exit(0);
