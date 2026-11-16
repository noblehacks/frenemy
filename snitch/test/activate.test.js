'use strict';
// Integration test for extension.js against a stubbed VS Code API.
// Proves: activate() wires up cleanly, the view renders real job files, the 1s ticker exists
// ONLY while visible + live, and nothing is left running after dispose.
// It does NOT prove VS Code itself loads the extension — that needs a window reload.
const assert = require('assert');
const fs = require('fs');
const retire = require('./retire');
const os = require('os');
const path = require('path');
const Module = require('module');

// ---- timer accounting -------------------------------------------------------
const live = { intervals: new Set(), timeouts: new Set() };
const _si = global.setInterval, _ci = global.clearInterval;
const _st = global.setTimeout, _ct = global.clearTimeout;
global.setInterval = (fn, ms) => { const h = _si(() => {}, 1 << 30); live.intervals.add(h); h._fn = fn; return h; };
global.clearInterval = h => { if (h) { live.intervals.delete(h); _ci(h); } };
global.setTimeout = (fn, ms) => { const h = _st(() => {}, 1 << 30); live.timeouts.add(h); h._fn = fn; h._ms = ms; return h; };
global.clearTimeout = h => { if (h) { live.timeouts.delete(h); _ct(h); } };

// ---- vscode stub ------------------------------------------------------------
const notes = [];
const registered = { commands: [], views: [] };
let watcherHandlers = 0, watcherDisposed = false;
const watchers = [];
const config = { stallSeconds: 180, hideFinishedAfterSeconds: 600, statusBar: false, notify: 'problems' };
const configWrites = [];

const vscodeStub = {
  Uri: {
    file: p => ({ fsPath: p, path: p, toString: () => p }),
    joinPath: (base, ...parts) => {
      const p = [base.fsPath || base.path].concat(parts).join('/');
      return { fsPath: p, path: p, toString: () => p };
    },
  },
  RelativePattern: function (base, pat) { this.base = base; this.pattern = pat; },
  StatusBarAlignment: { Left: 1, Right: 2 },
  workspace: {
    getConfiguration: () => ({
      get: (k, d) => (k in config ? config[k] : d),
      // Writes land in the same object the reads come from, so a flip is observable here
      // exactly as it is in VS Code: the setting changes, and the next read sees it.
      update: (k, v) => { config[k] = v; configWrites.push([k, v]); },
    }),
    createFileSystemWatcher: pattern => {
      const handlers = {};
      const watcher = {
        pattern, handlers,
        onDidChange: fn => { watcherHandlers++; handlers.change = fn; },
        onDidCreate: fn => { watcherHandlers++; handlers.create = fn; },
        onDidDelete: fn => { watcherHandlers++; handlers.delete = fn; },
        dispose: () => { watcherDisposed = true; },
      };
      watchers.push(watcher); return watcher;
    },
    onDidChangeConfiguration: () => {},
  },
  ConfigurationTarget: { Global: 1 },
  window: {
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    registerWebviewViewProvider: (id, prov) => { registered.views.push(id); return { dispose() {} }; },
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {}, text: '', tooltip: '', command: '' }),
    showWarningMessage: m => notes.push(['warn', m]),
    showErrorMessage: m => notes.push(['error', m]),
    showInformationMessage: m => notes.push(['info', m]),
  },
  commands: {
    registerCommand: (id, fn) => { registered.commands.push(id); return { dispose() {} }; },
    executeCommand: () => {},
  },
};
const origLoad = Module._load;
Module._load = function (req) {
  if (req === 'vscode') return vscodeStub;
  return origLoad.apply(this, arguments);
};

// ---- fixture ----------------------------------------------------------------
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fleethome-'));
process.env.HOME = home;
process.env.FLEET_DIR = path.join(home, 'custom-fleet');
delete process.env.CODEX_HOME;
const origHomedir = os.homedir;
os.homedir = () => home;
const JOBS = path.join(process.env.FLEET_DIR, 'jobs');

