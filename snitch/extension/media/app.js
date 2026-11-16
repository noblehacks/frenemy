'use strict';
// Snitch webview client. Runs inside the panel with a CSP nonce; no network, no imports.
//
// It does exactly three things:
//   1. keeps one DOM element per job, patching it in place (so the bar can animate)
//   2. re-labels the time-relative text once a second — from epochs it already has, so a
//      "14s ago" counting up costs no extension work and no file reads at all
//   3. sends clicks back to the extension
//
// It NEVER decides whether a job is late, stuck or dead: that judgement is the extension's,
// arrives in the payload, and is only displayed here.
(function () {
  var vscode = acquireVsCodeApi();
  var app = document.getElementById('app');
  var head = document.getElementById('head');
  var state = { rows: [], running: 0, quiet: 0, failed: 0, empty: true };
  var nodes = Object.create(null);   // job id -> row element
  var tick = null;

  function dur(sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return '';
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + 's';
    var m = Math.floor(sec / 60);
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }

  function now() { return Date.now() / 1000; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // A detail line that holds several items rather than one value. Built as a real list so a
  // long plan wraps and scrolls like text instead of being crushed into one line.
  function listOf(items, classes) {
    var ul = document.createElement('ul');
    ul.className = 'lines';
    for (var i = 0; i < items.length; i++) {
      ul.appendChild(el('li', (classes && classes[i]) || null, items[i]));
    }
    return ul;
  }

  function clock(epoch) {
    var d = new Date(epoch * 1000);
    var h = d.getHours(), ampm = h < 12 ? 'AM' : 'PM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ampm;
  }

  // Notes a job writes about itself that carry no information for a reader. Treating them
  // as absent avoids sentences like "Working on working".
  var EMPTY_NOTES = { working: 1, idle: 1, running: 1, busy: 1, finished: 1, done: 1, ok: 1, '': 1 };
  function note(r) {
    var n = (r.note || '').trim();
    if (EMPTY_NOTES[n.toLowerCase()]) return '';
    // Legacy filler from the old hook, still on rows written before 2026-08-31. It sat on
    // every consult for its whole life and answered nothing — treated as absent.
    if (/^running in the background$/i.test(n)) return '';
    // An exit code is the machine talking to itself. "gen exit 0" only means it finished,
    // which the row already says in words; a bad code is covered by the problem wording.
    if (/\bexit\s+-?\d+$/i.test(n)) return '';
    return n;
  }

  // A note is written by whoever started the job, so it can be a fragment ("letter R") or
  // already a whole phrase ("builder on band clips"). Prefixing the second kind produced
  // "Working on builder on band clips", so a note that already reads as a phrase is left
  // alone and only capitalised.
  function phrase(r) {
    var n = note(r);
    if (!n) return '';
    if (n.length > 24 || n.indexOf(',') !== -1 ||
        /\s(on|for|in|of|through|at)\s/i.test(n) || /^\w+ing\s/i.test(n))
      return n.charAt(0).toUpperCase() + n.slice(1);
    return 'Working on ' + n;
  }

  // An action the hook recorded AFTER the tool finished, so it is always phrased in the past
  // tense and never claims to be live. Repeats collapse only on an exact match — "Read
  // model.js x4" — because a count of actions is not a count of distinct files.
  function actionText(a) {
    if (!a || !a.text) return '';
    return a.times > 1 ? a.text + ' ×' + a.times : a.text;
  }

  // ---- what each row says -------------------------------------------------
  // Plain sentences, no jargon, and never a placeholder: a value we do not have is a
  // field that is not printed.
  function statusText(r) {
    if (r.status === 'dead')
      return 'Stopped on its own, nothing more will happen';
    if (r.status === 'quiet')
      return 'Still going, but no sign of progress for ' + dur(now() - r.beat);
    // The reason first, the verdict second: "stopped with code 1" is the machine talking
    // to itself, while the job's last printed line is usually the actual why (Codex, 2026-08-31).
    if (r.status === 'failed') {
      // A proven quota death outranks everything: "the subscription ran out" is the
      // answer, not the exit code.
      if (r.quota) return r.quota;
      return r.lastOut ? '“' + r.lastOut + '”' : (note(r) || 'Stopped with a problem');
    }
    // The right-hand column already says "Finished". Repeating it here is noise, so a
    // finished job only speaks up when it has something to add.
    if (r.status === 'done')   return note(r);
    // What it last did beats any standing note: "Working" for 44 minutes told the owner
    // nothing, and this line is the whole reason the panel exists.
    if (actionText(r.lastAction)) return actionText(r.lastAction);
    // A background job leaves no trail, but its output file is its own voice — the last
    // line it printed is what is actually going on, live. ("Running in the background"
    // frozen on a consult row was his 2026-08-31 complaint.)
    if (r.lastOut) return '“' + r.lastOut + '”';
    if (r.stepAge !== null && r.total && r.stepAge > 120)
      return (note(r) ? phrase(r) : 'This step') + ', ' +
             dur(r.stepAge + (now() - r.beat)) + ' so far';
    // No note, but a file it named is still changing: that IS the news.
    if (!note(r) && r.watching) return 'Writing ' + r.watching;
    return note(r) ? phrase(r) : 'Working';
  }

  // One tiny paragraph in plain words — his 2026-08-31 order: "explain it like a third
  // grader: this is what I'm doing, this is who initiated it, this is what's going on."
  // Built only from facts already on the row; nothing here is invented.
  function storyText(r) {
    var s = [];
    // Every opener is tense-neutral on purpose: "is running" over a finished row was one
    // of Codex's catches (2026-08-31).
    if (r.driverLabel)
      s.push(r.driverLabel + ' asked ' + r.brandLabel + ' to do this: “' + r.title + '”.');
    else if (r.id && r.id.indexOf('bg-') === 0)
      s.push('This is ' + r.brandLabel + '’s job: “' + r.title + '”.');
    else if (r.agent === 'claude')
      s.push('This is Claude working with you in this chat.');
    else if (r.agent !== 'shell')
      s.push('This is ' + r.brandLabel + '’s work on “' + r.title + '”.');
    else
      s.push('This is a job on your computer: “' + r.title + '”.');
    if (r.status === 'running') {
      s.push('Started at ' + clock(r.started) + '. The latest activity was ' +
             dur(now() - r.beat) + ' ago.');
      if (r.planCount)
        s.push('The plan has ' + r.planCount + (r.planCount === 1 ? ' step' : ' steps') +
               ' and ' + r.planDone + (r.planDone === 1 ? ' is' : ' are') + ' finished.');
    } else if (r.status === 'done') {
      s.push('It finished in ' + dur(r.finalElapsed) + '.');
    } else if (r.status === 'failed') {
      if (r.quota) s.push('It stopped because ' + r.quota.charAt(0).toLowerCase() + r.quota.slice(1));
      else s.push('It hit a problem and stopped.' +
             (r.lastOut ? ' Its last words are under “Latest output” below.' : ''));
    } else if (r.status === 'quiet') {
      s.push('It has made no sound for ' + dur(now() - r.beat) + ' — it might be stuck.');
    } else if (r.status === 'dead') {
      s.push('It went silent for so long that it is considered gone.');
    }
    return s.join(' ');
  }

  function rightText(r) {
    if (r.status === 'done')   return 'Finished';
    if (r.status === 'failed') return 'Problem';
    if (r.status === 'dead')   return 'Stopped';
    if (r.status === 'quiet')  return 'No response';
    return dur(now() - r.beat) + ' ago';
  }

  // Stats a non-technical reader can act on. A step count with no total tells him nothing,
  // so an open-ended job reports how long it has been going instead.
  function statsText(r) {
    var bits = [];
    // A declared total wins; the model's own checklist is the fallback denominator (his
    // 2026-08-31 order). The fraction rides beside the number so it never reads as more
    // than it is: "40% · 2 of 5 tasks".
    if (r.pct !== null && r.pct !== undefined) bits.push(r.pct + '%');
    else if (r.planPct !== null && r.planPct !== undefined) bits.push(r.planPct + '%');
    if (r.total) bits.push(r.step + ' of ' + r.total);
    else if (r.planCount) bits.push(r.planDone + ' of ' + r.planCount + ' tasks');
    if (r.finalElapsed !== null) bits.push('Done in ' + dur(r.finalElapsed));
    else if (r.etaSec !== null && r.etaSec !== undefined)
      bits.push('about ' + dur(r.etaSec) + ' left');
    // A row already marked quiet or gone must not also claim to be "Running" — the word
    // beside a "No response" badge was a contradiction (Kimi, 2026-08-31).
    else if (r.status === 'quiet' || r.status === 'dead')
      bits.push(dur(now() - r.started) + ' so far');
    else bits.push('Started ' + dur(now() - r.started) + ' ago');
    return bits;
  }

  // One writer for the stats line. It used to be written twice — paint() rebuilt it and
  // relabel() overwrote existing spans by index, so when a stat appeared or disappeared
  // (an ETA arriving, say) the line kept a ghost of the old one. agy caught this.
  function setStats(node, r) {
    var box = node.querySelector('.stats');
    if (!box) return;
    var bits = statsText(r);
    box.textContent = '';
    for (var i = 0; i < bits.length; i++) {
      box.appendChild(el('span', i === 0 && bits[i].slice(-1) === '%' ? 'pct' : null, bits[i]));
    }
  }

  // A row that cannot draw itself says so. Leaving the old text up is the one outcome all
  // three reviewers called unacceptable: it is believable and wrong.
  var reported = Object.create(null);
  function showRowError(node, r, err) {
    node.className = 'row r-' + r.status + ' row-error';
    var sub = node.querySelector('.sub');
    if (sub) sub.textContent = 'Display problem — this row may be out of date';
    var msg = String((err && err.message) || err);
    if (reported[r.id] === msg) return;          // once per row per distinct fault, never per tick
    reported[r.id] = msg;
    vscode.postMessage({ type: 'clientError', id: r.id, message: msg });
  }

  // ---- building and patching ---------------------------------------------
  function build(r) {
    var row = el('div', 'row');
    var link = el('a', 'hit');
    link.href = '#';
    link.addEventListener('click', function (e) {
      e.preventDefault();
      vscode.postMessage({ type: 'toggle', id: r.id });
    });

    var chip = el('span', 'chip');
    chip.innerHTML = r.mark;                       // extension-authored, static brand path
    chip.appendChild(el('i', null, r.brandLabel));

    var mid = el('span', 'mid');
    var titleLine = el('span', 'titleline');
    titleLine.appendChild(el('b', 'name'));
    titleLine.appendChild(el('em', 'sub'));
    var track = el('span', 'track');
    track.appendChild(el('span', 'fill'));
    var stats = el('span', 'stats');
    mid.appendChild(titleLine);
    mid.appendChild(track);
    mid.appendChild(stats);

    link.appendChild(chip);
    link.appendChild(mid);
    link.appendChild(el('span', 'beat'));
    row.appendChild(link);
    // No .detail element is created here. It exists only while the row is open, so a
    // half-drawn one can never sit on screen as an empty box.
    return row;
  }

  function paint(row, r) {
    row.className = 'row r-' + r.status + (r.expanded ? ' open' : '');
    var chip = row.querySelector('.chip');
    chip.style.color = r.bar;
    chip.querySelector('i').textContent = r.brandLabel;
    // The row carries the WORKER's logo and nothing else. Who launched it is said once at
    // the top of the panel, and in full inside this row's detail block when it is opened.

    row.querySelector('.sub').textContent = statusText(r);

    var track = row.querySelector('.track');
    var fill = row.querySelector('.fill');
    track.style.display = r.indeterminate ? 'none' : '';
    if (!r.indeterminate) {
      // The width only ever comes from a step the job actually reached — a declared total
      // first, the model's own ticked checklist otherwise. The CSS transition animates
      // INTO that value; it never runs ahead of it.
      var w = r.pct !== null && r.pct !== undefined ? r.pct : (r.planPct || 0);
      fill.style.width = w + '%';
      fill.style.background = (r.status === 'quiet' || r.status === 'dead' || r.status === 'failed')
        ? 'var(--warn)' : r.bar;
    }

    setStats(row, r);

    var beat = row.querySelector('.beat');
    beat.className = 'beat ' + (r.status === 'running' ? 'live'
      : (r.status === 'done' ? 'ok' : 'bad'));
    beat.textContent = rightText(r);

    var name = row.querySelector('.name');
    name.textContent = '';
    // Sample rows must never be mistakable for real work.
    if (r.demo) name.appendChild(el('b', 'demo', 'SAMPLE'));
    name.appendChild(document.createTextNode(r.title));

    // The detail block holds NO state of its own: it is created when the row is open,
    // removed when it is closed, and its contents are rebuilt from the payload every time.
    // The bug that froze the panel came from caching "already built" on the element itself;
    // Codex, agy and Kimi independently named the same invariant — the DOM is never the
    // authority for whether derived content exists.
    var detail = row.querySelector('.detail');
    if (!r.expanded) { if (detail) row.removeChild(detail); return; }
    if (!detail) { detail = el('div', 'detail'); row.appendChild(detail); }
    detail.textContent = '';

    // The plain-words paragraph leads; the labelled facts below it carry the specifics.
    detail.appendChild(el('p', 'story', storyText(r)));

    // What this block answers, in his words: "what's been done, what's remaining". Every
    // line is past tense and carries its own age, because this hook fires AFTER each tool
    // call — a field claiming live work would be false during the model's thinking gaps.
    var facts = [];
    if (r.lastAction)
      facts.push(['Last action',
                  actionText(r.lastAction) + ' · ' + dur(now() - r.lastAction.at) + ' ago']);
    // Only when it adds something. The closed row already prints the note as its own line,
    // and repeating it two lines lower is the placeholder junk this panel refuses to show.
    else if (note(r) && note(r) !== statusText(r)) facts.push(['Last note', note(r)]);
    if (r.trail && r.trail.length) facts.push(['Before that', listOf(r.trail.map(function (a) {
      return actionText(a) + '  ' + clock(a.at);
    }))]);
    // The plan as the model last wrote it — ticked and unticked, with no count and no
    // percentage. It is intention, not measurement: it gets reordered, added to and
    // reopened, so any number derived from it would be a confident lie.
    if (r.tasks && r.tasks.length) {
      facts.push(['Plan, as of ' + clock(r.tasksAt), listOf(r.tasks.map(function (t) {
        return (t.done ? '✓ ' : (t.active ? '▸ ' : '·  ')) + t.text;
      }), r.tasks.map(function (t) { return t.done ? 'done' : (t.active ? 'active' : ''); }))]);
    }
    // Where a failure's reason has always been sitting: "stopped with code 1" arrived for
    // months with the real message unread in the job's own output file.
    if (r.lastOut) facts.push(['Latest output', r.lastOut]);
    facts.push(['Started', clock(r.started)]);
    if (r.driverLabel) facts.push(['Launched by', r.driverLabel]);
    if (r.watching) facts.push(['Writing to', r.watching]);
    // A wall-clock finish reads better than a countdown for someone who just wants to
    // know whether to wait. Only shown when the estimate is real.
    if (r.etaSec !== null && r.etaSec !== undefined && r.status === 'running')
      facts.push(['Should finish', 'about ' + clock(now() + r.etaSec)]);
    if (r.folder) facts.push(['Project', r.folder.split('/').pop()]);

    var dl = el('dl');
    for (var j = 0; j < facts.length; j++) {
      dl.appendChild(el('dt', null, facts[j][0]));
      var dd = el('dd');
      // A value is either a string or a built list; both arrive as data from paint(), never
      // as markup, so nothing here is ever assigned through innerHTML.
      if (facts[j][1] && facts[j][1].nodeType) dd.appendChild(facts[j][1]);
      else dd.textContent = facts[j][1];
      dl.appendChild(dd);
    }
    detail.appendChild(dl);

    var btn = el('a', 'btn', 'Remove this row');
    btn.href = '#';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      vscode.postMessage({ type: 'clearOne', id: r.id });
    });
    detail.appendChild(btn);
  }

  // A brand hex at a given transparency. The driver line's light is built here rather than
  // in the stylesheet because the colour belongs to whoever is driving, which CSS cannot know.
  function rgba(hex, a) {
    var n = parseInt(String(hex || '#888888').slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // The driver line. One line, whatever the number of jobs: the word DRIVER, then a lit chip
  // per agent that launched something, with a job count each when more than one did. It
  // disappears entirely when nothing on screen was launched by another agent — the common
  // case, and the reason this is a line and not a permanent header.
  //
  // Two looks, flipped by clicking the line: the chip alone, or the chip with a bar of its
  // own colour beneath it. Both keep every colour inside its own chip's box. A wash across
  // the whole line was tried and rejected — the line divides its WIDTH evenly while names
  // end wherever they end, so one agent's colour sat under another agent's name.
  //
  // At four drivers the counts drop rather than the word: at a narrow dock both cannot fit,
  // and the word is what makes the line readable at a glance. No count is lost — every row
  // underneath still carries its own.
  function setDrivers(list, style) {
    var box = document.getElementById('drvline');
    if (!box) return;
    box.textContent = '';
    if (!list || !list.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    var n = list.length;
    box.className = 'drvline' + (n >= 4 ? ' n4' : n === 3 ? ' n3' : '')
                  + (style === 'underline' ? ' under' : '');
    box.title = 'Click to switch the driver look';
    box.appendChild(el('span', 'lab', 'FROM'));
    var cells = el('span', 'cells');
    for (var i = 0; i < n; i++) {
      var d = list[i];
      var cl = el('span', 'cl');
      if (style === 'underline') cl.style.boxShadow = 'inset 0 -2px 0 ' + rgba(d.bar, 0.85);
      var pill = el('span', 'pill');
      pill.style.borderColor = rgba(d.bar, 0.45);
      pill.style.background = rgba(d.bar, 0.084);
      pill.style.boxShadow = '0 0 6px ' + rgba(d.bar, 0.23)
                           + ', inset 0 0 8px ' + rgba(d.bar, 0.072);
      pill.innerHTML = d.mark;                     // extension-authored, static brand path
      pill.appendChild(document.createTextNode(d.label));
      if (n > 1 && n < 4) pill.appendChild(el('em', null, String(d.jobs)));
      cl.appendChild(pill);
      cells.appendChild(cl);
    }
    box.appendChild(cells);
  }

  function render() {
    var seen = Object.create(null);
    for (var i = 0; i < state.rows.length; i++) {
      var r = state.rows[i];
      seen[r.id] = true;
      var node = nodes[r.id];
      if (!node) { node = nodes[r.id] = build(r); app.appendChild(node); }
      // One row that cannot draw itself must never take the panel down with it. Before
      // this, a single throw in paint() left every other row frozen on stale text and the
      // summary line stuck — the panel looked alive and was lying.
      try { paint(node, r); }
      catch (err) { showRowError(node, r, err); }
      if (app.children[i] !== node) app.insertBefore(node, app.children[i] || null);
    }
    for (var id in nodes) {
      if (!seen[id]) { app.removeChild(nodes[id]); delete nodes[id]; }
    }

    var bits = [];
    if (state.running) bits.push(state.running + (state.running === 1 ? ' job running' : ' jobs running'));
    if (state.quiet)   bits.push(state.quiet + ' not responding');
    if (state.failed)  bits.push(state.failed + ' with problems');
    if (state.worstEta !== null && state.worstEta !== undefined)
      bits.push('about ' + dur(state.worstEta) + ' left');
    // Separated by spacing, not punctuation — no middots, no dashes.
    setDrivers(state.drivers, state.driverStyle);

    var bitsBox = head.querySelector('.bits');
    bitsBox.textContent = '';
    for (var b = 0; b < bits.length; b++) bitsBox.appendChild(el('span', null, bits[b]));
    head.style.display = state.empty ? 'none' : '';
    document.getElementById('empty').style.display = state.empty ? '' : 'none';
    schedule();
  }

  // One timer, only while something is live AND the page is visible. A hidden webview is
  // torn down by VS Code, so this cannot tick in the background.
  function schedule() {
    var live = state.rows.some(function (r) { return r.status === 'running' || r.status === 'quiet'; });
    if (live && !tick) tick = setInterval(relabel, 1000);
    if (!live && tick) { clearInterval(tick); tick = null; }
  }

  // Cheap pass: only the words that depend on the clock, no rebuilding, no layout thrash.
  function relabel() {
    for (var i = 0; i < state.rows.length; i++) {
      var r = state.rows[i], node = nodes[r.id];
      if (!node) continue;
      // Each row is protected here too. render() was guarded first; a throw on this path
      // would have skipped every later row's clock without anyone noticing.
      try {
        node.querySelector('.beat').textContent = rightText(r);
        node.querySelector('.sub').textContent = statusText(r);
        setStats(node, r);
        // An open detail block holds clock-relative values too, so it is rebuilt whole.
        if (r.expanded) paint(node, r);
      } catch (err) { showRowError(node, r, err); }
    }
  }

  function wire(id, type) {
    var n = document.getElementById(id);
    if (n) n.addEventListener('click', function (e) {
      e.preventDefault();
      vscode.postMessage({ type: type });
    });
  }
  wire('clearFinished', 'clearFinished');
  wire('clearAll', 'clearAll');
  // Clicking the driver line flips between the two looks. The extension stores the choice
  // in its own setting, so it survives a reload and a new window.
  wire('drvline', 'driverStyle');

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'state') return;
    // Snapshots are numbered. An older one arriving late must never overwrite a newer one —
    // that would put believable, stale information on screen, which is the whole sin here.
    if (e.data.payload && state.rev && e.data.payload.rev < state.rev) return;
    state = e.data.payload;
    // "Clear finished" only exists when there is something finished to clear.
    var anyDone = state.rows.some(function (r) {
      return r.status === 'done' || r.status === 'failed';
    });
    document.getElementById('clearFinished').style.display = anyDone ? '' : 'none';
    render();
  });

  vscode.postMessage({ type: 'ready' });
}());
