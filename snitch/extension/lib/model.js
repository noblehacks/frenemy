'use strict';
// Snitch model — pure functions, no VS Code imports so node can test it directly.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DIR = path.join(os.homedir(), '.fleet', 'jobs');

const AGENTS = {
  claude: { label: 'claude', hue: 22 },
  codex:  { label: 'codex',  hue: 145 },
  agy:    { label: 'agy',    hue: 205 },
  kimi:   { label: 'kimi',   hue: 275 },
  shell:  { label: 'shell',  hue: 0 },
};

function agentOf(name) {
  const key = String(name || 'shell').toLowerCase();
  return AGENTS[key] ? key : 'shell';
}

// Read every <id>.json in dir. Malformed / half-written files are skipped, never thrown on.
function readJobs(dir, onRead) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  const jobs = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(dir, name);
    let raw;
    try { raw = fs.readFileSync(full, 'utf8'); } catch (e) { continue; } // ENOENT mid-rename
    let job;
    try { job = JSON.parse(raw); } catch (e) { continue; }               // partial write
    if (!job || typeof job !== 'object' || Array.isArray(job)) continue;
    job.id = path.basename(name, '.json');
    if (!/^[A-Za-z0-9._-]+$/.test(job.id)) continue;
    for (const key of ['cwd','title','note','watch','driver','by']) {
      if (typeof job[key] !== 'string') job[key] = '';
    }
    job.stepTimes = readStepTimes(path.join(dir, job.id + '.steps'));
    job.watchAt = watchedAt(job.watch);
    job.trail = readTrail(path.join(dir, job.id + '.trail'));
    const tasksFile = path.join(dir, job.id + '.tasks');
    job.tasks = readTasks(tasksFile);
    job.tasksAt = job.tasks.length ? watchedAt(tasksFile) : 0;
    job.lastOut = lastLine(job.watch);
    job.quotaOut = quotaNote(job.watch) || quotaFromNote(job);
    if (job.id.startsWith('bg-') && job.watch && job.state === 'running') {
      try {
        const fd = fs.openSync(job.watch, 'r');
        let tail;
        try {
          const size = fs.fstatSync(fd).size;
          const buf = Buffer.alloc(Math.min(size, 4096));
          fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
          tail = buf.toString('utf8');
        } finally { fs.closeSync(fd); }
        const exit = tail.match(/(?:^|\n)\[exited with code (-?\d+)\]\s*$/);
        if (exit) {
          job.state = Number(exit[1]) === 0 ? 'done' : 'failed';
          job.beat = job.watchAt || job.beat;
        }
      } catch (_) { /* watch file can disappear during refresh */ }
    }
    if (onRead) onRead(job, raw);
    jobs.push(job);
  }
  return jobs;
}

// When a job names a file it writes (`fleet start --watch FILE`), that file's mtime is the
// most honest evidence available: a heartbeat only proves a loop is alive, whereas a growing
// output proves WORK is happening. One stat per watched job, only when the panel reads jobs.
function watchedAt(file) {
  if (!file || typeof file !== 'string') return 0;
  try { return Math.floor(fs.statSync(file).mtimeMs / 1000); } catch (e) { return 0; }
}

// The last few things an agent actually did, written by the hook AFTER each tool finished.
// Past tense throughout, and stored with its own timestamp so the panel can age it rather
// than imply it is still happening.
function readTrail(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  return raw.split('\n').map(line => {
    const p = line.split('\t');
    if (p.length < 3) return null;
    const at = parseInt(p[0], 10);
    const times = parseInt(p[1], 10);
    if (!Number.isFinite(at) || !p[2]) return null;
    return { at, times: Number.isFinite(times) && times > 1 ? times : 1, text: p[2] };
  }).filter(Boolean).slice(-5);
}

// The model's own checklist, exactly as it last wrote it. Since his 2026-08-31 order it
// is also the fallback denominator (planPct in decorate); the 2026-08-15 reviewer
// objection lives on as the "N of M tasks" fraction always shown beside the number.
function readTasks(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  return raw.split('\n').map(line => {
    const p = line.split('\t');
    if (p.length < 2 || !p[1]) return null;
    return { done: p[0] === 'completed', active: p[0] === 'in_progress', text: p[1] };
  // Read the WHOLE plan (bounded only against pathology): planPct divides by this list's
  // length, and slicing at 12 here made a 20-item plan with its first 12 done read "100%"
  // (Codex review, 2026-08-31). The panel caps what it DISPLAYS in payload.js instead.
  }).filter(Boolean).slice(0, 100);
}

