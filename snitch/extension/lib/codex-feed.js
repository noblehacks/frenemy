'use strict';
// IDE sessions can outlive hook installation. Import their actual recorded
// events; never advance a heartbeat from a timer or file mtime alone.
const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
// Called as a property of the module each time, so a test can wrap it and count the calls.
const publisher = require('./publish-codex-event');

class CodexFeed {
  constructor(sessionsDir, jobsDir) {
    this.sessionsDir = sessionsDir;
    this.jobsDir = jobsDir;
    this.files = new Map();
  }

  scan() {
    const recent = [];
    const visit = dir => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) visit(full);
        else if (/^rollout-.*\.jsonl$/.test(entry.name)) {
          try {
            const time = fs.statSync(full).mtimeMs;
            if (Date.now() - time < 86400000) recent.push([time, full]);
          } catch (_) { /* rotated */ }
        }
      }
    };
    visit(this.sessionsDir);
    for (const [, file] of recent.sort((a,b) => b[0]-a[0]).slice(0, 64)) this.update(file);
  }

  update(file) {
    const relative = path.relative(this.sessionsDir, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !/^rollout-.*\.jsonl$/.test(path.basename(file))) return;
    let stat;
    try { stat = fs.lstatSync(file); } catch (_) { this.files.delete(file); return; }
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    let state = this.files.get(file);
    if (!state || stat.ino !== state.ino || stat.size < state.offset) {
      state = { ino:stat.ino, offset:0, pending:'', meta:null, active:false,
        started:0, beat:0, status:'done', calls:new Map(), trail:[], published:0, dirty:false, decoder:new StringDecoder('utf8') };
      this.files.set(file, state);
    }
    if (stat.size === state.offset) { this.publish(state); return; }
    // Read incrementally in bounded chunks, retaining only incomplete lines.
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const buffer = Buffer.alloc(65536);
      while (state.offset < stat.size) {
        const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size-state.offset), state.offset);
        if (!n) break;
        state.offset += n;
        state.pending += state.decoder.write(buffer.subarray(0, n));
        let end;
        while ((end = state.pending.indexOf('\n')) >= 0) {
          const line = state.pending.slice(0, end);
          state.pending = state.pending.slice(end+1);
          try { this.event(state, JSON.parse(line)); } catch (_) { /* incomplete/unknown event */ }
        }
        if (state.pending.length > 8*1024*1024) state.pending = '';
      }
    } catch (_) { return; } finally { if (fd !== undefined) fs.closeSync(fd); }
    this.publish(state);
  }

  event(state, record) {
    const p = record?.payload;
    if (!p || typeof p !== 'object') return;
    if (record.type === 'session_meta') { state.meta = p; return; }
    if (state.meta?.source !== 'vscode') return; // CLI sessions use their hooks.
    const at = Date.parse(record.timestamp);
    if (!Number.isFinite(at)) return;
    const before = [state.beat,state.started,state.status,state.calls.size,state.trail.length].join(':');
    if (record.type === 'event_msg' && p.type === 'task_started') {
      state.active = true; state.status = 'running'; state.started = at;
      state.beat = at; state.calls.clear();
    } else if (record.type === 'event_msg' && ['task_complete','turn_aborted','turn_failed'].includes(p.type)) {
      state.active = false; state.status = p.type === 'turn_failed' ? 'failed' : 'done';
      state.beat = Math.max(state.beat, at); state.calls.clear();
    } else if (state.active && record.type === 'response_item') {
      if (['function_call','custom_tool_call'].includes(p.type)) {
        state.calls.set(p.call_id, typeof p.name === 'string' ? p.name : 'tool');
        state.beat = Math.max(state.beat, at);
      } else if (['function_call_output','custom_tool_call_output'].includes(p.type)) {
        const tool = state.calls.get(p.call_id);
        state.calls.delete(p.call_id);
        state.beat = Math.max(state.beat, at);
        if (tool) {
          const text = /apply_patch|write|edit/i.test(tool) ? 'Edited files' :
            /read|view/i.test(tool) ? 'Read files' : /wait/i.test(tool) ? 'Checked a running task' : 'Used tools';
          state.trail.push({at:Math.floor(at/1000),text});
          state.trail = state.trail.slice(-5);
        }
      } else if (['message','reasoning'].includes(p.type)) {
        state.beat = Math.max(state.beat, at);
      }
    } else if (state.active && record.type === 'event_msg' && p.type === 'item_completed') {
      state.beat = Math.max(state.beat, at);
    }
    if (before !== [state.beat,state.started,state.status,state.calls.size,state.trail.length].join(':')) state.dirty = true;
  }

  publish(state) {
    const meta = state.meta;
    if (meta?.source !== 'vscode' || !state.dirty || !state.started || !state.beat || state.offset <= state.published) return;
    if (typeof meta.cwd !== 'string' || !path.isAbsolute(meta.cwd)) return;
    const session = String(meta.session_id || meta.id || '').replace(/[^A-Za-z0-9]/g,'');
    if (!session) return;
    const folder = path.basename(meta.cwd);
    const slug = folder.replace(/ /g,'-').replace(/[^A-Za-z0-9._-]/g,'') || 'codex';
    const id = `codex-${slug}-${session.slice(-6)}`;
    const row = {id,agent:'codex',title:folder,state:state.status,step:0,total:0,
      started:Math.floor(state.started/1000),beat:Math.floor(state.beat/1000),
      cwd:meta.cwd,driver:'',note:state.active ? 'Working in the IDE' :
        state.status === 'failed' ? 'IDE turn failed' : 'Idle — waiting for you',
      source:'codex-ide-events',session_id:meta.session_id || meta.id};
    // The same per-job lock as native fleet writers prevents torn/stale updates.
    // Timestamp/cursor checks run inside that lock, including across IDE windows.
    // A row that is already newer on disk counts as handled; only a fault (or a lock held
    // for more than three seconds) leaves the state dirty, to be tried again.
    let handled = false;
    try {
      publisher.publish(this.jobsDir,
        {row, trail:state.trail, cursor:state.offset, eventAt:state.beat}, {timeoutMs:3000});
      handled = true;
    } catch (_) { /* tried again on the next recorded event */ }
    if (handled) { state.published = state.offset; state.dirty = false; }
  }
}

module.exports = { CodexFeed };
