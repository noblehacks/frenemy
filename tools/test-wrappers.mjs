// The five wrappers, one at a time, each against a fake AI app: what the app is started with,
// what comes back, the caps and every exit code.
// Run: node tools/test-wrappers.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { WIN, PKG, NODE, t, finish, tempRoot, gone, stopHard, fakeApp, safeEnv, run } from './test-relay-kit.mjs';
import { ARG_PROMPT_CAP } from './wrapper-common.mjs';

const root = tempRoot('frenemy-wrapper-test-');
let record = null, runs = 0;      // where the fake app of the latest run wrote what it received

// One fake for every seat. What it prints and how it ends is set by FAKE_* names in its
// environment, which the wrappers pass through to the app untouched.
const fake = fakeApp(path.join(root, 'bin'), 'fake-app',
  'const fs = require("fs"), e = process.env, argv = process.argv.slice(2);\n' +
  'let stdin = "";\n' +
  'try { stdin = fs.readFileSync(0, "utf8"); } catch { /* nothing was sent */ }\n' +
  'fs.writeFileSync(e.FAKE_RECORD, JSON.stringify({ pid: process.pid, argv, stdin, driver: e.FRENEMY_DRIVER, user: e.USER }));\n' +
  'const at = argv.indexOf("--log-file");\n' +
  'if (e.FAKE_LOG && at >= 0) fs.writeFileSync(argv[at + 1], e.FAKE_LOG);\n' +
  'if (e.FAKE_STDERR) fs.writeSync(2, e.FAKE_STDERR);\n' +
  'if (e.FAKE_BIG) fs.writeSync(1, Buffer.alloc(Number(e.FAKE_BIG), "x"));\n' +
  'if (e.FAKE_STDOUT) fs.writeSync(1, e.FAKE_STDOUT);\n' +
  'if (e.FAKE_STDOUT_FILE) fs.writeSync(1, fs.readFileSync(e.FAKE_STDOUT_FILE));\n' +
  'const leave = () => process.exit(Number(e.FAKE_EXIT || 0));\n' +
  'if (e.FAKE_SLEEP) { process.on("SIGTERM", () => {}); setTimeout(leave, Number(e.FAKE_SLEEP) * 1000); } else leave();\n');

const QUOTA = fs.readFileSync(path.join(PKG, 'tools', 'test-fixtures', 'agy-quota.txt'), 'utf8');
const PROFILE = path.join(PKG, 'tools', 'kimi-consult-agent.md');
const kimiLine = text => JSON.stringify({ role: 'assistant', content: text }) + '\n';

