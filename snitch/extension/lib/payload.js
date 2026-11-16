'use strict';
// Turns the model's view into the flat, JSON-safe shape the webview renders.
//
// Why this exists: the panel used to rebuild its whole HTML once a second. That threw away
// every DOM element, so a progress bar could never animate (a replaced element has nothing
// to animate FROM) and the editor re-parsed a document per second for no reason. Now the
// extension sends data only when data actually changes, and the page keeps its elements.
const { formatDur } = require('./model');
const { brand, markSvg } = require('./brands');

// Translate recorded tool activity at the display boundary, including old rows.
// Keep the original logs intact; never guess what an arbitrary script achieved.
function plainActivity(value) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const request = text.match(/^(?:mcp__\w+__)?ask_(claude|codex|agy|kimi)(_write)?$/i);
  if (request) return (request[2] ? 'Assigned work to ' : 'Asked for help from ') + brand(request[1].toLowerCase()).label;
  const labels = [
    [/^answered,\s*\d+\s+chars$/i, 'Returned an answer'],
    [/^No prompt provided via stdin\.?$/i, 'No task instructions were supplied'],
    [/^(?:collaboration[._])?(?:followup_task|spawn_agent)$/i, 'Assigned work to a helper'],
    [/^(?:collaboration[._])?send_message$/i, 'Updated a helper’s instructions'],
    [/^(?:collaboration[._])?(?:wait_agent|list_agents)$/i, 'Checked on the helpers'],
    [/^(?:collaboration[._])?interrupt_agent$/i, 'Stopped a helper’s task'],
    [/^(?:mcp__\w+__)?crew_job_apply$/i, 'Applied reviewed changes'],
    [/^(?:mcp__\w+__)?crew_job_status$/i, 'Checked a worker’s assignment'],
    [/^(?:mcp__\w+__)?crew_job_(?:abandon|recover)$/i, 'Resolved a worker’s assignment'],
    [/^(?:python\d*(?:\.\d+)*|node)\s+\S*check-release\.(?:py|mjs)\b/i, 'Ran release checks'],
    [/^(?:python\d*(?:\.\d+)*)\s+\S*doctor\.py\b/i, 'Checked the installation'],
    [/^(?:(?:python\d*|node)\s+\S*(?:test[-.]|\.test\.)|(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b)/i, 'Ran tests'],
    [/^(?:rg|grep|find)\s/i, 'Searched project files'],
    [/^(?:cat|sed|head|tail)\s/i, 'Read project files'],
    [/^git\s+(?:diff|status|show|log)\b/i, 'Reviewed file changes'],
    [/^(?:python\d*(?:\.\d+)*|node|bash|sh|zsh|ruby|perl)(?:\s|$)/i, 'Ran a script'],
    [/^(?:const |let |var |import |from |await )|<<|\$\(/i, 'Ran a script'],
    [/^(?:functions[._])?(?:exec|exec_command|run_command|a command)$/i, 'Ran a command'],
    [/^(?:functions[._])?(?:write_stdin|wait)$/i, 'Checked a running task'],
    [/^(?:functions[._])?apply_patch$/i, 'Edited files'],
    [/^[{\[]\s*["{\[]/, 'Recorded a tool update'],
    [/^(?:mcp__|collaboration[._]|functions[._])|^[a-z]+_[a-z_]+$/i, 'Used a tool'],
  ];
  const match = labels.find(([pattern]) => pattern.test(text));
  return match ? match[1] : text;
}

// Everything the row shows, pre-decided here so the webview holds no judgement of its own.
// Time-relative labels (how long ago, how long left) are NOT baked in — the page recomputes
// those every second from the epochs, which is what makes the panel feel live for free.
function rowPayload(row) {
  const b = brand(row.agent);
  const trail = (Array.isArray(row.trail) ? row.trail : [])
    .map(action => ({ ...action, text: plainActivity(action.text) }));
  return {
    id: row.id,
    agent: row.agent,
    brandLabel: b.label,
    color: b.color,
    bar: b.bar,
    mark: markSvg(row.agent),
    title: row.title,
    note: plainActivity(row.note),
    status: row.status,
    demo: !!row.demo,
    expanded: !!row.expanded,

    step: row.step,
    total: row.total,
    pct: row.pct,
    // Progress measured against the model's own checklist (his 2026-08-31 order). Shown
    // with its "N of M tasks" fraction so the denominator is never a mystery.
    planDone: row.planDone || 0,
    planCount: row.planCount || 0,
    planPct: row.planPct !== null && row.planPct !== undefined ? row.planPct : null,
    indeterminate: !!row.indeterminate,

    started: row.started,
    beat: row.beat,
    etaSec: row.etaSec,
    cadence: row.cadence || 0,
    stepAge: row.stepAge,
    // Frozen at the end for finished work: a done job's clock stops.
    finalElapsed: (row.status === 'done' || row.status === 'failed') ? row.elapsed : null,
    folder: typeof row.cwd === 'string' ? row.cwd.split('/').filter(Boolean).slice(-2).join('/') : '',
    // Named only when a file's own timestamp is what proves this job is still working.
    watching: row.watching || '',
    // The answer to "what is going on?". Past tense, timestamped, never a percentage:
    // the last thing done, the four before it, the plan as last written, and the last line
    // the job printed — which is where a failure's actual reason has always been.
    lastAction: trail.length ? trail[trail.length - 1] : null,
    trail: trail.slice(0, -1).reverse(),
    // The display cap lives HERE, not in the reader: the model counts the whole plan for
    // its percentage, the panel just doesn't draw a 100-line list.
    tasks: (Array.isArray(row.tasks) ? row.tasks : []).slice(0, 12),
    tasksAt: row.tasksAt || 0,
    lastOut: plainActivity(row.lastOut),
    // Set ONLY when the provider's own error text proves a quota/subscription death.
    quota: row.quota || '',
    // Who launched it, in words. It appears ONLY inside the row's detail block, which the
    // owner has to open — so a closed panel never spends a pixel on it.
    driverLabel: row.driver ? brand(row.driver).label : '',
  };
}

function buildPayload(view, driverStyle) {
  return {
    rows: view.rows.map(rowPayload),
    // One line for the whole panel: who is driving, and how many jobs each of them sent.
    // `bar` travels with them because the page tints each chip in its own driver's colour.
    drivers: (view.drivers || []).map(d => ({
      agent: d.agent,
      label: brand(d.agent).label,
      mark: markSvg(d.agent),
      bar: brand(d.agent).bar,
      jobs: d.jobs,
    })),
    // Which of the two driver looks he last chose. Anything unrecognised falls back to the
    // plain chip rather than to nothing at all.
    driverStyle: driverStyle === 'underline' ? 'underline' : 'chip',
    running: view.running,
    quiet: view.stalled,
    failed: view.failed,
    worstEta: view.worstEta,
    // Sent so the page can show a sensible empty state without inventing one.
    empty: view.rows.length === 0,
  };
}

module.exports = { buildPayload, rowPayload, formatDur };
