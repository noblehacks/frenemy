// The relay must stay responsive while a guarded file transaction waits.
// Run: node tools/test-relay-transactions.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import lock from '../snitch/extension/lib/joblock.js';
import { PKG, NODE, t, finish, sleep, tempRoot, fakeApp, safeEnv, run, talk } from './test-relay-kit.mjs';

const SEATS = ['claude', 'codex', 'agy', 'kimi', 'qwen'];
const server = seat => path.join(PKG, 'tools', 'ask-' + seat + '-mcp.mjs');

// Drivers learn arguments from tools/list, not from relay internals. Started outside the
// package folder to cover the supported any-folder use.
{
  const folder = tempRoot('frenemy-schema-');
  for (const seat of SEATS) {
    await t(seat + ': the consult tool lists working_directory as an optional text', async () => {
      const done = await run(NODE, [server(seat)], { cwd: folder, env: safeEnv(folder), timeoutMs: 10000,
        input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
      assert.strictEqual(done.timedOut, false, 'the relay did not end');
      assert.strictEqual(done.code, 0, done.stderr);
      const tools = JSON.parse(done.stdout).result.tools;
      const consult = tools.find(tool => tool.name === 'ask_' + seat);
      assert.ok(consult, 'ask_' + seat + ' is listed');
      const schema = consult.inputSchema;
      assert.strictEqual(schema.properties.working_directory.type, 'string');
      assert.ok(!schema.required.includes('working_directory'));
    });
  }
}

await t('a request cancelled while the guard waits is answered, launches nothing and releases its claim', async () => {
  const root = tempRoot('frenemy-transaction-test-');
  const project = path.join(root, 'project');
  const state = path.join(project, '.worker-state');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(project, 'input.txt'), 'context\n');
  const launched = path.join(root, 'launched');
  const serverFile = path.join(root, 'server.mjs');
  fs.writeFileSync(serverFile,
    'import {serve} from ' + JSON.stringify(pathToFileURL(path.join(PKG, 'tools', 'relay-core.mjs')).href) + ';\n' +
    'import {writeFileSync} from "node:fs";\n' +
    'serve({serverName:"test",version:"1",tools:[{name:"ask_fixture_write",' +
    'inputSchema:{type:"object",properties:{prompt:{type:"string"}}}}],' +
    'call:async()=>{writeFileSync(' + JSON.stringify(launched) + ',"unexpected");' +
    'return {ok:true,text:"unexpected launch"};}});\n');
  // The guard takes this project's one lock before it prepares anything. Holding it here makes
  // the guard wait, which is the moment under test.
  const held = lock.acquireSync(path.join(state, 'locks'), 'global');
  const relay = talk(NODE, [serverFile], { env: safeEnv(root) });
  const blocked = 'relay event loop blocked during guarded operation';
  const jobFiles = () => {
    const jobs = path.join(state, 'jobs');
    if (!fs.existsSync(jobs)) return [];
    return fs.readdirSync(jobs).filter(name => name.endsWith('.json')).map(name => path.join(jobs, name));
  };
  try {
    relay.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask_fixture_write',
      arguments: { prompt: 'test', working_directory: project, allowed_files: ['result.txt'] } } });
    relay.send({ jsonrpc: '2.0', id: 2, method: 'ping' });
    assert.strictEqual((await relay.receive(3000, blocked)).id, 2);
    relay.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
    relay.send({ jsonrpc: '2.0', id: 3, method: 'ping' });
    assert.strictEqual((await relay.receive(3000, blocked)).id, 3);
    // Not in the original: the guard really is waiting on the lock held here.
    await sleep(500);
    assert.deepStrictEqual(jobFiles(), [], 'the guard prepared a job while its lock was held');
    held.release();
    const answer = await relay.receive(5000, blocked);
    assert.strictEqual(answer.id, 1);
    assert.strictEqual(answer.result.isError, true);
    assert.ok(answer.result.content[0].text.includes('cancelled before worker launch'), answer.result.content[0].text);
    assert.strictEqual(fs.existsSync(launched), false);
    const statuses = jobFiles().map(file => JSON.parse(fs.readFileSync(file, 'utf8')).status);
    assert.deepStrictEqual(statuses, ['abandoned']);
    relay.child.stdin.end();
    await relay.exited(5000);
  } finally {
    held.release();
    await relay.close();
  }
  console.log('        Retained transaction test: ' + root);
});

