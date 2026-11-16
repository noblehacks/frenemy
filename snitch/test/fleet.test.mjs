// The job tool and the two reporters, end to end, with the real files.
// Plain Node, no test framework. Run: node snitch/test/fleet.test.mjs
// Everything is written under a temp folder; the real ~/.fleet is never touched and no AI app is started.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import lock from '../extension/lib/joblock.js';

const WIN = process.platform === 'win32';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLEET = path.join(HERE, '..', 'bin', 'fleet.mjs');
const HOOK = path.join(HERE, '..', 'hooks', 'claude-beat.mjs');
const AHOOK = path.join(HERE, '..', 'hooks', 'agent-beat.mjs');
const RUN_TAG = String(process.pid);

const made = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-test-'));
const BASE = WIN ? fs.realpathSync.native(made) : made;
const FLEET_DIR = path.join(BASE, 'fleet');
const JOBS = path.join(FLEET_DIR, 'jobs');
const WORK = path.join(BASE, 'fleet-work-' + RUN_TAG);
const HOME = path.join(BASE, 'home');
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(HOME, { recursive: true });
const TASK_ROOT = path.join(WORK, 'harness-tmp');

const env = { ...process.env, FLEET_DIR, HOME, USERPROFILE: HOME, SNITCH_TASK_ROOT: TASK_ROOT };
for (const name of ['FRENEMY_DRIVER', 'ANTIGRAVITY_CONVERSATION_ID', 'FRENEMY_RELAY_JOB', 'CLAUDE_PROJECT_DIR',
  'SNITCH_CAPTURE', 'FLEET_SERIALIZED_PID']) delete env[name];

let pass = 0, fail = 0;
const ok = name => { pass++; console.log('  ok  ' + name); };
const bad = (name, want, got) => { fail++; console.log('  FAIL ' + name); console.log('       want: ' + want); console.log('       got:  ' + got); };
const is = (name, want, got) => { if (String(want) === String(got)) ok(name); else bad(name, want, got); };

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const row = id => { try { return JSON.parse(fs.readFileSync(path.join(JOBS, id + '.json'), 'utf8')); } catch { return {}; } };
const field = (id, key) => { const value = row(id)[key]; return value === undefined ? '' : String(value); };
const jobFiles = () => { try { return fs.readdirSync(JOBS).sort(); } catch { return []; } };
const count = pattern => jobFiles().filter(name => pattern.test(name)).length;
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const lines = file => read(file).split('\n').filter((line, index, all) => index < all.length - 1 || line !== '');
const text = value => JSON.stringify(String(value)).slice(1, -1);     // a value placed inside JSON text

// Children are started the way a shell in `cwd` would start them, so PWD names that folder.
let cwd = process.cwd();
const childEnv = (extra, dir) => ({ ...env, ...(dir === process.cwd() ? {} : { PWD: dir }), ...extra });
const fleet = (...args) => spawnSync(process.execPath, [FLEET, ...args], { cwd, env: childEnv({}, cwd), encoding: 'utf8' });
const run = (script, input, args = [], extra = {}, dir = cwd) => spawnSync(process.execPath, [script, ...args],
  { cwd: dir, env: childEnv(extra, dir), encoding: 'utf8', ...(input === null ? { stdio: ['ignore', 'pipe', 'pipe'] } : { input }) });
const hook = (input, ...args) => run(HOOK, input, args);

fleet('start', 'r1', '--agent', 'claude', '--title', 'rhythm', '--total', '3', '--note', 'first note');
for (let i = 0; i < 3; i++) { sleep(1200); fleet('beat', 'r1'); }
is('beat count is recorded', '3', field('r1', 'beats'));
if (Number(field('r1', 'seen')) >= 1) ok('average gap is recorded'); else bad('average gap is recorded', '>=1', field('r1', 'seen'));

is('note survives note-less beats', 'first note', field('r1', 'note'));

fleet('start', 'r1', '--title', 'rhythm');
is('start resets beats', '0', field('r1', 'beats'));
is('start resets seen', '0', field('r1', 'seen'));

const DEEP = path.join(WORK, 'a-fairly-long-directory-name', 'another-quite-long-one', 'and-a-third-for-good-measure');
fs.mkdirSync(DEEP, { recursive: true });
const LOG = path.join(DEEP, 'render-output-with-a-long-name.log');
fs.writeFileSync(LOG, 'start\n');
fleet('start', 'w1', '--agent', 'shell', '--title', 'render', '--watch', LOG, '--max-silence', '900');
is('watch path is stored whole', LOG, field('w1', 'watch'));
is('max-silence is stored', '900', field('w1', 'maxsilence'));

