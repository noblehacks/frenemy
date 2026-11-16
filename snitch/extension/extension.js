'use strict';
// Snitch — live progress for long-running jobs (Claude Code, Codex, agy, Kimi, shell fleets).
// No server or daemon. Reads job files and actual IDE events; renders a webview view.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { archive } = require('./lib/archive-jobs');
const archiveRuns = new Set();   // archives in flight, so dispose() can ask them to stop
const model = require('./lib/model');
const { renderShell } = require('./lib/render');
const { buildPayload } = require('./lib/payload');
const { CodexFeed } = require('./lib/codex-feed');

function nonce() {
  let s = '';
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}

const FLEET_DIR = process.env.FLEET_DIR || path.join(os.homedir(), '.fleet');
const JOBS_DIR = path.join(FLEET_DIR, 'jobs');

function cfg() {
  const c = vscode.workspace.getConfiguration('snitch');
  return {
    stallAfter: c.get('stallSeconds', 180),
    deadAfter: c.get('deadSeconds', 900),
    hideDoneAfter: c.get('hideFinishedAfterSeconds', 600),
    statusBar: c.get('statusBar', false),
    driverStyle: c.get('driverStyle', 'chip'), // 'chip' | 'underline'
    notify: c.get('notify', 'problems'), // 'off' | 'problems' | 'all'
    autoArchive: c.get('autoArchiveDead', true),
  };
}