// name: the word that starts the wrapper's own messages. byArgument: the prompt is handed to
// the app as one argument (and may be given to the wrapper as one), not on standard input.
const WRAPPERS = [
  { name: 'ask-claude', file: 'tools/ask-claude-wrapper.mjs', seat: 'CLAUDE', byArgument: false,
    good: { FAKE_STDOUT: JSON.stringify({ result: 'the answer' }) }, shown: 'the answer\n',
    argv: () => ['-p', '--output-format', 'json', '--safe-mode', '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', '--strict-mcp-config'] },
  { name: 'ask-codex', file: 'tools/ask-codex-wrapper.mjs', seat: 'CODEX', byArgument: false,
    good: { FAKE_STDOUT: 'the answer\n' }, shown: 'the answer\n',
    argv: () => ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'] },
  { name: 'ask-agy-consult', file: 'tools/ask-agy-consult.mjs', seat: 'AGY', byArgument: true,
    good: { FAKE_STDOUT: 'the answer\n' }, shown: 'the answer\n',
    argv: (prompt, seen) => ['--log-file', seen[1], '--print-timeout', '630s', '-p', prompt] },
  { name: 'ask-agy', file: 'ask-agy.mjs', seat: 'AGY', byArgument: true,
    good: { FAKE_STDOUT: 'the answer\n' }, shown: 'the answer\n',
    argv: (prompt, seen) => ['--log-file', seen[1], '--dangerously-skip-permissions', '--print-timeout', '630s', '-p', prompt] },
  { name: 'ask-kimi', file: 'ask-kimi.mjs', seat: 'KIMI', byArgument: true,
    good: { FAKE_STDOUT: '{"role":"user","content":"q"}\n' + kimiLine('the') + 'not json\n' + kimiLine('answer\n\n') }, shown: 'the\nanswer\n',
    argv: prompt => ['-p', prompt, '--output-format', 'stream-json', '--agent-file', PROFILE] },
];

function start(w, { args = [], input = '', env = {}, timeoutMs = 20000 } = {}) {
  record = path.join(root, 'received-' + (++runs) + '.json');
  return run(NODE, [path.join(PKG, ...w.file.split('/')), ...args],
    { input, env: safeEnv(root, { [w.seat + '_BIN']: fake, FAKE_RECORD: record, ...env }), cwd: root, timeoutMs });
}
const received = () => JSON.parse(fs.readFileSync(record, 'utf8'));
const give = (w, prompt) => (w.byArgument ? { args: [prompt] } : { input: prompt });
const PROMPT = 'two lines, "quotes"\nand a $ sign';

for (const w of WRAPPERS) {
  const T = w.seat + '_TIMEOUT';
  const said = (done, line) => assert.ok(done.stderr.split('\n').includes(line), 'expected the line: ' + line + '\ngot: ' + done.stderr);

  await t(w.name + ': answers, and starts the app with the expected words', async () => {
    const done = await start(w, { ...give(w, PROMPT), env: w.good });
    assert.strictEqual(done.code, 0, done.stderr);
    assert.strictEqual(done.stdout, w.shown);
    const seen = received();
    assert.deepStrictEqual(seen.argv, w.argv(PROMPT, seen.argv));
    assert.strictEqual(seen.stdin, w.byArgument ? '' : PROMPT);
    if (w.name !== 'ask-claude') assert.strictEqual(seen.driver, 'claude');
    assert.ok(seen.user, 'the app is told who the user is');
  });

  if (w.byArgument) {
    await t(w.name + ': takes the prompt from standard input when no argument is given', async () => {
      const done = await start(w, { input: PROMPT + '\n\n', env: w.good });
      assert.strictEqual(done.code, 0, done.stderr);
      assert.strictEqual(received().argv[received().argv.indexOf('-p') + 1], PROMPT);
    });
    await t(w.name + ': two arguments are refused (exit 2)', async () => {
      const done = await start(w, { args: ['a', 'b'], env: w.good });
      assert.strictEqual(done.code, 2);
      said(done, w.name + ': expected one prompt argument (or stdin), got 2');
    });
  }

  await t(w.name + ': an empty prompt is refused (exit 2)', async () => {
    const done = await start(w, { input: '', env: w.good });
    assert.strictEqual(done.code, 2);
    if (w.name !== 'ask-claude') said(done, w.name + ': empty prompt');
    assert.strictEqual(fs.existsSync(record), false, 'the app was started');
  });

  // A prompt handed over as one argument has a smaller cap on Linux (see ARG_PROMPT_CAP).
  const cap = w.byArgument ? ARG_PROMPT_CAP : 200000;
  await t(w.name + ': a prompt of ' + cap + ' bytes passes and one byte more is refused (exit 2)', async () => {
    if (!(WIN && w.byArgument)) {      // a Windows command line cannot carry that much
      const most = await start(w, { input: 'p'.repeat(cap), env: w.good });
      assert.strictEqual(most.code, 0, most.stderr.slice(0, 500));
    }
    const over = await start(w, { input: 'p'.repeat(cap + 1), env: w.good });
    assert.strictEqual(over.code, 2);
    if (w.name !== 'ask-claude') said(over, w.name + ': prompt is ' + (cap + 1) + ' bytes; cap is ' + cap);
    assert.strictEqual(fs.existsSync(record), false, 'the app was started');
  });

  await t(w.name + ': a time limit that is not a number is refused (exit 2)', async () => {
    const done = await start(w, { ...give(w, PROMPT), env: { ...w.good, [T]: '5s' } });
    assert.strictEqual(done.code, 2);
    said(done, w.name === 'ask-claude' ? 'Invalid CLAUDE_TIMEOUT' : w.name + ': ' + T + " must be a number, got '5s'");
  });

  await t(w.name + ': a missing app is exit 127', async () => {
    const absent = path.join(root, 'absent-app');
    const done = await start(w, { ...give(w, PROMPT), env: { [w.seat + '_BIN']: absent } });
    assert.strictEqual(done.code, 127);
    if (w.name !== 'ask-claude') said(done, w.name + ': ' + w.seat.toLowerCase() + ' not found/executable at ' + absent);
  });

  await t(w.name + ': the app\'s own exit code is passed on with its answer', async () => {
    const done = await start(w, { ...give(w, PROMPT), env: { ...w.good, FAKE_EXIT: '7', FAKE_STDERR: 'the app complained\n' } });
    assert.strictEqual(done.code, 7);
    if (w.name === 'ask-claude') said(done, 'the answer');
    else { assert.strictEqual(done.stdout, w.shown); said(done, 'the app complained'); }
  });

  await t(w.name + ': an app that says nothing is a failure (exit 1)', async () => {
    const done = await start(w, { ...give(w, PROMPT), env: { FAKE_STDERR: 'only an error\n' } });
    assert.strictEqual(done.code, 1);
    assert.strictEqual(done.stdout, '');
    if (w.name === 'ask-kimi') said(done, 'ask-kimi: kimi produced no answer text (exit 0)');
    else if (w.name !== 'ask-claude') said(done, 'wrapper: worker produced no answer');
    if (w.name !== 'ask-claude') said(done, 'only an error');
  });

  await t(w.name + ': past the time limit it ends with exit 124 and the app is gone', async () => {
    const done = await start(w, { ...give(w, PROMPT), env: { ...w.good, FAKE_SLEEP: '40', [T]: '1' } });
    const pid = received().pid;
    try {
      assert.strictEqual(done.code, 124, done.stderr);
      said(done, w.name === 'ask-claude' ? 'claude timed out after 1s'
        : w.name + ': ' + w.seat.toLowerCase() + ' timed out after 1s and was killed');
      assert.strictEqual(await gone(pid, 2000), true, 'the app outlived the time limit');
    } finally { stopHard(pid); }
  });
}

// ---- the answer cap ---------------------------------------------------------------------
for (const w of WRAPPERS.filter(one => one.name !== 'ask-claude' && one.name !== 'ask-kimi')) {
  await t(w.name + ': an answer over 200,000 bytes is cut there and says so', async () => {
    const exact = await start(w, { ...give(w, PROMPT), env: { FAKE_BIG: '200000' } });
    assert.strictEqual(exact.stdout.length, 200000);
    const over = await start(w, { ...give(w, PROMPT), env: { FAKE_BIG: '200001' } });
    assert.strictEqual(over.code, 0);
    assert.strictEqual(over.stdout, 'x'.repeat(200000) + '\n[' + w.name + ': answer truncated at 200000 bytes]\n');
  });
}

const [claude, codex, consult, agy, kimi] = WRAPPERS;

await t('ask-kimi: an answer over 200,000 bytes is cut there and says so', async () => {
  // The long answer goes through a file: Linux refuses one environment value over 128 KiB.
  const big = path.join(root, 'kimi-big-answer.txt');
  fs.writeFileSync(big, kimiLine('y'.repeat(200001)));
  const done = await start(kimi, { args: [PROMPT], env: { FAKE_STDOUT_FILE: big } });
  assert.strictEqual(done.code, 0);
  assert.strictEqual(done.stdout, 'y'.repeat(200000) + '\n[ask-kimi: answer truncated at 200000 bytes]\n');
});

await t('ask-claude: an answer over 200,000 characters is cut there', async () => {
  const big = path.join(root, 'claude-big-answer.txt');
  fs.writeFileSync(big, JSON.stringify({ result: 'é'.repeat(200005) }));
  const done = await start(claude, { input: PROMPT, env: { FAKE_STDOUT_FILE: big } });
  assert.strictEqual(done.code, 0);
  assert.strictEqual(done.stdout, 'é'.repeat(200000) + '\n');
});

// ---- each seat's own rules ----------------------------------------------------------------
await t('ask-claude: CLAUDE_WRITE=1 swaps the read-only words for the editing ones', async () => {
  const done = await start(claude, { input: PROMPT, env: { ...claude.good, CLAUDE_WRITE: '1' } });
  assert.strictEqual(done.code, 0, done.stderr);
  assert.deepStrictEqual(received().argv, ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--setting-sources', 'user']);
});

await t('ask-claude: an answer marked as an error, a blank or missing one and one that is not JSON are all exit 1', async () => {
  const marked = await start(claude, { input: PROMPT, env: { FAKE_STDOUT: JSON.stringify({ result: 'it went wrong', is_error: true }) } });
  assert.deepStrictEqual([marked.code, marked.stdout, marked.stderr], [1, '', 'it went wrong\n']);
  const blank = await start(claude, { input: PROMPT, env: { FAKE_STDOUT: JSON.stringify({ result: '  ' }) } });
  assert.deepStrictEqual([blank.code, blank.stdout, blank.stderr], [1, '', '  \n']);
  const none = await start(claude, { input: PROMPT, env: { FAKE_STDOUT: JSON.stringify({ other: 1 }) } });
  assert.deepStrictEqual([none.code, none.stdout, none.stderr], [1, '', 'Claude returned no answer\n']);
  const list = await start(claude, { input: PROMPT, env: { FAKE_STDOUT: '[1]' } });
  assert.deepStrictEqual([list.code, list.stdout, list.stderr], [1, '', "'list' object has no attribute 'get'\n"]);
  const broken = await start(claude, { input: PROMPT, env: { FAKE_STDOUT: 'not json' } });
  assert.deepStrictEqual([broken.code, broken.stdout], [1, '']);
});

await t('ask-claude: when Claude fails, its reason (or its error text) is passed on with its exit code', async () => {
  const reason = await start(claude, { input: PROMPT, env: { FAKE_STDOUT: JSON.stringify({ result: 'r'.repeat(4100) }), FAKE_EXIT: '3' } });
  assert.deepStrictEqual([reason.code, reason.stdout, reason.stderr], [3, '', 'r'.repeat(4000) + '\n']);
  const none = await start(claude, { input: PROMPT, env: { FAKE_STDOUT: JSON.stringify({ result: ' ' }), FAKE_EXIT: '3' } });
  assert.deepStrictEqual([none.code, none.stderr], [3, 'Claude failed without an answer\n']);
  const text = await start(claude, { input: PROMPT, env: { FAKE_STDOUT: 'oops', FAKE_STDERR: 'why it failed\n', FAKE_EXIT: '3' } });
  assert.deepStrictEqual([text.code, text.stderr], [3, 'why it failed\n\n']);
  const silent = await start(claude, { input: PROMPT, env: { FAKE_EXIT: '3' } });
  assert.deepStrictEqual([silent.code, silent.stderr], [3, 'Claude failed without usable output\n']);
});

await t('ask-codex: CODEX_WRITE=1 lets Codex write inside its folder; anything else is read-only', async () => {
  await start(codex, { input: PROMPT, env: { ...codex.good, CODEX_WRITE: '1' } });
  assert.deepStrictEqual(received().argv, ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-']);
  await start(codex, { input: PROMPT, env: { ...codex.good, CODEX_WRITE: 'yes' } });
  assert.deepStrictEqual(received().argv, ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-']);
});

await t('ask-codex: the prompt reaches Codex without the line ends after its last line', async () => {
  await start(codex, { input: PROMPT + '\n\n\n', env: codex.good });
  assert.strictEqual(received().stdin, PROMPT);
});

await t('a caller that names itself is passed on to the app as the driver', async () => {
  await start(codex, { input: PROMPT, env: { ...codex.good, FRENEMY_DRIVER: 'kimi' } });
  assert.strictEqual(received().driver, 'kimi');
});

for (const w of [consult, agy]) {
  await t(w.name + ': Google\'s quota line in the log ends the run with exit 75 and the reset time', async () => {
    const done = await start(w, { args: [PROMPT], env: { FAKE_LOG: QUOTA, FAKE_SLEEP: '40' } });
    const pid = received().pid;
    try {
      assert.strictEqual(done.code, 75, done.stderr);
      assert.strictEqual(done.stderr, 'Google quota exhausted (Individual quota reached); worker stopped; reported reset in 15h27m31s.\n');
      assert.strictEqual(await gone(pid, 2000), true, 'the app outlived the quota stop');
    } finally { stopHard(pid); }
  });

  await t(w.name + ': the quota line without a reset time, and the same words merely quoted', async () => {
    const bare = await start(w, { args: [PROMPT], env: { ...w.good, FAKE_LOG: QUOTA.replace(/ Resets in [0-9hms]+\./, '') } });
    assert.deepStrictEqual([bare.code, bare.stderr], [75, 'Google quota exhausted (Individual quota reached); worker stopped.\n']);
    const quoted = await start(w, { args: [PROMPT], env: { ...w.good, FAKE_LOG: 'the user wrote: Individual quota reached. Resets in 3h.\n' } });
    assert.deepStrictEqual([quoted.code, quoted.stdout], [0, 'the answer\n']);
  });

  await t(w.name + ': AGY_LOG_FILE names the log, and no time limit asks agy for 24h', async () => {
    const log = path.join(root, w.name + '-own.log');
    const done = await start(w, { args: [PROMPT], env: { ...w.good, AGY_LOG_FILE: log, AGY_TIMEOUT: '0', FAKE_LOG: 'started\n' } });
    assert.strictEqual(done.code, 0, done.stderr);
    const seen = received().argv;
    assert.strictEqual(seen[1], log);
    assert.strictEqual(seen[seen.indexOf('--print-timeout') + 1], '24h');
    assert.strictEqual(fs.readFileSync(log, 'utf8'), 'started\n');
  });

  await t(w.name + ': agy\'s own "no output produced" line is a failure (exit 1), only at the start of a line', async () => {
    const failed = await start(w, { args: [PROMPT], env: { FAKE_STDOUT: 'text\njetski: no output produced by the model\n', FAKE_STDERR: 'more\n' } });
    assert.deepStrictEqual([failed.code, failed.stdout, failed.stderr], [1, '', 'text\njetski: no output produced by the model\nmore\n']);
    const fine = await start(w, { args: [PROMPT], env: { FAKE_STDOUT: 'it said jetski: no output produced\n' } });
    assert.deepStrictEqual([fine.code, fine.stdout], [0, 'it said jetski: no output produced\n']);
  });
}

await t('ask-kimi: KIMI_FULL=1 drops the read-only profile and says so', async () => {
  const done = await start(kimi, { args: [PROMPT], env: { ...kimi.good, KIMI_FULL: '1' } });
  assert.strictEqual(done.code, 0, done.stderr);
  assert.strictEqual(done.stderr, 'ask-kimi: FULL-RIGHTS seat (Kimi may write files and run shell commands)\n');
  assert.deepStrictEqual(received().argv, ['-p', PROMPT, '--output-format', 'stream-json']);
});

await t('ask-kimi: without its read-only profile it refuses to run (exit 3)', async () => {
  const absent = path.join(root, 'absent-profile.md');
  const done = await start(kimi, { args: [PROMPT], env: { ...kimi.good, KIMI_AGENT_FILE: absent } });
  assert.strictEqual(done.code, 3);
  assert.ok(done.stderr.startsWith('ask-kimi: consult profile missing at ' + absent), done.stderr);
  assert.strictEqual(done.stderr.trim().split('\n').length, 3);
  assert.strictEqual(fs.existsSync(record), false, 'the app was started');
});

await t('ask-kimi: KIMI_AGENT_FILE names another profile, and a NODE_BIN that is not there is exit 3', async () => {
  const own = path.join(root, 'own-profile.md');
  fs.writeFileSync(own, 'profile\n');
  await start(kimi, { args: [PROMPT], env: { ...kimi.good, KIMI_AGENT_FILE: own } });
  assert.strictEqual(received().argv[5], own);
  const absent = path.join(root, 'absent-node');
  const done = await start(kimi, { args: [PROMPT], env: { ...kimi.good, NODE_BIN: absent } });
  assert.deepStrictEqual([done.code, done.stderr], [3, 'ask-kimi: node not found/executable at ' + absent + '\n']);
});

await t('ask-kimi: a failing Kimi with no answer text passes on its own exit code', async () => {
  const done = await start(kimi, { args: [PROMPT], env: { FAKE_STDOUT: 'plain words\n', FAKE_EXIT: '5' } });
  assert.deepStrictEqual([done.code, done.stdout, done.stderr], [5, '', 'ask-kimi: kimi produced no answer text (exit 5)\nplain words\n']);
});

if (WIN) {
  for (const w of [consult, agy, kimi]) {
    await t(w.name + ': on Windows a prompt too long for a command line is refused (exit 2)', async () => {
      const done = await start(w, { input: 'p'.repeat(30001), env: w.good });
      assert.strictEqual(done.code, 2);
      assert.ok(done.stderr.includes('on Windows the cap is 30000'), done.stderr);
      assert.strictEqual(fs.existsSync(record), false, 'the app was started');
    });
  }
}

console.log('Evidence: ' + root);
finish('wrapper tests');