const ext = require('../extension/extension.js');
const context = { subscriptions: [], extensionUri: vscodeStub.Uri.file('/ext/snitch') };

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

(async () => {
await t('activate() creates the fleet folders and registers everything once', () => {
  ext.activate(context);
  assert.ok(fs.existsSync(JOBS), 'configured fleet directory used');
  assert.ok(fs.existsSync(path.join(process.env.FLEET_DIR, '.tmp')), 'temp dir created outside jobs/');
  assert.deepStrictEqual(registered.views, ['snitch.jobs']);
  assert.deepStrictEqual(registered.commands.sort(),
    ['snitch.clearAll', 'snitch.clearDemo', 'snitch.clearFinished', 'snitch.clearOne',
     'snitch.demo', 'snitch.focus', 'snitch.refresh', 'snitch.toggle',
     'snitch.toggleDriverStyle']);
  assert.strictEqual(watcherHandlers, 6, 'job and IDE event change/create/delete all wired');
});

// grab the provider the extension registered
const provider = context.subscriptions.find(s => typeof s.resolveWebviewView === 'function');
assert.ok(provider, 'provider is disposable and registered');

// The page is written once and then fed data, so the test inspects the LAST PAYLOAD
// posted to it rather than a freshly generated HTML string.
function fakeView() {
  const posted = [];
  return {
    visible: true, badge: undefined, description: undefined, posted,
    webview: {
      options: null, html: '',
      asWebviewUri: u => ({ toString: () => 'vscode-resource:' + (u.fsPath || u.path) }),
      onDidReceiveMessage(fn) { this._msg = fn; },
      postMessage(m) { posted.push(m); return Promise.resolve(true); },
    },
    onDidChangeVisibility(fn) { this._vis = fn; },
    onDidDispose(fn) { this._dis = fn; },
    last() { return posted.length ? posted[posted.length - 1].payload : null; },
  };
}

await t('empty state: page written once, no rows, no timers', () => {
  const v = fakeView();
  provider.resolveWebviewView(v);
  assert.ok(v.webview.html.indexOf('id="app"') !== -1, 'skeleton written once');
  assert.ok(v.webview.html.indexOf("script-src 'nonce-") !== -1, 'script is nonce-gated');
  assert.strictEqual(v.webview.options.enableScripts, true, 'client script may run');
  assert.strictEqual(v.last().rows.length, 0);
  assert.strictEqual(v.last().empty, true);
  assert.strictEqual(live.intervals.size, 0, 'no interval');
  assert.strictEqual(live.timeouts.size, 0, 'nothing to wake up for');
});

await t('a running job is sent as data, and the extension keeps NO periodic timer', () => {
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(JOBS, 'letters.json'), JSON.stringify(
    { id: 'letters', agent: 'claude', title: 'letters fleet', state: 'running',
      step: 18, total: 25, started: now - 3600, beat: now - 2 }));
  const v = fakeView();
  provider.resolveWebviewView(v);
  const p = v.last();
  assert.strictEqual(p.rows.length, 1);
  assert.strictEqual(p.rows[0].title, 'letters fleet');
  assert.strictEqual(p.rows[0].pct, 72, '18/25 = 72%');
  assert.deepStrictEqual(v.badge, { value: 1, tooltip: '1 running, 0 stalled' });
  // This is the point of the rewrite: no once-a-second work in the extension at all.
  assert.strictEqual(live.intervals.size, 0, 'no interval, ever');
  assert.strictEqual(live.timeouts.size, 1, 'one wake-up, aimed at the next status change');
});

await t('hiding the view changes nothing: still one deadline timer, never an interval', () => {
  const v = fakeView();
  provider.resolveWebviewView(v);
  v.visible = false;
  v._vis();                       // VS Code fires onDidChangeVisibility
  assert.strictEqual(live.intervals.size, 0, 'no interval while hidden');
  assert.strictEqual(live.timeouts.size, 1, 'single status-change deadline');
});

await t('a silent job flips to quiet and warns exactly once', () => {
  const now = Math.floor(Date.now() / 1000);
  const v = fakeView();
  provider.resolveWebviewView(v);          // seeds status as running
  notes.length = 0;
  fs.writeFileSync(path.join(JOBS, 'letters.json'), JSON.stringify(
    { id: 'letters', agent: 'claude', title: 'letters fleet', state: 'running', every: 60,
      step: 18, total: 25, started: now - 3600, beat: now - 400 }));
  provider.refresh();
  assert.strictEqual(notes.length, 1, 'one notification');
  assert.strictEqual(notes[0][0], 'warn');
  assert.ok(/has not checked in for/.test(notes[0][1]), notes[0][1]);
  provider.refresh();
  assert.strictEqual(notes.length, 1, 'same state does not re-warn');
  assert.strictEqual(v.last().rows[0].status, 'quiet', 'row is marked quiet in the payload');
});

await t('a dead job archives itself — the owner never clears it by hand', async () => {
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(JOBS, 'crashed.json'), JSON.stringify(
    { id: 'crashed', agent: 'codex', title: 'killed fleet', state: 'running', every: 60,
      step: 2, total: 9, started: now - 9000, beat: now - 2000 }));
  const v = fakeView();
  await provider.resolveWebviewView(v);
  assert.ok(!fs.existsSync(path.join(JOBS, 'crashed.json')), 'file left the jobs folder');
  assert.ok(fs.readdirSync(path.join(process.env.FLEET_DIR, 'trash')).some(f => fs.existsSync(path.join(process.env.FLEET_DIR, 'trash', f, 'crashed.json'))),
    'and landed in the trash, not deleted');
  assert.ok(!v.last().rows.some(r => r.title === 'killed fleet'), 'row is gone from the panel');
});