cwd = WORK;
fs.writeFileSync(path.join(WORK, 'rel.log'), 'x\n');
fleet('start', 'w2', '--watch', 'rel.log');
is('relative watch path is made absolute', path.join(WORK, 'rel.log'), field('w2', 'watch'));

// payload <session> <description> <bgid> [command]: the command is JSON text, exactly as captured
const payload = (session, description, bgid, command = 'x') =>
  `{"session_id":"${session}","transcript_path":"${text(WORK)}/${session}.jsonl","cwd":"${text(WORK)}",` +
  '"hook_event_name":"PostToolUse","tool_name":"Bash",' +
  `"tool_input":{"command":"${command}","description":"${description}","run_in_background":true},` +
  `"tool_response":{"stdout":"","interrupted":false,"backgroundTaskId":"${bgid}"},` +
  '"tool_use_id":"toolu_x","duration_ms":4}';
// taskfile <session> <bgid> -> creates and returns the real path
const taskfile = (session, bgid) => {
  const dir = path.join(TASK_ROOT, 'fleet-test-slug-' + RUN_TAG, session, 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, bgid + '.output');
  fs.writeFileSync(file, '');
  return file;
};

const BGOUT = taskfile('sess1111', 'bgA' + RUN_TAG);
fs.writeFileSync(BGOUT, 'starting\n');

hook(payload('sess1111', 'Consult Gemini on the animation plan', 'bgA' + RUN_TAG));
is('a background command registers itself', 'Consult Gemini on the animation plan', field('bg-bgA' + RUN_TAG, 'title'));
is("and it watches the harness's own output file", BGOUT, field('bg-bgA' + RUN_TAG, 'watch'));
is('while it runs, it is running', 'running', field('bg-bgA' + RUN_TAG, 'state'));

fs.appendFileSync(BGOUT, 'done\n[exited with code 0]\n');
hook('{"session_id":"sess1111","tool_name":"Read","tool_response":{}}');
is('a finished command closes its own row', 'done', field('bg-bgA' + RUN_TAG, 'state'));

const BADOUT = taskfile('sess1111', 'bgB' + RUN_TAG);
fs.writeFileSync(BADOUT, 'boom\n[exited with code 2]\n');
hook(payload('sess1111', 'broken job', 'bgB' + RUN_TAG));
hook('{"session_id":"sess1111","tool_name":"Read","tool_response":{}}');
is('a failed command is reported as failed', 'failed', field('bg-bgB' + RUN_TAG, 'state'));

hook('{"session_id":"sess2222","tool_name":"Read","tool_response":{}}');
is('each chat gets its own row', '2', count(/^claude-.*\.json$/));

// One chat whose shell moves into another folder is still ONE row, under the name it began
// with. The payload's cwd follows the shell and the row id used to follow the cwd, so one
// chat became several rows, and the ones it walked away from said "running" for hours.
// moved <session> <cwd> -> the same captured PostToolUse shape, with that cwd
const moved = (session, dir) =>
  `{"session_id":"${session}","transcript_path":"${text(WORK)}/${session}.jsonl","cwd":"${text(dir)}",` +
  '"hook_event_name":"PostToolUse","tool_name":"Read",' +
  '"tool_input":{"file_path":"/tmp/a.py"},"tool_response":{},' +
  '"tool_use_id":"toolu_x","duration_ms":4}';
fs.mkdirSync(path.join(WORK, 'first proj', 'sub'), { recursive: true });
hook(moved('sessmove77', path.join(WORK, 'first proj')));
hook(moved('sessmove77', path.join(WORK, 'first proj', 'sub')));
is('a chat that changes folder keeps one row', '1', count(/move77\.json$/));
is('  under the name it started with', 'first proj', field('claude-first-proj-move77', 'title'));
is('  and that row is the one still running', 'running', field('claude-first-proj-move77', 'state'));
hook(moved('sessmove77', path.join(WORK, 'first proj', 'sub')), 'done');
is('  and the end of its turn closes that same row', 'done', field('claude-first-proj-move77', 'state'));
// A prompt with no tool call yet (UserPromptSubmit) wakes the same row, so a chat that is
// thinking is not left on screen as finished.
hook(`{"session_id":"sessmove77","transcript_path":"${text(WORK)}/sessmove77.jsonl","cwd":"${text(path.join(WORK, 'first proj', 'sub'))}","hook_event_name":"UserPromptSubmit","prompt":"go on"}`, 'beat');
is("a new prompt wakes the chat's own row", 'running', field('claude-first-proj-move77', 'state'));
is('  without opening another', '1', count(/move77\.json$/));

