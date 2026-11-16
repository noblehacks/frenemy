// Stopping must be finished before the relay says "stopped". Fake apps only.
// Run: node tools/test-relay-shutdown.mjs
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WIN, PKG, NODE, t, skip, finish, sleep, tempRoot, alive, gone, stopHard, fakeApp, sleeperSource, safeEnv, run } from './test-relay-kit.mjs';

const RELAY = pathToFileURL(path.join(PKG, 'tools', 'relay-core.mjs')).href;
const WRAPPERS = [
  ['claude', 'tools/ask-claude-wrapper.mjs', false],
  ['codex', 'tools/ask-codex-wrapper.mjs', false],
  ['kimi', 'ask-kimi.mjs', true],
  ['agy-consult', 'tools/ask-agy-consult.mjs', true],
  ['agy-write', 'ask-agy.mjs', true],
];

function readPid(file) {
  try { return Number(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

async function waitForFile(file, withinMs) {
  const deadline = Date.now() + withinMs;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error('the fake app never started: ' + file);
    await sleep(25);
  }
}

// ---- every wrapper: the app is gone before the relay answers a timeout or a cancel ----------
const evidence = tempRoot('relay-shutdown-regression-');
for (const [name, relative] of WRAPPERS) {
  for (const mode of ['timeout', 'cancel']) {
    await t(name + ' wrapper, ' + mode + ': the app is stopped before the relay answers', async () => {
      const folder = path.join(evidence, name + '-' + mode);
      const pidFile = path.join(folder, 'worker.pid');
      const fake = fakeApp(folder, 'fake', sleeperSource(pidFile));
      const seat = name.split('-')[0].toUpperCase();
      const env = { [seat + '_BIN']: fake, [seat + '_TIMEOUT']: '20' };
      const bridge = path.join(folder, 'bridge.mjs');
      fs.writeFileSync(bridge,
        'import {runWrapper} from ' + JSON.stringify(RELAY) + ';\n' +
        'import {readFileSync} from "node:fs";const c=new AbortController();\n' +
        (mode === 'cancel' ? 'setTimeout(()=>c.abort(),3000);\n' : '') +
        'const result=await runWrapper({script:' + JSON.stringify(path.join(PKG, ...relative.split('/'))) +
        ',signal:c.signal,timeoutMs:' + (mode === 'cancel' ? '10000' : '3000') +
        ',maxOutput:10000,exitMeaning:{},label:"regression",env:' + JSON.stringify(env) + '},"fixture");\n' +
        'const pid=Number(readFileSync(' + JSON.stringify(pidFile) + ',"utf8"));let alive=true;try{process.kill(pid,0)}catch{alive=false}\n' +
        'console.log(JSON.stringify({result,pid,alive}));\n');
      let pid = null;
      try {
        const done = await run(NODE, [bridge], { env: safeEnv(folder), timeoutMs: 12000 + (WIN ? 20000 : 0) });
        assert.strictEqual(done.timedOut, false, 'the relay did not answer in time\n' + done.stderr);
        assert.strictEqual(done.code, 0, done.stderr);
        const reply = JSON.parse(done.stdout);
        pid = reply.pid;
        assert.strictEqual(reply.alive, false, JSON.stringify(reply));
        assert.strictEqual(reply.result.ok, false);
        assert.ok(reply.result.text.includes('observed process tree stopped'), reply.result.text + '\n' + done.stderr);
      } finally {
        if (pid === null) pid = readPid(pidFile);
        stopHard(pid);
      }
    });
  }
}
console.log('Evidence: ' + evidence);

// ---- the host leaves while a stop is still under way: the app it was stopping still dies ----
if (WIN) {
  skip('the host ending during a stop still stops the app', 'a program ended from outside on Windows runs no last step');
} else {
  await t('the host ending during a stop still stops the app, and nothing else', async () => {
    const folder = tempRoot('relay-host-exit-regression-');
    const pidFile = path.join(folder, 'worker.pid');
    // The "wrapper" here is itself the app that will not stop when asked.
    const wrapper = path.join(folder, 'wrapper.mjs');
    fs.writeFileSync(wrapper, sleeperSource(pidFile).replace('const fs = require("fs");', 'import fs from "node:fs";'));
    const bridge = path.join(folder, 'bridge.mjs');
    fs.writeFileSync(bridge,
      'import {runWrapper} from ' + JSON.stringify(RELAY) + ';\n' +
      'const c=new AbortController();setTimeout(()=>{c.abort();console.log("STOPPING")},3000);\n' +
      'await runWrapper({script:' + JSON.stringify(wrapper) + ',signal:c.signal,timeoutMs:10000,maxOutput:1000,exitMeaning:{},label:"regression"},"fixture");\n');
    const sentinel = spawn(NODE, ['-e', 'setTimeout(() => {}, 40000)'], { stdio: 'ignore' });
    let host = null, pid = null;
    try {
      host = spawn(NODE, [bridge], { env: safeEnv(folder), stdio: ['ignore', 'pipe', 'pipe'] });
      const firstLine = await new Promise((resolve, reject) => {
        let text = '';
        const timer = setTimeout(() => reject(new Error('the host never said it was stopping')), 8000);
        host.stdout.setEncoding('utf8');
        host.stdout.on('data', chunk => {
          text += chunk;
          if (text.includes('\n')) { clearTimeout(timer); resolve(text.split('\n')[0].trim()); }
        });
      });
      assert.strictEqual(firstLine, 'STOPPING');
      pid = readPid(pidFile);
      assert.ok(pid, 'the app wrote its process number');
      const hostEnded = new Promise(resolve => host.on('exit', resolve));
      host.kill('SIGTERM');
      assert.notStrictEqual(await Promise.race([hostEnded, sleep(5000).then(() => 'late')]), 'late', 'the host did not end');
      const deadline = Date.now() + 3000;
      while (alive(pid) && Date.now() < deadline) await sleep(50);
      assert.strictEqual(alive(pid), false, 'host exit left its pending target alive');
      assert.strictEqual(sentinel.exitCode, null, 'unrelated process was signalled');
      assert.strictEqual(sentinel.signalCode, null, 'unrelated process was signalled');
    } finally {
      if (host && host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
      if (pid === null) pid = readPid(pidFile);
      stopHard(pid);
      sentinel.kill('SIGKILL');
    }
  });
}

// ---- added for the Node wrappers: a wrapper that is told to stop takes its app with it -------
if (WIN) {
  skip('a stopped wrapper leaves no app running', 'a program ended from outside on Windows runs no last step; the relay stops the whole tree there');
} else {
  const folder = tempRoot('relay-wrapper-stop-');
  for (const [name, relative, promptAsArgument] of WRAPPERS) {
    for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) {
      await t(name + ' wrapper stopped by ' + signal + ' while the app sleeps: exit ' + code + ', no app left', async () => {
        const here = path.join(folder, name + '-' + signal);
        const pidFile = path.join(here, 'worker.pid');
        const fake = fakeApp(here, 'fake', sleeperSource(pidFile));
        const seat = name.split('-')[0].toUpperCase();
        const child = spawn(NODE, [path.join(PKG, ...relative.split('/')), ...(promptAsArgument ? ['fixture'] : [])],
          { env: safeEnv(here, { [seat + '_BIN']: fake, [seat + '_TIMEOUT']: '20' }), stdio: ['pipe', 'ignore', 'ignore'] });
        const ended = new Promise(resolve => child.on('exit', (exitCode, by) => resolve({ exitCode, by })));
        let pid = null;
        try {
          child.stdin.on('error', () => {});
          child.stdin.end(promptAsArgument ? '' : 'fixture');
          await waitForFile(pidFile, 8000);
          pid = readPid(pidFile);
          assert.ok(alive(pid), 'the app is running before the stop');
          child.kill(signal);
          const end = await Promise.race([ended, sleep(4000).then(() => null)]);
          assert.ok(end, 'the wrapper did not end');
          assert.strictEqual(end.exitCode, code);
          assert.strictEqual(await gone(pid, 2000), true, 'the app outlived its wrapper');
        } finally {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          if (pid === null) pid = readPid(pidFile);
          stopHard(pid);
        }
      });
    }
  }
}

finish('relay shutdown tests');