class FleetView {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.tick = null;          // 1s interval, only while visible AND something is running
    this.stallTimer = null;    // single timeout, used while hidden
    this.debounce = null;
    this.lastStatus = new Map();
    this.statusItem = null;
    this.expanded = new Set();   // which rows are open; held here so a re-render cannot lose it
    this.archiveBusy = false;
    this.archiveRetryAt = 0;
    this.disposed = false;
    this.rev = 0;                // snapshot number, so the page can reject an older one
    this.log = null;             // output channel, created only if the page ever reports a fault
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [media] };

    // The page is written ONCE. After this the extension only posts data, so rows keep
    // their DOM identity and the bar has something to animate from.
    const n = nonce();
    const appFile = vscode.Uri.joinPath(media, 'app.js');
    // ?v=<mtime> so an edited client is never served from the webview's cache. Together with
    // the stylesheet now being read from disk, hiding and showing this view is enough to pick
    // up any change to the panel — no window reload.
    let stamp = 0;
    try { stamp = Math.floor(fs.statSync(appFile.fsPath).mtimeMs); } catch (e) {}
    webviewView.webview.html = renderShell({
      nonce: n,
      scriptUri: webviewView.webview.asWebviewUri(appFile).toString() + '?v=' + stamp,
    });

    webviewView.webview.onDidReceiveMessage(m => this.onMessage(m),
                                            null, this.context.subscriptions);
    // Becoming visible re-reads the jobs folder. Re-arming the timer alone left the panel
    // showing whatever was true when it was hidden — including across machine sleep, and
    // including any watcher event that was missed while it was away.
    webviewView.onDidChangeVisibility(
      () => { if (webviewView.visible) this.refresh(); else this.reschedule(); },
      null, this.context.subscriptions);
    webviewView.onDidDispose(() => { this.view = null; this.reschedule(); },
                             null, this.context.subscriptions);
    return this.refresh();
  }

  // If wall-clock jumped much further than our own timers should allow, the machine was
  // asleep. Every job gets one clean window before its silence counts (Codex fix #5) —
  // otherwise closing the lid marks the whole fleet dead.
  noteWallClock(now) {
    const gap = this.lastSeen ? now - this.lastSeen : 0;
    this.lastSeen = now;
    if (gap > 120) this.graceUntil = now + 120;
    return this.graceUntil && now < this.graceUntil ? this.graceUntil : null;
  }

  currentView() {
    const c = cfg();
    const now = Math.floor(Date.now() / 1000);
    c.graceUntil = this.noteWallClock(now);
    const view = model.buildView(JOBS_DIR, now, c);
    const live = new Set(view.rows.map(r => r.id));
    for (const id of Array.from(this.expanded)) if (!live.has(id)) this.expanded.delete(id);
    for (const row of view.rows) row.expanded = this.expanded.has(row.id);
    return view;
  }

  toggle(id) {
    if (typeof id !== 'string' || !id.length || id.length > 128) return;
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this.refresh();
  }

  // Clicking the driver line flips its look. Written to the user setting rather than held
  // in memory so the choice survives a reload, and so it is visible where every other
  // Snitch preference lives. The config change itself triggers the redraw.
  flipDriverStyle() {
    const c = vscode.workspace.getConfiguration('snitch');
    const next = c.get('driverStyle', 'chip') === 'chip' ? 'underline' : 'chip';
    c.update('driverStyle', next, vscode.ConfigurationTarget.Global);
  }

  // Messages arrive from the page. Ids are untrusted strings and are validated against
  // what is actually on disk before anything touches a file.
  onMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'ready': this.refresh(); break;
      case 'toggle': this.toggle(m.id); break;
      case 'clearOne': vscode.commands.executeCommand('snitch.clearOne', m.id); break;
      case 'clearFinished': vscode.commands.executeCommand('snitch.clearFinished'); break;
      case 'clearAll': vscode.commands.executeCommand('snitch.clearAll'); break;
      case 'driverStyle': this.flipDriverStyle(); break;
      // The page could not draw a row. It already says so on that row; here it is recorded
      // where it can be read, and the newest state is sent again in case the fault was
      // transient. Deliberately NOT a popup — the owner is not to be nagged.
      case 'clientError': {
        if (!this.log) this.log = vscode.window.createOutputChannel('Snitch');
        this.log.appendLine(new Date().toISOString() + '  row ' + String(m.id).slice(0, 128) +
                            ': ' + String(m.message).slice(0, 300));
        // The page already marks the faulty row. Retry on the next real state
        // change, rather than refreshing in response to its own rendering error.
        break;
      }
      default: break;
    }
  }

  refresh() {
    if (this.disposed) return;
    const c = cfg();
    let view = this.currentView();

    // Anything judged dead is archived here, not left for the owner to clear by hand.
    if (c.autoArchive && view.reapable.length && !this.archiveBusy && Date.now() >= this.archiveRetryAt) {
      const gone = new Set(view.reapable);
      this.archiveBusy = true;
      return sweep((id, row) => !gone.has(id) || !row || row.status !== 'dead', true).then(result => {
        this.archiveBusy = false;
        if (result.errors.length || result.skipped) this.archiveRetryAt = Date.now() + 30000;
        reportArchive(result, false);
        gone.forEach(id => this.expanded.delete(id));
        this.refresh();
      });
    }

    if (this.view) {
      const payload = buildPayload(view, c.driverStyle);
      payload.rev = ++this.rev;
      this.view.webview.postMessage({ type: 'state', payload });
      this.view.badge = view.active
        ? { value: view.active, tooltip: `${view.running} running, ${view.stalled} stalled` }
        : undefined;
      this.view.description = view.overallPct !== null ? view.overallPct + '%' : undefined;
    }

    this.updateStatusItem(view, c);
    this.notifyChanges(view, c);
    this.reschedule(view);
  }

  updateStatusItem(view, c) {
    if (!c.statusBar) {
      if (this.statusItem) { this.statusItem.dispose(); this.statusItem = null; }
      return;
    }
    if (!this.statusItem) {
      this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      this.statusItem.command = 'snitch.focus';
      this.context.subscriptions.push(this.statusItem);
    }
    if (!view.active) { this.statusItem.hide(); return; }
    const pct = view.overallPct !== null ? ` ${view.overallPct}%` : '';
    const eta = view.worstEta !== null ? ` · ~${model.formatDur(view.worstEta)}` : '';
    this.statusItem.text = `$(pulse) ${view.active} job${view.active > 1 ? 's' : ''}${pct}${eta}`;
    this.statusItem.tooltip = 'Snitch — click to open';
    this.statusItem.show();
  }

  notifyChanges(view, c) {
    if (c.notify === 'off') return;
    const seen = new Set();
    for (const row of view.rows) {
      seen.add(row.id);
      const prev = this.lastStatus.get(row.id);
      this.lastStatus.set(row.id, row.status);
      if (prev === undefined || prev === row.status) continue;
      if (row.status === 'quiet') {
        vscode.window.showWarningMessage(
          `Snitch: "${row.title}" has not checked in for ${model.formatDur(row.beatAge)}.`);
      } else if (row.status === 'failed' && row.quota) {
        // An account failure is said in the model's own wording, which carries the
        // provider's words and claims no cause it cannot prove.
        vscode.window.showErrorMessage(
          `Snitch: ${row.agent} stopped on "${row.title}". ${String(row.quota).replace(/\s+/g, " ").slice(0, 260)}`);
      } else if (row.status === 'failed') {
        vscode.window.showErrorMessage(`Snitch: "${row.title}" failed.${row.note ? " " + String(row.note).replace(/\s+/g, " ").slice(0, 160) : ""}`);
      } else if (row.status === 'done' && c.notify === 'all') {
        vscode.window.showInformationMessage(
          `Snitch: "${row.title}" finished in ${model.formatDur(row.elapsed)}.`);
      }
    }
    for (const id of Array.from(this.lastStatus.keys())) if (!seen.has(id)) this.lastStatus.delete(id);
  }

  // Timer law, after the rewrite: the extension has NO periodic timer at all. Clock-driven
  // text ("14s ago", "3m left") is relabelled by the page itself, which costs the extension
  // nothing and stops entirely when VS Code tears the hidden webview down.
  //
  // The extension wakes only when a job's STATUS could genuinely change — the moment it
  // would cross from running to quiet, or quiet to dead — as one setTimeout, not a poll.
  reschedule(precomputed) {
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }

    const view = precomputed || this.currentView();

    // The windows come from the row itself. The silence law lives in model.js alone; a
    // second copy here would quietly disagree with it the first time either changed.
    const hideDoneAfter = cfg().hideDoneAfter;
    let soonest = Infinity;
    for (const r of view.rows) {
      let next = Infinity;
      if (r.status === 'running') next = isFinite(r.quietAfter) ? r.quietAfter : r.deadAfter;
      else if (r.status === 'quiet') next = r.deadAfter;
      // A finished row leaves the list on its own schedule, so the panel has to wake for it.
      // Without this the last finished job sat on screen indefinitely, looking current,
      // until some unrelated file event happened to arrive. (agy found this one.)
      else if (r.status === 'done' || r.status === 'failed') next = hideDoneAfter;
      if (isFinite(next)) soonest = Math.min(soonest, next - r.beatAge);
    }
    // A running job that streams into a watched output file changes nothing under the
    // *.json watcher, so its "Latest output" only refreshed when the hook happened to
    // write — stale the moment the chat went quiet (Codex, 2026-08-31). While the panel
    // is VISIBLE and such a job runs, wake every 5s; hidden or idle, the no-timer law
    // stands untouched.
    if (this.view && this.view.visible &&
        view.rows.some(r => (r.status === 'running' || r.status === 'quiet') && r.watched)) {
      soonest = Math.min(isFinite(soonest) ? soonest : 5, 5);
    }
    if (!isFinite(soonest)) return;
    this.stallTimer = setTimeout(() => this.refresh(), Math.max(1, soonest + 1) * 1000);
  }

  dispose() {
    this.disposed = true;
    for (const run of archiveRuns) run.stopped = true;
    if (this.tick) clearInterval(this.tick);
    if (this.stallTimer) clearTimeout(this.stallTimer);
    if (this.debounce) clearTimeout(this.debounce);
    if (this.statusItem) this.statusItem.dispose();
  }
}