hook('{"session_id":"sess1111","tool_name":"Bash","tool_input":{"command":"echo hi","description":"talking about background jobs"},"tool_response":{"stdout":"Command running in background with ID: bGHOST. Output is being written to: /tmp/x"}}');
is('prose about background jobs creates no row', '', jobFiles().filter(name => name.includes('bGHOST')).join(' '));

// consult <bgid> <command as JSON text> <expected agent>
const consult = (bgid, command, agent) => {
  taskfile('sess3333', bgid);
  hook(payload('sess3333', 'consult', bgid, command));
  is(agent + ' job wears the ' + agent + ' logo', agent, field('bg-' + bgid, 'agent'));
  is('  and credits claude as its driver', 'claude', field('bg-' + bgid, 'driver'));
};
consult('cx', String.raw`cd \\\"/tmp/x\\\" && codex exec --sandbox read-only \\\"review this\\\"`, 'codex');
consult('gm', String.raw`cd \\\"/tmp/x\\\" && agy -p \\\"$(cat brief.md)\\\"`, 'agy');
consult('km', String.raw`cd \\\"/tmp/x\\\" && kimi -p \\\"$(cat brief.md)\\\"`, 'kimi');

consult('ml', String.raw`SP=\\\"/tmp/sp\\\"\ncat \\\"$SP/p.txt\\\" | \\\"/Users/u/frenemy-2/ask-kimi.sh\\\" > \\\"$SP/o.md\\\"`, 'kimi');
consult('mg', String.raw`SP=\\\"/tmp/sp\\\"\n\\\"$HOME/frenemy-2/ask-agy.sh\\\" < \\\"$SP/p.txt\\\" > \\\"$SP/o.md\\\"`, 'agy');
consult('mc', String.raw`SP=\\\"/tmp/sp\\\"\ncd \\\"$SP\\\" && codex exec --sandbox read-only \\\"review\\\"`, 'codex');
// Claude reaches Codex through the wrapper script, not a bare `codex exec`. Rows wore
// Claude's logo with no driver while only the bare command was recognised.
consult('wc', String.raw`CODEX_WRITE=0 \\\"/opt/frenemy/tools/ask-codex-wrapper.sh\\\" <<'PROMPT'\nReview this\nPROMPT`, 'codex');

const OLDOUT = taskfile('sessOLDID', 'rot' + RUN_TAG);
fs.writeFileSync(OLDOUT, 'starting\n');
hook(payload('sessNEWID', 'rotated session', 'rot' + RUN_TAG, String.raw`cd /tmp && codex exec \\\"review\\\"`));
is('a rotated session id still finds the output', OLDOUT, field('bg-rot' + RUN_TAG, 'watch'));
fs.appendFileSync(OLDOUT, 'done\n[exited with code 0]\n');
hook('{"session_id":"sessNEWID","tool_name":"Read","tool_response":{}}');
is('  and the row closes when it exits', 'done', field('bg-rot' + RUN_TAG, 'state'));

taskfile('sess3333', 'own');
hook(payload('sess3333', 'own work', 'own', 'nice -n 10 flutter test'));
is("claude's own background job stays claude", 'claude', field('bg-own', 'agent'));

const ROW = 'claude-' + path.basename(WORK).replace(/ /g, '-').replace(/[^A-Za-z0-9._-]/g, '') + '-' + 'sess4444'.replace(/[^A-Za-z0-9]/g, '').slice(-6);
// tool <session> <json tool_input> <tool_name>
const tool = (session, input, name) =>
  `{"session_id":"${session}","transcript_path":"${text(WORK)}/x.jsonl","hook_event_name":"PostToolUse",` +
  `"tool_name":"${name}","tool_input":${input},"tool_response":{"ok":true}}`;
const trailFile = () => path.join(JOBS, ROW + '.trail');
const trail = n => { const line = lines(trailFile())[n - 1]; return line === undefined ? '' : (line.split('\t')[2] || ''); };