// The cleaned tail of a file a job wrote. Bounded read: the tail, never the whole thing,
// which can be megabytes. Shared by lastLine() and quotaNote().
function tailLines(file) {
  if (!file || typeof file !== 'string') return [];
  let fd;
  try {
    const size = fs.statSync(file).size;
    if (!size) return [];
    const len = Math.min(size, 4096);
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8')
      // Control characters and ANSI colour codes are noise from a terminal, not content.
      .replace(/\[[0-9;?]*[A-Za-z]/g, '')
      .split('\n')
      .map(s => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim())
      .filter(Boolean)
      // The harness stamps "[exited with code N]" onto the end of every background job's
      // output. It is the row's status, which the row already states in words — and taking
      // it as the last line hid the actual reason one line above it, which is the entire
      // point of showing this field. (Caught in the preview, 2026-08-15.)
      .filter(s => !/^\[exited with code -?\d+\]$/.test(s));
  } catch (e) {
    return [];
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* already gone */ } }
  }
}

// The last non-empty line a job wrote. Two Codex consults failed with the reason sitting
// unread in these files while the panel showed only "stopped with code 1" (2026-08-15).
function lastLine(file) {
  const lines = tailLines(file);
  const last = lines.length ? lines[lines.length - 1] : '';
  return last.length > 110 ? last.slice(0, 109) + '…' : last;
}

// Design rule: when a job died because a subscription/quota ran out — and ONLY
// when that is certain — the panel says so in plain words. Certain means the provider's
// own error text, matched against signatures COPIED VERBATIM from real failures on this
// machine (the fixture law). Only Google's is wired so far, from agy's own logs
// (2026-07-26 → 08-02); add others only when their real text has been seen on disk.
function quotaNote(file) {
  const lines = tailLines(file);
  for (let i = lines.length - 1; i >= 0; i--) {
    // agy / Google, verbatim class: "RESOURCE_EXHAUSTED (code 429): Individual quota
    // reached. Please upgrade your subscription to increase your limits. Resets in 29h21m42s."
    if (/RESOURCE_EXHAUSTED \(code 429\)|Individual quota reached/.test(lines[i])) {
      const reset = (lines[i].match(/Resets in ([0-9hms]+)/) || [])[1];
      return 'Google’s quota ran out' + (reset ? ' — provider reported a reset in ' + reset : '') +
             '. Not a bug.';
    }
  }
  return '';
}

// The relay and the native hooks record an account failure in the row's own note, in the
// provider's words, behind one of two exact prefixes. Usage that ran out is said as that.
// An account the provider refused is said as that and nothing more: its text does not say
// whether the sign-in or the plan is at fault, and a guess here once sent the owner to
// renew a subscription that was not the problem (2026-11-15).
function quotaFromNote(job) {
  const note = job.state === 'failed' ? job.note : '';
  let m = /^Subscription\/quota ran out: (.+)$/.exec(note);
  if (m) return 'The subscription or quota ran out. The provider said: “' + m[1] + '”';
  m = /^Account refused \(sign-in or plan\): (.+)$/.exec(note);
  return m ? 'The provider refused this account. Check the sign-in or the plan. It said: “' + m[1] + '”' : '';
}

function readStepTimes(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  return raw.split('\n')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n))
    .slice(-12);
}

// Exponential moving average of seconds-per-step. alpha 0.3, most recent weighted highest.
// Needs >= 2 intervals (3 timestamps) before it is trustworthy enough to show.
function emaSecondsPerStep(stepTimes) {
  if (!stepTimes || stepTimes.length < 3) return null;
  const deltas = [];
  for (let i = 1; i < stepTimes.length; i++) {
    const d = stepTimes[i] - stepTimes[i - 1];
    if (d >= 0 && d < 86400) deltas.push(d);
  }
  if (deltas.length < 2) return null;
  let ema = deltas[0];
  for (let i = 1; i < deltas.length; i++) ema = 0.3 * deltas[i] + 0.7 * ema;
  return ema > 0 ? ema : null;
}

// The median gap between a job's own timestamps — its demonstrated rhythm. Median, not
// average, so one long pause does not drag the whole picture.
function medianGap(times) {
  if (!times || times.length < 3) return 0;
  const d = [];
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap < 86400) d.push(gap);
  }
  if (d.length < 2) return 0;
  d.sort((a, b) => a - b);
  const mid = Math.floor(d.length / 2);
  return d.length % 2 ? d[mid] : Math.round((d[mid - 1] + d[mid]) / 2);
}

