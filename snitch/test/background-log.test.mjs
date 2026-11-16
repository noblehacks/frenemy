// Finding the output file of a Claude background task without guessing across projects.
// Plain Node, no test framework. Run: node snitch/test/background-log.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBackgroundLog } from '../hooks/beat-lib.mjs';

let pass = 0, fail = 0;
const t = (name, body) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snitch-background-log-test-'));
  const log = (project, session) => {
    const file = path.join(root, project, session, 'tasks', 'task1.output');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'recorded output\n');
    return file;
  };
  try { body(root, log); pass++; console.log('  ok  ' + name); }
  catch (error) { fail++; console.log('  FAIL ' + name); console.log('       ' + String(error && error.stack ? error.stack : error).split('\n').join('\n       ')); }
};

t('current project beats unrelated stale session', (root, log) => {
  const wrong = log('old-project', 'session');
  fs.writeFileSync(wrong, '[exited with code 0]\n');
  const expected = log('current-project', 'session');
  assert.strictEqual(resolveBackgroundLog('task1', 'session', '/projects/current-project/session.jsonl', root), expected);
});

t('rotated session keeps project identity', (root, log) => {
  const expected = log('current-project', 'old-session');
  log('unrelated-project', 'old-session');
  assert.strictEqual(resolveBackgroundLog('task1', 'new-session', '/projects/current-project/new-session.jsonl', root), expected);
});

t('ambiguous fallback is rejected', (root, log) => {
  log('a', 'session'); log('b', 'session');
  assert.throws(() => resolveBackgroundLog('task1', 'session', '', root), /ambiguous/);
});

t('glob and traversal task ids are rejected', root => {
  for (const task of ['*', '../task', 'task/other']) {
    assert.throws(() => resolveBackgroundLog(task, 'session', '/projects/p/s.jsonl', root), Error, 'accepted ' + task);
  }
});

console.log('');
console.log(pass + '/' + (pass + fail) + ' background log tests passed');
process.exit(fail === 0 ? 0 : 1);