hook(tool('sess4444', '{"file_path":"/tmp/deep/model.js"}', 'Read'));
is('a finished tool call is recorded in the past tense', 'Read model.js', trail(1));
// A chat is not a job with a rhythm: it may think, or wait on one long command, for far
// longer than five minutes. The row promises two hours before silence means anything.
is('a chat row carries a two-hour silence bound', '7200', field(ROW, 'maxsilence'));

hook(tool('sess4444', '{"file_path":"/tmp/deep/model.js"}', 'Read'));
hook(tool('sess4444', '{"file_path":"/tmp/deep/model.js"}', 'Read'));
is('the same action repeated is counted, not repeated', '3', (lines(trailFile()).pop() || '').split('\t')[1]);
is('  and it stays one line', '1', lines(trailFile()).length);

hook(tool('sess4444', '{"command":"flutter test","description":"run the test suite"}', 'Bash'));
is('a different action starts a new line', 'Run the test suite', trail(2));
hook(tool('sess4444', '{"command":"x","description":"gate the build","run_in_background":true}', 'Bash'));
is('a background launch says it was started', 'Started gate the build', trail(3));

for (let i = 0; i < 6; i++) hook(tool('sess4444', `{"pattern":"p${i}"}`, 'Grep'));
is('only the last five actions are kept', '5', lines(trailFile()).length);
is('  the newest is last', 'Searched for p5', trail(5));

const TODOS = '{"todos":[{"content":"Read the hook","status":"completed"},{"content":"Write the trail","status":"in_progress"},{"content":"Ship it","status":"pending"}]}';
const tasksFile = path.join(JOBS, ROW + '.tasks');
hook(tool('sess4444', TODOS, 'TodoWrite'));
is('the plan is saved with its statuses', 'completed\tRead the hook', lines(tasksFile)[0]);
is('  including what is still to do', 'pending\tShip it', lines(tasksFile)[2]);
is('  and no step total is invented from it', '0', field(ROW, 'total'));
const BEFORE = read(tasksFile);
hook(tool('sess4444', TODOS, 'TodoWrite'));
is('  an unchanged plan is not rewritten', BEFORE, read(tasksFile));

hook('{"session_id":"sess4444","hook_event_name":"Stop"}', 'done');
is('the chat says it is idle when the turn ends', 'Idle — waiting for you', field(ROW, 'note'));
is('  and its row is finished', 'done', field(ROW, 'state'));

if (run(HOOK, null).status === 0) ok('runs with empty stdin without hanging');
else bad('runs with empty stdin without hanging', 'exit 0', 'non-zero');

const AWS = path.join(WORK, 'Example Project');
fs.mkdirSync(AWS, { recursive: true });
const agent = (input, args, extra = {}, dir = cwd) => run(AHOOK, input, args, extra, dir);

const CAP = path.join(WORK, 'capture');
fs.mkdirSync(CAP, { recursive: true });
agent(`{"session_id":"01a0871b-fc1d-7182-a8ae-471ced9744c3","cwd":"${text(WORK)}","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":["bash","-lc","echo hi"]},"tool_response":{"output":"hi"}}`,
  ['codex'], { SNITCH_CAPTURE: CAP });
const named = pattern => (jobFiles().find(name => pattern.test(name)) || '').replace(/\.json$/, '');
const thirds = file => lines(file).map(line => line.split('\t')[2] || '');
const CX = named(/^codex-.*-9744c3\.json$/);
is('codex: a session gets its own row, keyed by the session tail', '1', count(/^codex-.*-9744c3\.json$/));
is("  wearing codex's logo", 'codex', field(CX, 'agent'));
is('  titled with the folder it works in', path.basename(WORK).replace(/-/g, ' '), field(CX, 'title'));
is('  and the trail shows what it typed, not the bash wrapper', 'Echo hi', thirds(path.join(JOBS, CX + '.trail')).join('\n'));
is('  and the raw payload was captured for the fixture file', '1', fs.readdirSync(CAP).filter(name => /^codex-beat-.*\.json$/.test(name)).length);
agent(String.raw`{"session_id":"01a0871b-fc1d-7182-a8ae-471ced9744c3","cwd":"` + text(WORK) + String.raw`","hook_event_name":"PostToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: src/a.py\n@@\n-x\n+y\n*** End Patch"},"tool_response":{}}`,
  ['codex']);