function writeDemo() {
  const now = Math.floor(Date.now() / 1000);
  const jobs = [
    { id: 'demo-letters', demo: true, agent: 'claude', title: 'letters fleet', state: 'running',
      step: 18, total: 25, started: now - 1500, beat: now - 2, note: 'letter R' },
    { id: 'demo-gate', demo: true, agent: 'codex', title: 'gate audit', state: 'running',
      step: 1, total: 5, started: now - 300, beat: now - 4 },
    { id: 'demo-review', demo: true, agent: 'agy', title: 'engine review', state: 'running',
      step: 2, total: 0, started: now - 700, beat: now - 340, note: 'no total known' },
    { id: 'demo-tests', demo: true, agent: 'shell', title: 'flutter test', state: 'done',
      step: 558, total: 558, started: now - 240, beat: now - 30 },
  ];
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  for (const j of jobs) {
    fs.writeFileSync(path.join(JOBS_DIR, j.id + '.json'), JSON.stringify(j, null, 1));
    const times = [];
    for (let i = j.step; i > 0 && times.length < 8; i--) times.unshift(now - (j.step - i) * 80 - 2);
    fs.writeFileSync(path.join(JOBS_DIR, j.id + '.steps'), times.join('\n') + '\n');
  }
}

// Nothing is ever unlinked — rows move to ~/.fleet/trash/ (house trash law).
// `keep` decides what stays: it is given the job id and the decorated row (when known).
function sweep(keep, checked = false) {
  const snapshots = new Map();
  model.readJobs(JOBS_DIR, (job, raw) => snapshots.set(job.id, {
    row:model.decorate(job, Math.floor(Date.now() / 1000), cfg()),
    hash:createHash('sha256').update(raw).digest('hex')
  }));
  const jobs = [], errors = [];
  let files;
  try { files = fs.readdirSync(JOBS_DIR); }
  catch (error) { return Promise.resolve({cleared:0,skipped:0,errors:[{id:'jobs',error:error.message}]}); }
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5);
    try {
      // Selection and fingerprint must describe the same snapshot.
      const snapshot = snapshots.get(id);
      if (keep(id, snapshot?.row)) continue;
      const hash = snapshot?.hash || createHash('sha256')
        .update(fs.readFileSync(path.join(JOBS_DIR, name))).digest('hex');
      jobs.push({id,hash});
    } catch (error) { if (error.code !== 'ENOENT') errors.push({id,error:error.message}); }
  }
  if (!jobs.length) return Promise.resolve({cleared:0,skipped:0,errors});
  return new Promise(resolve => {
    // The archive runs inside the extension, under the same per-job lock as every writer.
    const run = {stopped:false};
    archiveRuns.add(run);
    archive(JOBS_DIR, jobs, checked, {timeoutMs:15000, stopped:() => run.stopped}).then(result => {
      archiveRuns.delete(run);
      result.errors.push(...errors);
      resolve(result);
    }, failure => {
      archiveRuns.delete(run);
      resolve({cleared:0,skipped:0,errors:[...errors,
        {id:'archive',error:'Archive did not finish; some jobs may already be archived. ' + failure.message}]});
    });
  });
}

