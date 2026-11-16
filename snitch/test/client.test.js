'use strict';
// Runs the SHIPPING webview client (media/app.js) in a real browser and drives it through
// the sequences a person actually performs. Node tests cannot catch this class of bug: the
// panel froze on stale rows for hours because one uncaught TypeError in paint() aborted
// every later render, and all 38 other tests stayed green throughout.
//
//   node test/client.test.js
//
// Reports blocked (exit 2) if no Chromium-family browser is installed — it is a real browser test,
// not a mock, and a missing browser is not a failure of the code under test.
const assert = require('assert');
const fs = require('fs');
const retire = require('./retire');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const m = require('../extension/lib/model');
const { renderShell } = require('../extension/lib/render');
const { buildPayload } = require('../extension/lib/payload');

const BROWSERS = [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const browser = process.env.SNITCH_TEST_BROWSER || BROWSERS.find(b => fs.existsSync(b));
if (!browser) { console.error('BLOCKED: no Chromium-family browser found — no visual pass'); process.exit(2); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetclient-'));
const client = fs.readFileSync(path.join(__dirname, '..', 'extension', 'media', 'app.js'), 'utf8');
const now = Math.floor(Date.now() / 1000);

function row(over) {
  const r = m.decorate(Object.assign({ id: 'chat', agent: 'claude', title: 'Example Project',
    state: 'running', step: 0, started: now - 11850, beat: now - 17, note: 'working',
    cwd: '/Users/x/Example Project' }, over), now, {});
  r.expanded = !!over.expanded;
  return r;
}
function payload(rows, running, driverStyle) {
  return buildPayload({ rows, running: running, stalled: 0, failed: 0, worstEta: null,
                        drivers: m.driversOf(rows) }, driverStyle);
}

// Runs a script of payloads in one page and returns { error, text } from the finished DOM.
function drive(name, sends, actions = '') {
  const boot = `
    var __err = 'none';
    window.addEventListener('error', function (e) { __err = e.message; });
    var __sent = []; function acquireVsCodeApi(){ return { postMessage: function (m) { __sent.push(m); } }; }
    ${client}
    function send(p){ window.dispatchEvent(new MessageEvent('message', { data: { type:'state', payload:p } })); }
    ${sends.map(p => `send(${JSON.stringify(p)});`).join('\n    ')}
    ${actions}
    // Let the client's own 1s relabel tick run before we look. Virtual time makes this
    // instant, and it means every test here also covers the relabel path — which is where
    // a stats desync hid until agy pointed at it.
    // A narrow dock is where the driver line breaks: at the default width everything fits
    // and the four-driver overflow is invisible. 300px is narrower than his dock.
    document.body.style.width = '300px';
    setTimeout(function () {
      var dl = document.getElementById('drvline');
      document.title = 'ERR=' + __err
        + ' |DETAILS=' + document.querySelectorAll('.detail').length
        // Wider content than box = a name running off the edge under overflow:hidden.
        + ' |OVER=' + (dl ? Math.max(0, dl.scrollWidth - dl.clientWidth) : 0)
        + ' |CLASS=' + (dl ? dl.className : '')
        // Read part by part: one textContent would run "DRIVER" and "Claude" together, and
        // would say nothing about what the line actually looks like.
        + ' |DRIVERS=' + (dl && dl.style.display !== 'none'
            ? Array.prototype.map.call(dl.querySelectorAll('.lab, .pill'), function (c) {
                return c.textContent.replace(/\\s+/g, ' ').trim(); }).join(' ') : '')
        + ' |TEXT=' + document.getElementById('app').textContent.replace(/\\s+/g, ' ').trim()
        + ' |SENT=' + JSON.stringify(__sent)
        + ' |CLEAR=' + document.getElementById('clearFinished').style.display;
    }, 1500);
  `;
  const file = path.join(dir, name + '.html');
  fs.writeFileSync(file, renderShell({ standalone: true, nonce: 'preview', inlineScript: boot }));
  const dom = execFileSync(process.execPath,
    [path.join(__dirname, 'browser-runner.mjs'), browser, 'file://' + file],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 40000, maxBuffer: 1 << 24 });
  const title = (dom.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1];
  // The title is KEY=value segments joined by " |". Split once, in order, so adding a
  // field later cannot silently shift the meaning of the ones already there.
  const KEYS = ['ERR', 'DETAILS', 'OVER', 'CLASS', 'DRIVERS', 'TEXT', 'SENT', 'CLEAR'];
  const got = {};
  let rest = title;
  for (let i = 0; i < KEYS.length; i++) {
    const next = KEYS[i + 1] ? ' |' + KEYS[i + 1] + '=' : null;
    const body = rest.replace(KEYS[i] + '=', '');
    if (!next) { got[KEYS[i]] = body; break; }
    const cut = body.indexOf(next);
    got[KEYS[i]] = cut < 0 ? body : body.slice(0, cut);
    rest = cut < 0 ? '' : body.slice(cut + 2);
  }
  return { error: got.ERR, details: Number(got.DETAILS), overflow: Number(got.OVER),
           cls: got.CLASS || '', drivers: got.DRIVERS || '', text: got.TEXT || '',
           sent:JSON.parse(got.SENT || '[]'), clearDisplay:got.CLEAR };
}

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

t('clear buttons dispatch commands and finished visibility follows status', () => {
  const finished = drive('clear-buttons', [payload([row({state:'done'})], 0)],
    "document.getElementById('clearFinished').click();document.getElementById('clearAll').click();");
  assert.equal(finished.error,'none');
  assert.notEqual(finished.clearDisplay,'none');
  assert(finished.sent.some(m=>m.type==='clearFinished'));
  assert(finished.sent.some(m=>m.type==='clearAll'));
  const running = drive('clear-running', [payload([row({state:'running'})], 1)]);
  assert.equal(running.clearDisplay,'none');
});

t('open, close, open again — the sequence that froze the panel', () => {
  const r = drive('toggle', [
    payload([row({ expanded: false })], 1),
    payload([row({ expanded: true })], 1),
    payload([row({ expanded: false })], 1),
    payload([row({ expanded: true })], 1),
  ]);
  assert.strictEqual(r.error, 'none', 'no uncaught error: ' + r.error);
  assert.strictEqual(r.details, 1, 'the detail is rebuilt on the second open');
  assert.ok(/This is Claude working with you/.test(r.text), r.text);
});

t('a finished job that starts working again updates its row', () => {
  // His 2026-08-13 screenshot: the header said "1 job running" while the row underneath
  // still read "Finished — Took 3h 12m" from hours earlier.
  const r = drive('revive', [
    payload([row({ state: 'done', beat: now - 400, expanded: true })], 0),
    payload([row({ expanded: true })], 1),
  ]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(!/Finished/.test(r.text), 'stale "Finished" is gone: ' + r.text);
  assert.ok(/Working/.test(r.text), 'the row shows it working again: ' + r.text);
});

t('a new job appears without needing the panel reopened', () => {
  const first = row({ expanded: true });
  const second = row({ id: 'render', title: 'letter masters', step: 2, total: 25,
                       note: 'letter C' });
  const r = drive('appear', [
    payload([first], 1),
    payload([first, second], 2),
  ]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(/letter masters/.test(r.text), 'the new job is on screen: ' + r.text);
});

t('rows that leave the payload leave the panel', () => {
  const a = row({ expanded: true });
  const b = row({ id: 'gone', title: 'old codex job', state: 'done' });
  const r = drive('remove', [payload([a, b], 1), payload([a], 1)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(!/old codex job/.test(r.text), 'cleared row is gone: ' + r.text);
});

t('a closed row leaves no empty box behind', () => {
  const r = drive('noghost', [
    payload([row({ expanded: true })], 1),
    payload([row({ expanded: false })], 1),
  ]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.strictEqual(r.details, 0, 'the detail element is removed, not emptied');
  assert.ok(!/This is Claude working with you/.test(r.text), 'and its contents are gone: ' + r.text);
});

t('the stats line does not keep a ghost when a stat appears', () => {
  // Without an ETA the line reads "50% · 2 of 4 · Running 3h"; with one it reads
  // "50% · 2 of 4 · about 5m left". Updating by index left the old third value behind.
  const base = { id: 'chat', step: 2, total: 4, expanded: false };
  const noEta = row(base);
  const withEta = row(Object.assign({}, base, {
    stepTimes: [now - 300, now - 200, now - 100] }));
  const r = drive('stats', [payload([noEta], 1), payload([withEta], 1)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(/left/.test(r.text), 'the ETA is shown: ' + r.text);
  assert.ok(!/Started \d/.test(r.text), 'the pre-ETA text is gone, not stranded: ' + r.text);
});

t('an out-of-order snapshot is ignored', () => {
  const fresh = payload([row({ note: 'newest state' })], 1);
  fresh.rev = 9;
  const stale = payload([row({ note: 'older state' })], 1);
  stale.rev = 4;
  const r = drive('rev', [fresh, stale]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(/newest state/.test(r.text), 'newest survives: ' + r.text);
  assert.ok(!/older state/.test(r.text), 'the late arrival is dropped: ' + r.text);
});

// ---- the driver line -------------------------------------------------------
t('nothing launched by anyone else means no driver line at all', () => {
  const r = drive('nodriver', [payload([row({})], 1)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.strictEqual(r.drivers, '', 'the line is hidden, not blank: ' + r.drivers);
});

t('one driver is named once, with no count', () => {
  const consult = row({ id: 'cx', agent: 'codex', driver: 'claude', title: 'Codex review' });
  const r = drive('onedriver', [payload([row({}), consult], 2)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.strictEqual(r.drivers, 'FROM Claude', 'reads plainly: ' + r.drivers);
  // And the row itself still wears its own logo, not the driver's.
  assert.ok(/Codex review/.test(r.text), r.text);
});

t('two drivers get a count each', () => {
  const a = row({ id: 'cx', agent: 'codex', driver: 'claude', title: 'Codex review' });
  const b = row({ id: 'km', agent: 'kimi', driver: 'claude', title: 'Kimi check' });
  const c = row({ id: 'gm', agent: 'agy', driver: 'codex', title: 'Gemini second' });
  const r = drive('twodrivers', [payload([a, b, c], 3)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.strictEqual(r.drivers, 'FROM Claude2 Codex1', 'busiest first: ' + r.drivers);
});

// Four drivers at a narrow dock is the case his eye caught: one name dropped to a second
// line, and the colour under it belonged to somebody else. Both are measured now.
function fourDriverRows() {
  return [
    row({ id: 'c1', agent: 'codex', driver: 'claude', title: 'Codex review' }),
    row({ id: 'c2', agent: 'kimi', driver: 'claude', title: 'Kimi check' }),
    row({ id: 'x1', agent: 'agy', driver: 'codex', title: 'Gemini second' }),
    row({ id: 'g1', agent: 'claude', driver: 'agy', title: 'Claude build' }),
    row({ id: 'k1', agent: 'codex', driver: 'kimi', title: 'Codex probe' }),
  ];
}

t('four drivers still fit on one line at a narrow dock', () => {
  const r = drive('fourfit', [payload(fourDriverRows(), 5)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.strictEqual(r.overflow, 0, 'nothing runs off the edge: ' + r.overflow + 'px over');
  assert.ok(/n4/.test(r.cls), 'the crowded layout is applied: ' + r.cls);
  // The word survives the squeeze; the counts are what give way.
  assert.ok(/^FROM /.test(r.drivers), 'the word still leads: ' + r.drivers);
  // Busiest first, then by agent key — Gemini's key is "agy", which is why it precedes Codex.
  assert.strictEqual(r.drivers, 'FROM Claude Gemini Codex Kimi', r.drivers);
});

t('three drivers fit too, counts and all', () => {
  const rows = fourDriverRows().slice(0, 4);
  const r = drive('threefit', [payload(rows, 4)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.strictEqual(r.overflow, 0, 'nothing runs off the edge: ' + r.overflow + 'px over');
  assert.strictEqual(r.drivers, 'FROM Claude2 Gemini1 Codex1', r.drivers);
});

t('the underline look is drawn only when it is chosen', () => {
  const rows = [row({ id: 'cx', agent: 'codex', driver: 'claude', title: 'Codex review' })];
  const plain = drive('stylechip', [payload(rows, 1, 'chip')]);
  const under = drive('styleunder', [payload(rows, 1, 'underline')]);
  assert.strictEqual(plain.error, 'none', plain.error);
  assert.strictEqual(under.error, 'none', under.error);
  assert.ok(!/under/.test(plain.cls), 'chip look carries no underline class: ' + plain.cls);
  assert.ok(/under/.test(under.cls), 'the other look does: ' + under.cls);
  // Same words either way — the toggle changes the paint, never the facts.
  assert.strictEqual(plain.drivers, under.drivers, plain.drivers + ' vs ' + under.drivers);
});

t('the driver line goes away when its jobs do', () => {
  const consult = row({ id: 'cx', agent: 'codex', driver: 'claude', title: 'Codex review' });
  const r = drive('driverleaves', [
    payload([row({}), consult], 2),
    payload([row({})], 1),
  ]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.strictEqual(r.drivers, '', 'no stale driver line left behind: ' + r.drivers);
});

t('an opened row says who launched it', () => {
  const consult = row({ id: 'cx', agent: 'codex', driver: 'claude',
                        title: 'Codex review', expanded: true });
  const r = drive('launchedby', [payload([consult], 1)]);
  assert.strictEqual(r.error, 'none', r.error);
  // The label and its value are separate cells, so the dumped text runs them together.
  assert.ok(/Launched by\s*Claude/.test(r.text), 'the detail names the driver: ' + r.text);
});

// ---- what a background consult says (his 2026-08-31 complaint) -------------
t('a background job speaks with its own last output line, not a frozen note', () => {
  // The old hook stamped "running in the background" on every consult and the row said
  // nothing else for its whole life. The row's voice is now the job's own output.
  const bg = row({ id: 'bg-b31u82f53', agent: 'codex', driver: 'claude',
                   title: 'Generate three independent Codex takes',
                   lastOut: 'rendering take 2 of 3' });
  const r = drive('bgvoice', [payload([row({}), bg], 2)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(/rendering take 2 of 3/.test(r.text), 'the output line is the status: ' + r.text);
  assert.ok(!/running in the background/i.test(r.text), 'the filler is gone: ' + r.text);
});

t('an opened row leads with the plain-words story', () => {
  const bg = row({ id: 'bg-x1', agent: 'codex', driver: 'claude',
                   title: 'Generate three independent Codex takes',
                   lastOut: 'rendering take 2 of 3', expanded: true });
  const r = drive('story', [payload([bg], 1)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(/Claude asked Codex to do this/.test(r.text), 'who initiated, in words: ' + r.text);
  assert.ok(/Started at/.test(r.text) && /latest activity was/.test(r.text),
    'start time and latest activity are distinct: ' + r.text);
  assert.ok(!/has been going for/.test(r.text), 'no claim of continuous work');
});

t('a chat with a checklist gets a live percentage from its plan', () => {
  const chat = row({ tasks: [
    { done: true, text: 'Read the hook' },
    { done: true, text: 'Fix the note' },
    { done: false, active: true, text: 'Restyle the panel' },
    { done: false, text: 'Run the tests' },
  ] });
  const r = drive('planpct', [payload([chat], 1)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(/50%/.test(r.text), 'plan progress as a number: ' + r.text);
  assert.ok(/2 of 4 tasks/.test(r.text), 'with its denominator beside it: ' + r.text);
});

t('a failed row leads with the reason, not the exit code', () => {
  // Codex's catch: the failed branch returned the note ("stopped with code 1") before
  // ever looking at what the job actually printed last.
  const bad = row({ id: 'bg-x9', agent: 'codex', driver: 'claude', state: 'failed',
                    title: 'consult', note: 'stopped with code 1',
                    lastOut: 'No prompt provided via stdin.', beat: now - 30 });
  const r = drive('failvoice', [payload([bad], 0)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(/No task instructions were supplied/.test(r.text), 'the reason leads in plain words: ' + r.text);
});

t('a quiet row does not also claim to be Running', () => {
  // Kimi's catch: "Running 3h" in the stats line under a "No response" badge.
  const stuck = row({ id: 'q1', every: 60, beat: now - 400, started: now - 3600 });
  const r = drive('quietstats', [payload([stuck], 0)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(/No response/.test(r.text), 'the row is quiet: ' + r.text);
  assert.ok(!/Running \d/.test(r.text), 'and the stats do not contradict it: ' + r.text);
  assert.ok(/so far/.test(r.text), 'elapsed is still told, honestly: ' + r.text);
});

t('a finished job says "Done in", never "Took"', () => {
  const done = row({ state: 'done', step: 4, total: 4, beat: now - 60 });
  const r = drive('donein', [payload([done], 0)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(/Done in/.test(r.text), 'the finished wording: ' + r.text);
  assert.ok(!/Took/.test(r.text), '"Took" is banned wording: ' + r.text);
});

t('normal details translate raw scripts and helper tool names without changing evidence', () => {
  const raw = "Python3 - <<'PY' from pathlib import Path import json p=Path(...)";
  const job = row({agent:'codex', title:'frenemy 2', expanded:true,
    note:raw, lastOut:raw, trail:[
      {at:now-50,times:1,text:'collaboration.followup_task'},
      {at:now-25,times:1,text:raw},
    ]});
  const r = drive('plain-activity', [payload([job], 1)]);
  assert.strictEqual(r.error, 'none', r.error);
  assert.ok(/Assigned work to a helper/.test(r.text), r.text);
  assert.ok(/Ran a script/.test(r.text), r.text);
  assert.ok(/Codex/.test(r.text) && /latest activity/.test(r.text), r.text);
  assert.ok(!/Python3|pathlib|collaboration\.|has been going for|Running \d/.test(r.text), r.text);
  assert.strictEqual(job.trail[1].text, raw, 'stored evidence remains unchanged');
});

retire(dir, { recursive: true, force: true });
console.log('\n' + pass + '/' + pass + ' client tests passed');