is('  an apply_patch names the file from the patch header', 'Edited a.py', thirds(path.join(JOBS, CX + '.trail')).pop());
agent(`{"session_id":"01a0871b-fc1d-7182-a8ae-471ced9744c3","cwd":"${text(WORK)}","hook_event_name":"PostToolUse","tool_name":"mcp__catalog__search","tool_input":{"query":"x"},"tool_response":{}}`,
  ['codex']);
is('  an MCP tool with cat in its name is not called a read', 'Searched for x', thirds(path.join(JOBS, CX + '.trail')).pop());
agent(String.raw`{"session_id":"01a0871b-fc1d-7182-a8ae-471ced9744c3","cwd":"` + text(WORK) + String.raw`","hook_event_name":"PostToolUse","tool_name":"Read","tool_input":{"file_path":"/tmp/a\nb.py"},"tool_response":{}}`,
  ['codex']);
is('  a newline in a path stays on one trail line', 'Read a b.py', thirds(path.join(JOBS, CX + '.trail')).pop());
is("  and the row's folder is still the session's", WORK, field(CX, 'cwd'));
is('  and it carries the same two-hour silence bound', '7200', field(CX, 'maxsilence'));
// A relayed worker reports into the relay's row and must not touch the relay's own bound.
fleet('start', 'relayx', '--agent', 'codex', '--driver', 'kimi', '--title', 'relay', '--max-silence', '630');
agent(`{"session_id":"01a0871b-fc1d-7182-a8ae-471ced9744c3","cwd":"${text(WORK)}","hook_event_name":"PostToolUse","tool_name":"Read","tool_input":{"file_path":"/tmp/a.py"},"tool_response":{}}`,
  ['codex'], { FRENEMY_RELAY_JOB: 'relayx' });
is("  a relayed beat keeps the relay's own silence bound", '630', field('relayx', 'maxsilence'));

agent('{"hook_event_name":"PostToolUse","session_id":"5b28861c-98bb-4b07-9390-38f9373adf91","session_title":"t","tool_name":"ReadFile","tool_input":{"path":"/tmp/a/model.js"},"tool_call_id":"c1","tool_output":"x"}',
  ['kimi'], {}, WORK);
const KM = named(/^kimi-.*-3adf91\.json$/);
is("kimi: its row wears kimi's logo", 'kimi', field(KM, 'agent'));
is('  and says what it read', 'Read model.js', thirds(path.join(JOBS, KM + '.trail')).join('\n'));
is('  with no driver when nobody drove it', '', field(KM, 'driver'));
agent('{"hook_event_name":"Stop","session_id":"5b28861c-98bb-4b07-9390-38f9373adf91","stop_hook_active":false}',
  ['kimi', 'done'], { FRENEMY_DRIVER: 'codex' }, WORK);
is("  the turn's end makes the row idle", 'Idle — waiting for you', field(KM, 'note'));
is('  and finished', 'done', field(KM, 'state'));
is("  and the bridge's driver is recorded", 'codex', field(KM, 'driver'));

const ELSEWHERE = os.tmpdir();
agent(`{"conversationId":"287ad055-1111-2222-3333-444455556666","workspacePaths":["${text(AWS)}"],"toolCall":{"name":"run_command","args":{"CommandLine":"npm test"}},"stepIdx":5}`,
  ['agy'], {}, ELSEWHERE);
const AG = named(/^agy-.*-556666\.json$/);
is("agy: its row wears agy's logo", 'agy', field(AG, 'agent'));
is('  titled with the workspace, spaces and all', 'Example Project', field(AG, 'title'));
is("  and records the workspace as its folder, not the hook's own", AWS, field(AG, 'cwd'));
is('  and says what it ran', 'Npm test', thirds(path.join(JOBS, AG + '.trail')).join('\n'));
is('  and answers agy with a JSON object', '{}\n', agent('{"conversationId":"x"}', ['agy', 'done']).stdout);

