'use strict';
// Real command handlers and archive/publisher helpers, with an isolated VS Code API.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'snitch-clear-commands-'));
const jobs = path.join(root,'jobs'), sessions = path.join(root,'sessions');
process.env.FLEET_DIR = root;
const commands = new Map(), messages = [];
let warnings = 0;
let lastCommand;
const stub = {
  Uri:{file:p=>({fsPath:p})}, RelativePattern:function(){},
  workspace:{getConfiguration:()=>({get:(k,d)=>k==='autoArchiveDead'?false:k==='notify'?'off':d}),
    createFileSystemWatcher:()=>({onDidChange(){},onDidCreate(){},onDidDelete(){},dispose(){}}),
    onDidChangeConfiguration(){}},
  window:{registerWebviewViewProvider:()=>({dispose(){}}),
    showWarningMessage:()=>{warnings++;},showInformationMessage:m=>messages.push(m),showErrorMessage:m=>messages.push(m)},
  commands:{registerCommand:(name,fn)=>{commands.set(name,fn);return {dispose(){}};},
    executeCommand:(name,...args)=>(lastCommand=commands.get(name)(...args))},
};
const original = Module._load;
Module._load = function(name){return name==='vscode'?stub:original.apply(this,arguments);};
const {CodexFeed} = require('../extension/lib/codex-feed');
const scan = CodexFeed.prototype.scan;
// Activation's unrelated real-user session scan is excluded. Feed tests below use fixtures.
CodexFeed.prototype.scan = function(){};
const extension = require('../extension/extension');
const context = {subscriptions:[],extensionUri:{fsPath:path.resolve(__dirname,'../extension')}};
extension.activate(context);
CodexFeed.prototype.scan = scan;
const provider=context.subscriptions.find(s=>s.currentView);
function write(id,state='running') {
  const now=Math.floor(Date.now()/1000);
  fs.writeFileSync(path.join(jobs,id+'.json'),JSON.stringify({id,state,agent:'kimi',title:id,started:now-20,beat:now}));
}
(async()=>{
  try {
    write('running');write('done','done');
    await commands.get('snitch.clearFinished')();
    assert(fs.existsSync(path.join(jobs,'running.json')));
    assert(!fs.existsSync(path.join(jobs,'done.json')));
    const model = require('../extension/lib/model');
    const readJobs = model.readJobs;
    write('resuming','done');
    model.readJobs = function(dir, onRead) {
      const rows = readJobs(dir, onRead);
      if (onRead) write('resuming','running');
      return rows;
    };
    try { await commands.get('snitch.clearFinished')(); }
    finally { model.readJobs = readJobs; }
    assert(fs.existsSync(path.join(jobs,'resuming.json')),
      'a resumed job is retained when it changes after selection');
    provider.onMessage({type:'clearAll'});await lastCommand;
    assert(!fs.existsSync(path.join(jobs,'running.json')));
    assert.equal(warnings,0,'Clear All is immediate and does not wait on a separate dialog');
    write('one');write('two');
    await commands.get('snitch.clearOne')('one');
    assert(!fs.existsSync(path.join(jobs,'one.json')) && fs.existsSync(path.join(jobs,'two.json')));
    await commands.get('snitch.clearAll')();
    console.log('PASS: clear finished/all/one handlers and immediate clearing of active records.');

    fs.mkdirSync(sessions);
    const file=path.join(sessions,'rollout-clear.jsonl');
    const now=Date.now()-2000;
    const events=[{type:'session_meta',payload:{source:'vscode',id:'clear-abc123',cwd:root}},
      {type:'event_msg',timestamp:new Date(now).toISOString(),payload:{type:'task_started'}},
      {type:'event_msg',timestamp:new Date(now+10).toISOString(),payload:{type:'task_complete'}}];
    fs.writeFileSync(file,events.map(e=>JSON.stringify(e)).join('\n')+'\n');
    new CodexFeed(sessions,jobs).scan();
    assert.equal(provider.currentView().rows.length,1);
    await commands.get('snitch.clearAll')();
    const second = new CodexFeed(sessions,jobs);second.scan();
    assert.equal(provider.currentView().rows.length,0,'fresh extension/window cannot resurrect old event');
    assert.equal(fs.readdirSync(jobs).filter(f=>f.endsWith('.json')).length,0);
    fs.appendFileSync(file,JSON.stringify({type:'event_msg',timestamp:new Date(Date.now()+5).toISOString(),payload:{type:'task_started'}})+'\n');
    second.update(file);
    assert.equal(provider.currentView().rows.length,1,'new real recorded activity returns');
    console.log('PASS: cleared finished job stays cleared across a new feed; new turn returns.');
    assert(messages.some(m=>m.includes('cleared')));
    fs.renameSync(path.join(root,'trash'),path.join(root,'trash-aside'));
    fs.writeFileSync(path.join(root,'trash'),'blocked path fixture');
    await commands.get('snitch.clearAll')();
    assert.equal(provider.currentView().rows.length,1,'archive failure leaves the job visible');
    assert(messages.some(m=>m.includes('failed.')),'archive error is reported');
    console.log('PASS: archive failure is surfaced without falsely clearing the row.');
  } finally {
    for(const s of context.subscriptions)s.dispose?.();
    Module._load=original;
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