function reportArchive(result, notify = true) {
  if (result.errors.length) {
    vscode.window.showErrorMessage(`Snitch: cleared ${result.cleared} job(s); ${result.errors.length} failed. ` +
      result.errors.map(e => `${e.id}: ${e.error}`).join('; ').slice(0, 500));
  } else if (notify) {
    const skipped = result.skipped ? ` ${result.skipped} changed or disappeared and were left alone.` : '';
    vscode.window.showInformationMessage(`Snitch: cleared ${result.cleared} job(s). Archives are in ${path.join(FLEET_DIR,'trash')}.${skipped}`);
  }
}

// A job id arrives from a command URI, so it is untrusted: it must be a short string
// that matches a job actually on disk, and it never touches a path unvalidated (Codex #7).
function validId(id) {
  if (typeof id !== 'string' || !id.length || id.length > 128) return null;
  if (id.indexOf('/') !== -1 || id.indexOf('\\') !== -1 || id.charAt(0) === '.') return null;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
  return fs.existsSync(path.join(JOBS_DIR, id + '.json')) ? id : null;
}

function activate(context) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.mkdirSync(path.join(FLEET_DIR, '.tmp'), { recursive: true });

  const provider = new FleetView(context);
  const sessions = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  const feed = new CodexFeed(sessions, JOBS_DIR);
  context.subscriptions.push(provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('snitch.jobs', provider,
      { webviewOptions: { retainContextWhenHidden: false } }));

  // VS Code owns the kqueue handle and its lifecycle (agy fix #1).
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(JOBS_DIR), '*.json'));
  const bump = () => {
    if (provider.debounce) clearTimeout(provider.debounce);
    provider.debounce = setTimeout(() => provider.refresh(), 200); // events are hints; rescan all
  };
  watcher.onDidChange(bump); watcher.onDidCreate(bump); watcher.onDidDelete(bump);
  context.subscriptions.push(watcher);

  // This also covers conversations already open when native hooks were installed.
  // VS Code owns the watcher; each refresh consumes only newly recorded bytes.
  const pendingSessions = new Set();
  let feedTimer;
  const sessionWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(sessions), '**/rollout-*.jsonl'));
  const feedChanged = uri => {
    pendingSessions.add(uri.fsPath);
    if (feedTimer) return;
    feedTimer = setTimeout(() => {
      feedTimer = null;
      for (const file of pendingSessions) feed.update(file);
      pendingSessions.clear();
      provider.refresh();
    }, 200);
  };
  sessionWatcher.onDidChange(feedChanged);
  sessionWatcher.onDidCreate(feedChanged);
  sessionWatcher.onDidDelete(feedChanged);
  context.subscriptions.push(sessionWatcher, { dispose() { if (feedTimer) clearTimeout(feedTimer); } });
  feed.scan();

  context.subscriptions.push(
    vscode.commands.registerCommand('snitch.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('snitch.toggleDriverStyle',
      () => provider.flipDriverStyle()),
    vscode.commands.registerCommand('snitch.focus',
      () => vscode.commands.executeCommand('snitch.jobs.focus')),
    vscode.commands.registerCommand('snitch.demo', () => {
      writeDemo(); provider.refresh();
      vscode.window.showInformationMessage('Snitch: demo jobs written to ~/.fleet/jobs.');
    }),
    vscode.commands.registerCommand('snitch.clearDemo', async () => {
      const result = await sweep(id => id.indexOf('demo-') !== 0);
      provider.refresh(); reportArchive(result);
    }),
    vscode.commands.registerCommand('snitch.toggle', id => provider.toggle(id)),
    vscode.commands.registerCommand('snitch.clearOne', async id => {
      const ok = validId(id);
      if (!ok) return;
      const result = await sweep(jid => jid !== ok);
      provider.expanded.delete(ok);
      provider.refresh(); reportArchive(result, false);
    }),
    vscode.commands.registerCommand('snitch.clearFinished', async () => {
      const result = await sweep((id, row) => !row || (row.status !== 'done' && row.status !== 'failed'), true);
      provider.refresh(); reportArchive(result);
    }),
    vscode.commands.registerCommand('snitch.clearAll', async () => {
      // Clearing archives records; it never cancels work or needs a hidden dialog.
      const result = await sweep(() => false);
      provider.expanded.clear();
      provider.refresh(); reportArchive(result);
    }));

  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('snitch')) provider.refresh();
  }, null, context.subscriptions);
}

function deactivate() {}

module.exports = { activate, deactivate };