agent('{"conversationId":"287ad055-1111-2222-3333-444455556666"}', ['agy', 'done'], {}, ELSEWHERE);
is('sparse agy Stop preserves title', 'Example Project', field(AG, 'title'));
is('sparse agy Stop preserves project', AWS, field(AG, 'cwd'));
is('sparse agy Stop ends existing row', 'done', field(AG, 'state'));
agent('{"hook_event_name":"Stop","session_id":"5b28861c-98bb-4b07-9390-38f9373adf91"}', ['kimi', 'done'], {}, WORK);
is('undriven turn clears old driver attribution', '', field(KM, 'driver'));
const BEFORE_BAD = count(/\.json$/);
if (agent('not json', ['codex']).status === 0) ok('codex hook survives non-JSON stdin');
else bad('codex hook survives non-JSON stdin', 'exit 0', 'non-zero');
if (agent(null, ['kimi']).status === 0) ok('kimi hook runs with empty stdin without hanging');
else bad('kimi hook runs with empty stdin without hanging', 'exit 0', 'non-zero');
if (agent(null, ['nobody']).status === 0) ok('an unknown agent name is ignored, not crashed on');
else bad('an unknown agent name is ignored', 'exit 0', 'non-zero');
is('invalid and empty hook input creates no phantom job', BEFORE_BAD, count(/\.json$/));

is('no temp files left in .tmp', '', fs.readdirSync(path.join(FLEET_DIR, '.tmp')).join(' '));
is('nothing but jobs in jobs/', '', jobFiles().filter(name => !/\.json$|\.steps$|\.trail$|\.tasks$/.test(name)).join(' '));

// ---- More cases, added with the move to Node (the list above is the earlier shell test, case for case) ----

// Notes from one chat are handled in the order they happened: one that reaches the front of
// the queue after a newer note was already handled is dropped.
const locks = path.join(FLEET_DIR, '.hook-locks');
hook('{"session_id":"sessorder9","tool_name":"Read","tool_response":{}}');
const orderRow = named(/^claude-.*-order9\.json$/);
is('extra: a chat row to test ordering on', 'running', field(orderRow, 'state'));
fs.writeFileSync(path.join(locks, lock.keyFor('claude:sessorder9') + '.stamp'), '9999999999999999999');
hook('{"session_id":"sessorder9","hook_event_name":"Stop"}', 'done');
is('extra: a note older than the last one handled changes nothing', 'running', field(orderRow, 'state'));
fs.writeFileSync(path.join(locks, lock.keyFor('agy:orderagy1') + '.stamp'), '9999999999999999999');
is('extra:   and agy still gets its JSON object back', '{}\n', agent('{"conversationId":"orderagy1"}', ['agy', 'done']).stdout);
is('extra:   and no row was opened for it', '0', count(/^agy-.*-eragy1\.json$/));

// step, ls and prune, which the earlier test never called.
fleet('start', 's1', '--title', 'steps', '--total', '4');
fleet('step', 's1');
fleet('step', 's1', '3');
is('extra: step counts up, or jumps to the number given', '3', field('s1', 'step'));
is('extra:   and each step leaves its time in the side file', '2', lines(path.join(JOBS, 's1.steps')).length);
fleet('done', 's1');
is('extra: done fills the steps up to the total', '4', field('s1', 'step'));
const listed = fleet('ls');
if (listed.status === 0 && /^shell {2}steps {2}done {2}elapsed /m.test(listed.stdout)) ok('extra: ls lists the rows');
else bad('extra: ls lists the rows', 'shell  steps  done  elapsed ...', listed.stdout + listed.stderr);
const aged = row('s1');
aged.beat = aged.beat - 3 * 86400;
fs.writeFileSync(path.join(JOBS, 's1.json'), JSON.stringify(aged, null, 2) + '\n');
const pruned = fleet('prune', '--days', '2');
is('extra: prune says what it moved', 'moved 1 finished job(s) to ' + (WIN ? path.join(FLEET_DIR, 'trash') : FLEET_DIR + '/trash') + '\n', pruned.stdout);
is('extra:   the row is gone from jobs', '0', count(/^s1\./));
is('extra:   and it sits in the trash folder with its side file, not deleted', '2',
  fs.readdirSync(path.join(FLEET_DIR, 'trash')).filter(name => /-s1\.(json|steps)$/.test(name)).length);
const wrong = fleet('beat', 'bad/id');
is('extra: a job id that could leave the jobs folder is refused', '2', wrong.status);
is('extra:   in the same words as before', 'fleet: job id must use letters, digits, dot, underscore or dash, and cannot start with dot\n', wrong.stderr);

console.log('');
console.log(pass + '/' + (pass + fail) + ' fleet writer tests passed');
process.exit(fail === 0 ? 0 : 1);
