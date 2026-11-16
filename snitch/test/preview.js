'use strict';
// Generates a preview that runs the SHIPPING client (media/app.js) against a real payload,
// with the VS Code API stubbed. What you look at here is what the panel does — the earlier
// preview rendered its own HTML and could disagree with the panel; this one cannot.
//   node test/preview.js <outdir>
const fs = require('fs');
const retire = require('./retire');
const os = require('os');
const path = require('path');
const m = require('../extension/lib/model');
const { renderShell } = require('../extension/lib/render');
const { buildPayload } = require('../extension/lib/payload');

const out = process.argv[2] || path.join(os.tmpdir(), 'snitch-preview');
fs.mkdirSync(out, { recursive: true });

const now = Math.floor(Date.now() / 1000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetfix-'));
const put = (j, stepTimes) => {
  fs.writeFileSync(path.join(dir, j.id + '.json'), JSON.stringify(j));
  if (stepTimes) fs.writeFileSync(path.join(dir, j.id + '.steps'), stepTimes.join('\n'));
};

// A realistic night: two fleets moving, one consult with no known total, one gone quiet,
// one finished, one crashed.
put({ id: 'letters', agent: 'claude', title: 'letters fleet', state: 'running',
      step: 18, total: 25, started: now - 5400, beat: now - 3, note: 'letter R', every: 30 },
    [now - 1200, now - 900, now - 600, now - 300, now - 3]);
put({ id: 'gate', agent: 'codex', title: 'gate audit', state: 'running',
      step: 2, total: 5, started: now - 420, beat: now - 11, note: 'containment check' },
    [now - 300, now - 160, now - 11]);
put({ id: 'chat', agent: 'claude', title: 'Example Project', state: 'running',
      step: 0, started: now - 260, beat: now - 4, note: 'working',
      cwd: '/tmp/example-projects/Example Project' });
put({ id: 'review', agent: 'agy', driver: 'claude', title: 'engine review', state: 'running',
      step: 3, started: now - 700, beat: now - 22, note: 'reading v5_painter.dart' });
put({ id: 'read', agent: 'kimi', driver: 'claude', title: 'long-context read', state: 'running',
      step: 1, total: 3, started: now - 900, beat: now - 412, note: 'waiting on output' });
put({ id: 'tests', agent: 'shell', title: 'flutter test', state: 'done',
      step: 558, total: 558, started: now - 900, beat: now - 120, note: '558 passed' });

const view = m.buildView(dir, now, { stallAfter: 180, deadAfter: 900, hideDoneAfter: 600 });
view.rows.forEach(r => { if (r.id === 'chat') r.expanded = true; });
const payload = buildPayload(view);

// Stub just enough of the webview host for app.js to run unmodified.
const client = fs.readFileSync(path.join(__dirname, '..', 'extension', 'media', 'app.js'), 'utf8');
const boot = `
  var __sent = [];
  function acquireVsCodeApi(){ return { postMessage: function(m){ __sent.push(m); } }; }
  ${client}
  window.postMessage({ type: 'state', payload: ${JSON.stringify(payload)} }, '*');
`;

fs.writeFileSync(path.join(out, 'panel.html'),
  renderShell({ standalone: true, nonce: 'preview', inlineScript: boot }));
fs.writeFileSync(path.join(out, 'panel-empty.html'),
  renderShell({ standalone: true, nonce: 'preview', inlineScript: `
    var __sent = [];
    function acquireVsCodeApi(){ return { postMessage: function(){} }; }
    ${client}
    window.postMessage({ type: 'state', payload: ${JSON.stringify(
      { rows: [], running: 0, quiet: 0, failed: 0, worstEta: null, empty: true })} }, '*');
  ` }));

retire(dir, { recursive: true, force: true });
console.log('rows in payload:', payload.rows.length, '->', path.join(out, 'panel.html'));