// How long silence is allowed before it means anything.
//
// The old rule was a flat 180 seconds for everything, and it was wrong in principle: it
// called a healthy job "not responding" for the crime of working on one long step. Silence
// is only evidence when you know what the job PROMISED. So a verdict now requires a rhythm
// that is either declared (`--beat-every N`) or demonstrated (its own beats, or its own
// step timestamps). A job that has shown neither gets NO silence verdict at all — just a
// long backstop so genuinely abandoned work still gets archived instead of living forever.
function windowsFor(job, o) {
  // The most explicit promise a job can make about its own silence wins outright.
  const bound = Number(job.maxsilence) > 0 ? Number(job.maxsilence) : 0;
  if (bound) return { quiet: bound, dead: Math.max(3 * bound, bound + 600) };

  const declared = Number(job.every) > 0 ? Number(job.every) : 0;
  if (declared) return { quiet: Math.max(3 * declared, 120), dead: Math.max(10 * declared, 600) };

  // Demonstrated by heartbeats: the writer keeps a running average of its own beat gap.
  const beatGap = Number(job.beats) >= 3 && Number(job.seen) > 0 ? Number(job.seen) : 0;
  if (beatGap) return { quiet: Math.max(4 * beatGap, 300), dead: Math.max(12 * beatGap, 1800) };

  // Demonstrated by completed steps.
  const stepGap = medianGap(job.stepTimes);
  if (stepGap) return { quiet: Math.max(4 * stepGap, 600), dead: Math.max(12 * stepGap, 2700) };

  return { quiet: Infinity, dead: o.unknownDeadAfter || 7200 };
}

function decorate(job, now, opts) {
  const o = opts || {};

  const heartbeat = Number(job.beat) || Number(job.started) || now;
  const watchAt = Number(job.watchAt) || 0;
  // Freshest sign of life: the later of "I am alive" and "this output just changed". Capped
  // at now, so a file with a clock-skewed future timestamp cannot buy a job immortality.
  const beat = Math.min(now, Math.max(heartbeat, watchAt));
  const liveByFile = watchAt > heartbeat && watchAt <= now;
  const started = Number(job.started) || heartbeat;
  const step = Number(job.step) || 0;
  const total = Number(job.total) > 0 ? Number(job.total) : null;

  let status = String(job.state || 'running').toLowerCase();
  if (!['running', 'done', 'failed'].includes(status)) status = 'running';
  const beatAge = Math.max(0, now - beat);
  const win = windowsFor(job, o);
  if (Number.isFinite(win.quiet) && Number.isFinite(o.stallAfter) && o.stallAfter >= 0) win.quiet = Math.max(win.quiet, o.stallAfter);

  // Silence is graded, not binary. A machine that just woke from sleep gets one full
  // window before any silence counts against a job (o.graceUntil).
  const graced = o.graceUntil && now < o.graceUntil;
  if (status === 'running' && !graced) {
    if (beatAge > win.dead) status = 'dead';
    else if (beatAge > win.quiet) status = 'quiet';
  }

  // A percentage needs a denominator the job itself declared. A finished chat used to be
  // drawn as "Finished 100% Took 5h 05m" — the 100% was invented here, out of nothing but
  // the fact that it had stopped, and it told the owner nothing. No total, no number.
  const pct = total ? Math.max(0, Math.min(100, Math.round((step / total) * 100))) : null;

  // The plan as a denominator — design rule: a live percentage is wanted on long
  // work, and the checklist is the only denominator a chat ever states. The reviewers'
  // 2026-08-15 objection (the model reorders, adds and reopens items) is real, so this
  // travels SEPARATELY from pct, the panel shows the "N of M tasks" fraction beside it,
  // and the number may honestly move backwards when the plan grows. A declared --total
  // still outranks it everywhere.
  const planCount = Array.isArray(job.tasks) ? job.tasks.length : 0;
  const planDone = planCount ? job.tasks.filter(t => t && t.done).length : 0;
  const planPct = planCount ? Math.round((planDone / planCount) * 100) : null;

  // ETA: EMA per step first, plain average as fallback, never for unknown totals.
  let etaSec = null;
  if (total && step > 0 && step < total && status === 'running') {
    const ema = emaSecondsPerStep(job.stepTimes);
    const per = ema !== null ? ema : ((now - started) / step);
    if (per > 0 && Number.isFinite(per)) etaSec = Math.round(per * (total - step));
  }

  return {
    id: job.id,
    agent: agentOf(job.agent),
    // Who set this going, when that is not who does the work. The row wears the WORKER's
    // logo — a Codex review is Codex's work even though a Claude chat started it — and the
    // driver shows only as a soft glow around that logo.
    driver: Object.hasOwn(AGENTS, String(job.driver || '').toLowerCase()) && agentOf(job.driver) !== agentOf(job.agent) ? agentOf(job.driver) : '',
    title: job.title || job.id,
    // Sample rows must be self-evidently fake in the UI — a title alone reads as real work.
    demo: job.demo === true || String(job.id).indexOf('demo-') === 0,
    note: job.note || '',
    status,
    step, total, pct, etaSec,
    beatAge,
    // A finished job's clock stops at its last WRITE, not at a file that changed afterwards.
    elapsed: Math.max(0, (status === 'done' || status === 'failed' ? heartbeat : now) - started),
    // The file that vouched for it, named only when the file is what proves it alive.
    watching: liveByFile ? path.basename(String(job.watch)) : '',
    started, beat,
    pid: Number(job.pid) || null,
    cwd: job.cwd || '',
    by: job.by || '',
    cadence: Number(job.every) || 0,
    // The silence windows this job is actually being judged against. Published so the
    // extension can schedule its one timer off them instead of re-deriving the law and
    // drifting out of step with it.
    quietAfter: win.quiet,
    deadAfter: win.dead,
    // How long the CURRENT step has been going. A fresh heartbeat with an unchanged step
    // means slow, not dead — this is the number that says so.
    stepAge: job.stepTimes && job.stepTimes.length
      ? Math.max(0, now - job.stepTimes[job.stepTimes.length - 1]) : null,
    // What it did, what it planned, and what it last printed. All three are past tense by
    // construction: the hook writes them only after the work is over.
    trail: Array.isArray(job.trail) ? job.trail : [],
    tasks: Array.isArray(job.tasks) ? job.tasks : [],
    tasksAt: Number(job.tasksAt) || 0,
    lastOut: job.lastOut || '',
    quota: job.quotaOut || '',
    planDone, planCount, planPct,
    // A row with either denominator gets a bar; one with neither shows time, not a number.
    indeterminate: !total && !planCount,
    // Whether this job streams to a watched output file. The extension uses it to keep
    // "Latest output" fresh while the panel is visible — job JSON events alone come only
    // from the hook, so a consult's output otherwise went stale between tool calls
    // (Codex review, 2026-08-31).
    watched: !!job.watch,
  };
}

