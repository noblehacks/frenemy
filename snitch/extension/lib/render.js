'use strict';
// The panel's page: styles + an empty skeleton. Rows are built and patched by
// media/app.js from data the extension posts, so elements persist between updates and the
// progress bar can animate into a value the job has actually reached.
//
// Nothing here interpolates progress. The bar's width is always a step the job reported;
// the CSS transition only animates the trip to that number, it never runs ahead of it.
const fs = require('fs');
const path = require('path');
const { DEFS } = require('./brands');

const CSS_FILE = path.join(__dirname, '..', 'media', 'panel.css');

// Read from disk on every render, never at require() time. The extension host caches this
// module, so a stylesheet baked into it needed a full window reload before any change showed
// — the panel could sit there wearing yesterday's CSS while the file on disk said otherwise.
// Inlined rather than <link>ed on purpose: the page's CSP allows inline styles but no
// external stylesheet, and widening the CSP to load one buys nothing here.
function styles() {
  try { return fs.readFileSync(CSS_FILE, 'utf8'); }
  catch (e) { return 'body{font:12px sans-serif;padding:12px}'; }  // never ship a blank panel
}

const EMPTY_HTML = `<div class="empty" id="empty">
    <p>Nothing running right now.</p>
    <p class="dim">Long jobs show up here on their own — renders, test runs,
       and anything handed to Claude, Codex, Gemini or Kimi.</p>
  </div>`;

// The live page. `script` is either a webview URI (extension) or the file's own source
// inlined (preview), so both paths run the SAME client code.
function renderShell(opts) {
  const o = opts || {};
  const nonce = o.nonce || 'preview';
  // Nothing loads from anywhere: styles are inlined, the one script is nonce-gated.
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const scriptTag = o.scriptUri
    ? `<script nonce="${nonce}" src="${o.scriptUri}"></script>`
    : `<script nonce="${nonce}">${o.inlineScript || ''}</script>`;

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${styles()}</style></head>
<body>${DEFS}
  <div class="drvline" id="drvline" style="display:none"></div>
  <div class="head" id="head" style="display:none">
    <span class="bits"></span>
    <span class="acts">
      <a class="btn" id="clearFinished">Clear finished</a>
      <a class="btn" id="clearAll">Clear all</a>
    </span>
  </div>
  ${EMPTY_HTML}
  <div id="app"></div>
${scriptTag}
</body></html>`;
}

module.exports = { renderShell, styles };
