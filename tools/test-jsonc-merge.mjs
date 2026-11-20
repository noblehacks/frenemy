import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanJsonc, mergeQwenSettings } from '../install.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frenemy-jsonc-test-'));
let passed = 0, failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS: ' : 'FAIL: ') + name + (extra ? ' (' + extra + ')' : '')); ok ? passed++ : failed++; };
const text = file => fs.readFileSync(file, 'utf8');
const read = file => scanJsonc(text(file)).value;
const make = (name, body) => { const file = path.join(dir, name); fs.writeFileSync(file, body); return file; };
const refused = (file, servers, hooks) => {
  const before = text(file), entries = JSON.stringify(fs.readdirSync(path.dirname(file)).sort());
  const done = new Map();
  try { mergeQwenSettings(file, servers, hooks, done, []); return false; }
  catch { return text(file) === before && done.size === 0 &&
    JSON.stringify(fs.readdirSync(path.dirname(file)).sort()) === entries; }
};

const servers = { claude: { command: 'node', args: ['/p/tools/ask-claude-mcp.mjs'], env: { FRENEMY_DRIVER: 'qwen' } } };
const hooks = { PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: "'node' '/p/snitch/hooks/agent-beat.mjs' qwen" }] }] };

check('a plain object reads', scanJsonc('{"a":1}').value.a === 1);
check('a line comment before the file reads', scanJsonc('// hi\n{"a":1}').value.a === 1);
check('a block comment inside a list reads', scanJsonc('/* x */ {"a": [1, 2, /*c*/ 3]}').value.a.length === 3);
check('escapes and \\u names read', scanJsonc('{"a\\u0041":"q\\"z\\n"}').value.aA === 'q"z\n');
const spans = scanJsonc('{\n  "a": 1,\n  "b": {"c": 2}\n}');
check('the top-level members and their spans come back',
  spans.members.length === 2 && spans.members[1].key === 'b' && spans.value.b.c === 2);
for (const [name, bad] of [['a string left open', '{"a":"x\n}'], ['a name without a colon', '{"a" 1}'],
  ['the same name twice', '{"a":1,"a":2}'], ['a byte-order mark', '\ufeff{"a":1}'], ['text after the brace', '{"a":1} x'],
  ['a bare word', '{a:1}'], ['a number too large to copy', '{"a":12345678901234567890}'],
  ['a comment never closed', '/* x\n{"a":1}'], ['a list at the top level', '[1,2]']]) {
  let threw = false;
  try { scanJsonc(bad); } catch { threw = true; }
  check('refuses ' + name, threw);
}

let file = make('a.json', `{
  // my own notes
  "model": { "name": "local" }, /* keep me */
  "permissions": { "allow": ["Bash(do *)"] }
}`);
const was = text(file), done = new Map(), notes = [];
mergeQwenSettings(file, servers, hooks, done, notes);
const after = text(file);
check('both kinds of comment survive', after.includes('// my own notes') && after.includes('/* keep me */'));
check('the person\'s own settings survive', read(file).model.name === 'local' && read(file).permissions.allow[0] === 'Bash(do *)');
check('the server entry is added', read(file).mcpServers.claude.command === 'node');
check('the reporter is added', read(file).hooks.PostToolUse[0].matcher === '*');
check('the file is copied aside first', done.size === 1 && text(done.get(file)) === was);
check('the new entries wear the file\'s own indentation', after.includes('\n  "mcpServers": {'));

mergeQwenSettings(file, servers, hooks, new Map(), notes);
check('a second run leaves the file byte for byte the same', text(file) === after);

file = make('b.json', '{"mcpServers": { "claude": { "command": "mine", "args": ["x"] } }}');
const noted = [];
mergeQwenSettings(file, servers, hooks, new Map(), noted);
check('their own entry of the same name is kept', read(file).mcpServers.claude.command === 'mine');
check('and it is reported', noted.some(note => note.includes('left your own "claude"')));

file = make('c.json', `{
  // header
  "mcpServers": { "claude": { "command": "node", "args": ["/old/tools/ask-claude-mcp.mjs"] } }
}`);
mergeQwenSettings(file, servers, hooks, new Map(), notes);
check('an older Frenemy entry is replaced', read(file).mcpServers.claude.args[0] === '/p/tools/ask-claude-mcp.mjs');
check('and the comment above it is kept', text(file).includes('// header'));

file = make('d.json', `// top
{"hooks": { "PostToolUse": [
  { "matcher": "*", "hooks": [{ "type": "command", "command": "node \\"/old/snitch/hooks/agent-beat.mjs\\" qwen" }] },
  { "matcher": "*", "hooks": [{ "type": "command", "command": "/usr/bin/my-own-check.sh" }] }
] } }`);
mergeQwenSettings(file, servers, hooks, new Map(), notes);
const commands = read(file).hooks.PostToolUse.map(group => group.hooks[0].command);
check('an earlier Frenemy reporter is gone', !commands.some(command => command.includes('/old/snitch/')));
check('the person\'s own hook stays', commands.some(command => command.includes('my-own-check')));
check('this Frenemy\'s reporter is in', commands.some(command => command.includes('/p/snitch/hooks/agent-beat.mjs')));
check('the comment above still reads', text(file).includes('// top'));