await t('a finished row still schedules a wake-up, so it can leave on its own', () => {
  const now = Math.floor(Date.now() / 1000);
  for (const f of fs.readdirSync(JOBS)) retire(path.join(JOBS, f));
  fs.writeFileSync(path.join(JOBS, 'ended.json'), JSON.stringify(
    { id: 'ended', agent: 'shell', title: 'flutter test', state: 'done',
      step: 9, total: 9, started: now - 900, beat: now - 60 }));
  const v = fakeView();
  provider.resolveWebviewView(v);
  // Before this, nothing was scheduled for finished rows: the last one sat on screen
  // looking current until some unrelated file event happened to arrive.
  assert.strictEqual(live.timeouts.size, 1, 'the panel wakes to drop it at hideFinishedAfter');
  assert.strictEqual(v.last().rows.length, 1);
});

await t('becoming visible re-reads the folder instead of trusting old state', () => {
  const now = Math.floor(Date.now() / 1000);
  const v = fakeView();
  provider.resolveWebviewView(v);
  const before = v.posted.length;
  // A job appears while the panel is hidden — the case a missed watcher event or a
  // machine sleep produces.
  fs.writeFileSync(path.join(JOBS, 'late.json'), JSON.stringify(
    { id: 'late', agent: 'codex', title: 'arrived while hidden', state: 'running',
      step: 1, total: 3, started: now - 30, beat: now - 2 }));
  v.visible = false; v._vis();
  v.visible = true;  v._vis();
  assert.ok(v.posted.length > before, 'a fresh snapshot was sent on becoming visible');
  assert.ok(v.last().rows.some(r => r.title === 'arrived while hidden'),
    'and it contains what appeared while the panel was away');
});