// ---- added for the Node wrappers: the prompt reaches the app exactly as it was sent ---------
const PROMPT = 'First line of the prompt\n' +
  'Second line with "double" and \'single\' quotes\n' +
  'Third line: $HOME costs $5, `echo no`, a \\ backslash and 100%\n' +
  '    an indented last line; with a semicolon & an ampersand';
const GUARD_LINE =
  "Complete only the assigned task using your own tools. Respect the caller's file scope. " +
  'Do not delegate to another agent or invoke MCP tools. Report changed files and verification honestly.';
const framed = `${GUARD_LINE}\n\n---\n${PROMPT}\n---\n\n${GUARD_LINE}`;

// What each app must receive: the prompt on standard input (Claude, Codex) or as the one
// argument after -p (agy, Kimi), with the same words around it as always.
const ROUTES = {
  claude: {
    answer: JSON.stringify({ result: 'fake claude answer' }),
    stdin: 'Use only your own tools for the assigned task. Do not delegate.\n' + PROMPT,
    argv: () => ['-p', '--output-format', 'json', '--safe-mode', '--disallowedTools', 'Bash', 'Edit', 'Write',
      'NotebookEdit', 'WebFetch', 'WebSearch', '--strict-mcp-config'],
  },
  codex: {
    answer: 'fake codex answer\n',
    stdin: framed,
    argv: () => ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'],
  },
  agy: {
    answer: 'fake agy answer\n',
    stdin: '',
    argv: seen => ['--log-file', seen[1], '--print-timeout', '630s', '-p', framed],
  },
  kimi: {
    answer: JSON.stringify({ role: 'assistant', content: 'fake kimi answer' }) + '\n',
    stdin: '',
    argv: () => ['-p', framed, '--output-format', 'stream-json', '--agent-file', path.join(PKG, 'tools', 'kimi-consult-agent.md')],
  },
  qwen: {
    answer: JSON.stringify([{ type: 'system', subtype: 'init' },
      { type: 'result', subtype: 'success', is_error: false, result: 'fake qwen answer' }]) + '\n',
    stdin: framed,
    argv: () => ['--output-format', 'json', '--safe-mode', '--approval-mode', 'plan'],
  },
};

{
  const root = tempRoot('frenemy-prompt-routes-');
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  for (const seat of SEATS) {
    await t(seat + ': a prompt with several lines, quotes and a $ reaches the app unchanged', async () => {
      const route = ROUTES[seat];
      const record = path.join(root, seat + '-received.json');
      const fake = fakeApp(path.join(root, seat), 'fake-' + seat,
        'const fs = require("fs");\n' +
        'let stdin = "";\n' +
        'try { stdin = fs.readFileSync(0, "utf8"); } catch { /* nothing was sent */ }\n' +
        'fs.writeFileSync(' + JSON.stringify(record) + ', JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }));\n' +
        'process.stdout.write(' + JSON.stringify(route.answer) + ');\n');
      const relay = talk(NODE, [server(seat)], { cwd: root,
        env: safeEnv(root, { [seat.toUpperCase() + '_BIN']: fake, FRENEMY_DRIVER: 'codex' }) });
      try {
        relay.send({ jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: 'ask_' + seat, arguments: { prompt: PROMPT, working_directory: project } } });
        const answer = (await relay.receive(30000, 'the relay did not answer')).result;
        const text = answer.content[0].text;
        assert.strictEqual(answer.isError, false, text + '\n' + relay.stderr());
        assert.ok(text.includes('fake ' + seat + ' answer'), text);
        const seen = JSON.parse(fs.readFileSync(record, 'utf8'));
        assert.strictEqual(seen.stdin, route.stdin);
        assert.deepStrictEqual(seen.argv, route.argv(seen.argv));
        assert.strictEqual(fs.realpathSync(seen.cwd), project);
        relay.child.stdin.end();
        await relay.exited(5000);
      } finally { await relay.close(); }

    });
  }
}