const RANK = { dead: 0, quiet: 1, failed: 2, running: 3, done: 4 };

function buildView(dir, now, opts) {
  const o = opts || {};
  const hideDoneAfter = o.hideDoneAfter ?? 600;
  const rows = readJobs(dir)
    .map(j => decorate(j, now, o))
    .filter(r => !((r.status === 'done' || r.status === 'failed') && r.beatAge > hideDoneAfter))
    .sort((a, b) => (RANK[a.status] - RANK[b.status]) || (b.beat - a.beat));

  const running = rows.filter(r => r.status === 'running').length;
  const stalled = rows.filter(r => r.status === 'quiet').length;
  const dead    = rows.filter(r => r.status === 'dead').length;
  const failed  = rows.filter(r => r.status === 'failed').length;

  // Overall bar = only the jobs that actually have a denominator — declared total OR the
  // plan (both crews flagged that leaving planPct out blanked the header % for exactly
  // the chat rows the 2026-08-31 order was about).
  const measured = rows.filter(r => (r.pct !== null || r.planPct !== null) &&
                                    r.status !== 'done' && r.status !== 'failed');
  const overallPct = measured.length
    ? Math.round(measured.reduce((s, r) => s + (r.pct !== null ? r.pct : r.planPct), 0)
                 / measured.length) : null;
  const etas = rows.map(r => r.etaSec).filter(n => Number.isFinite(n));
  const worstEta = etas.length ? Math.max.apply(null, etas) : null;

  // Jobs the panel has judged dead. The extension archives these itself, so the owner
  // never has to clear anything by hand.
  const reapable = rows.filter(r => r.status === 'dead').map(r => r.id);

  return { rows, running, stalled, dead, failed, reapable, drivers: driversOf(rows),
           active: running + stalled, overallPct, worstEta };
}

// Who launched the work, counted once for the whole panel.
//
// This is the ONLY place the driver is stated. It used to be drawn on every row — a halo,
// then a second logo — and the owner's verdict after seeing it was that a few days of use
// would turn the panel into a crowd of small marks. Grouping the rows by driver was the
// next idea and was rejected by three independent reviews for a better reason: the list is
// sorted problems-first, and splitting it into per-driver blocks buries a stuck job under
// somebody else's healthy ones.
function driversOf(rows) {
  const count = new Map();
  for (const r of rows) {
    if (!r.driver) continue;
    count.set(r.driver, (count.get(r.driver) || 0) + 1);
  }
  return Array.from(count.entries())
    .map(([agent, jobs]) => ({ agent, jobs }))
    .sort((a, b) => (b.jobs - a.jobs) || a.agent.localeCompare(b.agent));
}

// An unknown duration prints as nothing at all. It used to return an em dash, which is
// exactly the placeholder junk this panel refuses: the caller drops the whole field instead.
function formatDur(sec) {
  if (!Number.isFinite(sec)) return '';
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

module.exports = { DEFAULT_DIR, AGENTS, agentOf, readJobs, emaSecondsPerStep,
                   decorate, buildView, driversOf, formatDur };