await t('IDE events reach the panel and completion stops the row', () => {
  const sessions = path.join(home, '.codex', 'sessions');
  fs.mkdirSync(sessions, {recursive:true});
  const file = path.join(sessions, 'rollout-test.jsonl');
  const timestamp = new Date().toISOString();
  const append = payload => fs.appendFileSync(file, JSON.stringify(payload)+'\n');
  append({type:'session_meta', payload:{id:'ide-abc123', source:'vscode', cwd:'/tmp/ide-project'}});
  append({timestamp, type:'event_msg', payload:{type:'task_started'}});
  const watcher = watchers.find(w => w.pattern.pattern.includes('rollout-'));
  function fire() {
    const before = new Set(live.timeouts);
    watcher.handlers.change({fsPath:file});
    const pending = [...live.timeouts].find(t => !before.has(t));
    assert.ok(pending, 'record watcher schedules refresh');
    clearTimeout(pending); pending._fn();
  }
  const v = fakeView(); provider.resolveWebviewView(v);
  fire();
  assert.strictEqual(v.last().rows.find(r => r.id === 'codex-ide-project-abc123').status, 'running');
  append({timestamp, type:'event_msg', payload:{type:'task_complete'}});
  fire();
  assert.strictEqual(v.last().rows.find(r => r.id === 'codex-ide-project-abc123').status, 'done');
});

await t('client faults do not trigger a refresh loop', () => {
  const view = fakeView(); provider.resolveWebviewView(view);
  const before = view.posted.length;
  for (let i = 0; i < 5; i++) provider.onMessage({ type: 'clientError', message: 'fixture error' });
  assert.strictEqual(view.posted.length, before, 'no reflex state posts on page failure');
});

await t('quiet watched jobs notice resumed output and exit without a JSON write', () => {
  const now = Math.floor(Date.now()/1000);
  const watch = path.join(home, 'watched-output.log');
  fs.writeFileSync(watch, 'old output\n');
  fs.utimesSync(watch, now-400, now-400);
  const jobFile = path.join(JOBS, 'bg-resume.json');
  const raw = JSON.stringify({id:'bg-resume',agent:'shell',title:'watched fixture',
    state:'running',every:60,started:now-500,beat:now-400,watch});
  fs.writeFileSync(jobFile, raw);
  const v=fakeView();provider.resolveWebviewView(v);
  assert.equal(v.last().rows.find(r=>r.id==='bg-resume').status,'quiet');
  assert.ok(provider.stallTimer._ms<=6000);
  fs.appendFileSync(watch, 'fresh output\n');
  let timer=provider.stallTimer;clearTimeout(timer);timer._fn();
  assert.equal(v.last().rows.find(r=>r.id==='bg-resume').status,'running');
  assert.equal(fs.readFileSync(jobFile,'utf8'),raw,'no job JSON write occurred');
  fs.appendFileSync(watch, '[exited with code 0]\n');
  timer=provider.stallTimer;clearTimeout(timer);timer._fn();
  assert.equal(v.last().rows.find(r=>r.id==='bg-resume').status,'done');
  v.visible=false;
  provider.reschedule({rows:[{status:'quiet',watched:true,deadAfter:600,beatAge:400}]});
  assert.ok(provider.stallTimer._ms>6000,'hidden panel does not poll watched output');
});

await t('dispose leaves no timers behind', () => {
  provider.dispose();
  for (const s of context.subscriptions) if (s.dispose) s.dispose();
  assert.strictEqual(live.intervals.size, 0, 'no intervals left');
  assert.strictEqual(live.timeouts.size, 0, 'no timeouts left');
});

os.homedir = origHomedir;
Module._load = origLoad;
retire(home, { recursive: true, force: true });
await t('clicking the driver line flips its look and remembers the choice', () => {
  const before = config.driverStyle;
  provider.onMessage({ type: 'driverStyle' });
  provider.onMessage({ type: 'driverStyle' });
  assert.deepStrictEqual(configWrites,
    [['driverStyle', 'underline'], ['driverStyle', 'chip']],
    'it alternates, and each choice is written to the setting: ' + JSON.stringify(configWrites));
  assert.strictEqual(config.driverStyle, 'chip', 'back where it started: ' + before);
});

console.log('\n' + pass + '/' + pass + ' activation tests passed');
process.exit(0);

})().catch(error => {
  console.error(error);
  for (const s of context.subscriptions) s.dispose?.();
  for (const h of live.timeouts) _ct(h);
  for (const h of live.intervals) _ci(h);
  process.exitCode = 1;
});