check('a file it cannot read is left alone', refused(make('e.json', '{"model": "x",,}'), servers, hooks));
check('hooks of another shape leave it alone', refused(make('f.json', '{"hooks": {"PostToolUse": {"not": "a list"}}}'), servers, hooks));
check('a broken entry of the person\'s own leaves it alone', refused(make('g.json', '{"mcpServers": ['), servers, hooks));

file = make('h.json', '');
mergeQwenSettings(file, servers, hooks, new Map(), notes);
check('an empty file gets both entries', read(file).mcpServers.claude.command === 'node' &&
  read(file).hooks.PostToolUse[0].hooks[0].command.includes('agent-beat.mjs'));
file = make('i.json', '{}');
mergeQwenSettings(file, servers, hooks, new Map(), notes);
check('an empty object gets both entries', read(file).mcpServers.claude.command === 'node' && read(file).hooks !== undefined);

file = make('j.json', '{"model": "x"}');
mergeQwenSettings(file, {}, hooks, new Map(), notes);
check('an empty mcpServers is not invented', read(file).mcpServers === undefined && read(file).model === 'x');

for (const literal of ['0', '-0', '1', '-12', '0.5', '-0.5', '1e3', '1E-3', '-1.2e+3']) {
  const parsed = scanJsonc('{"number":' + literal + '}').value.number;
  check('reads valid number ' + literal, Object.is(parsed, JSON.parse(literal)));
}
const escapedControls = '{"x":"\\u0000\\t\\b\\n\\r\\f"}';
check('escaped controls read', scanJsonc(escapedControls).value.x === JSON.parse(escapedControls).x);
check('a large number in a comment is preserved', (() => {
  const body = '// 123456789012345678901234567890\n{"model":"keep"}';
  const file = make('comment-number.json', body);
  mergeQwenSettings(file, servers, hooks, new Map(), []);
  return text(file).startsWith('// 123456789012345678901234567890\n') && read(file).model === 'keep';
})());

const invalid = ['{"x":01}', '{"x":-01}', '{"x":1.}', '{"x":-.1}', '{"x":1e}', '{"x":1e+}',
  '{"x":1e999}', '{"x":1,}', '{"x":[1,]}', '{"x":true}\v', '\f', '\ufeff',
  '{"__proto__":1,"__proto__":2}', '{"__proto__":1,"\\u005f_proto__":2}'];
for (let code = 0; code < 32; code++) invalid.push('{"x":"a' + String.fromCharCode(code) + 'b"}');
for (const [i, body] of invalid.entries()) {
  check('invalid JSONC is refused without writes: ' + JSON.stringify(body),
    refused(make('invalid-' + i + '.json', body), servers, hooks));
}

for (const key of ['__proto__', 'constructor', 'prototype']) {
  const body = '{' + JSON.stringify(key) + ':{"keep":"root"},' +
    '"mcpServers":{' + JSON.stringify(key) + ':{"command":"mine","args":["keep"]}},' +
    '"hooks":{' + JSON.stringify(key) + ':[{"hooks":[{"type":"command","command":"mine"}]}]}}';
  const parsed = scanJsonc(body).value;
  check('the scanner preserves own key ' + key,
    Object.hasOwn(parsed, key) && Object.getPrototypeOf(parsed) === Object.prototype && parsed[key].keep === 'root');
  const file = make('special-' + key + '.json', body);
  mergeQwenSettings(file, servers, hooks, new Map(), []);
  const merged = JSON.parse(text(file));
  check('the merge preserves ' + key + ' at every level', Object.hasOwn(merged, key) && merged[key].keep === 'root' &&
    Object.hasOwn(merged.mcpServers, key) && merged.mcpServers[key].command === 'mine' &&
    Object.hasOwn(merged.hooks, key) && merged.hooks[key][0].hooks[0].command === 'mine');
  const once = text(file), done = new Map();
  mergeQwenSettings(file, servers, hooks, done, []);
  check('a second merge preserves ' + key + ' byte for byte', text(file) === once && done.size === 0);
}
const specialFile = make('new-special.json', '{}');
mergeQwenSettings(specialFile, JSON.parse('{"__proto__":{"command":"mine"}}'),
  JSON.parse('{"__proto__":[{"hooks":[{"type":"command","command":"mine"}]}]}'), new Map(), []);
const specialAdded = JSON.parse(text(specialFile));
check('new special keys are own properties', Object.hasOwn(specialAdded.mcpServers, '__proto__') &&
  Object.hasOwn(specialAdded.hooks, '__proto__'));

console.log(passed + '/' + (passed + failed) + ' JSONC reader and merge tests passed');
process.exit(failed ? 1 : 0);