{
  const root = tempRoot('frenemy-qwen-relay-home-');
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  const home = path.join(root, 'home');
  const cases = [
    ['absolute', path.join(root, 'absolute home'), path.join(root, 'absolute home')],
    ['relative', 'relative home', path.join(root, 'relative home')],
    ['tilde', '~/custom home', path.join(home, 'custom home')],
    ['tilde-backslash', '~\\custom home', path.join(home, 'custom home')],
    ['home', '~', home],
    ['empty', '', path.join(home, '.qwen')],
    ['unset', undefined, path.join(home, '.qwen')],
  ];
  for (const [name, value, expected] of cases) {
    await t('Qwen home ' + name + ' reaches consults, write jobs and log discovery', async () => {
      const record = path.join(root, name + '-received.json');
      const fake = fakeApp(path.join(root, name), 'fake-qwen',
        'const fs = require("fs");\n' +
        'fs.readFileSync(0, "utf8");\n' +
        'fs.writeFileSync(' + JSON.stringify(record) + ', JSON.stringify({ home: process.env.QWEN_HOME, cwd: process.cwd() }));\n' +
        'process.stdout.write(' + JSON.stringify(ROUTES.qwen.answer) + ');\n');
      const relay = talk(NODE, [server('qwen')], { cwd: root,
        env: safeEnv(root, { QWEN_BIN: fake, QWEN_HOME: value, FRENEMY_DRIVER: 'claude' }) });
      try {
        for (const [id, tool] of [[1, 'ask_qwen'], [2, 'ask_qwen_write']]) {
          relay.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool,
            arguments: { prompt: 'fixture', working_directory: project, allowed_files: [name + '.txt'] } } });
          const response = await relay.receive(30000, 'Qwen did not answer');
          assert.strictEqual(response.id, id);
          assert.strictEqual(response.result.isError, false, JSON.stringify(response));
          const seen = JSON.parse(fs.readFileSync(record, 'utf8'));
          assert.strictEqual(seen.home, expected);
          const cwd = fs.realpathSync(seen.cwd);
          if (tool === 'ask_qwen') assert.strictEqual(cwd, project);
          else assert.strictEqual(path.dirname(cwd), path.join(project, '.worker-state', 'workspaces'));
        }
        relay.child.stdin.end();
        await relay.exited(5000);
      } finally { await relay.close(); }
      const logs = path.join(expected, 'projects');
      fs.mkdirSync(logs, { recursive: true });
      fs.writeFileSync(path.join(logs, 'fixture.jsonl'), 'qwen-home-marker\n');
      const found = await run(NODE, [path.join(PKG, 'tools', 'prove.mjs'), 'qwen-home-marker', 'qwen'],
        { cwd: root, env: safeEnv(root, { QWEN_HOME: value }) });
      assert.strictEqual(found.code, 0, found.stdout + found.stderr);
      assert.match(found.stdout, /QWEN\s+1 log/);
    });
  }
}

await t('relay normalizes an explicit Qwen home override before changing directories', async () => {
  const root = tempRoot('frenemy-qwen-env-override-');
  const cwd = path.join(root, 'working');
  fs.mkdirSync(cwd);
  const stub = path.join(root, 'environment.mjs');
  fs.writeFileSync(stub, 'console.log(process.env.QWEN_HOME);');
  const bridge = path.join(root, 'bridge.mjs');
  fs.writeFileSync(bridge,
    'import {runWrapper} from ' + JSON.stringify(pathToFileURL(path.join(PKG, 'tools', 'relay-core.mjs')).href) + ';\n' +
    'const result = await runWrapper({script:' + JSON.stringify(stub) + ',cwd:' + JSON.stringify(cwd) +
    ',env:{QWEN_HOME:"explicit-home"},timeoutMs:5000,maxOutput:1000,exitMeaning:{},label:"fixture"},"fixture");\n' +
    'console.log(JSON.stringify(result));\n');
  const result = await run(NODE, [bridge], { cwd: root, env: safeEnv(root, { QWEN_HOME: 'inherited-home' }) });
  assert.strictEqual(result.code, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), { ok: true, text: path.join(root, 'explicit-home') + '\n' });
});

finish('relay transaction tests');
