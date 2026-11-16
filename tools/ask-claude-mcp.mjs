#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWrapper, envelope, serve } from './relay-core.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const tools = [false, true].map(write => ({
  name: write ? 'ask_claude_write' : 'ask_claude',
  description: write ? 'Assign authorized edits to Claude; its own command approval gates still apply.' : 'Consult Claude with writing and shell tools disabled.',
  inputSchema: {type:'object', properties:{prompt:{type:'string'},working_directory:{type:'string'}}, required:['prompt']},
}));
serve({serverName:'frenemy-claude',version:'2.0.0',tools,call:async(name,prompt,options={})=>{
  const result = await runWrapper({script:join(here,'ask-claude-wrapper.mjs'),cwd:options.working_directory,
    signal:options.signal,env:{CLAUDE_WRITE:name.endsWith('_write')?'1':'0',CLAUDE_TIMEOUT:'570'},
    timeoutMs:600000,maxOutput:300*1024,exitMeaning:{1:'Claude failed or returned no answer',124:'timed out'},
    label:'ask-claude',fleet:{cwd:options.original_working_directory || options.working_directory,agent:'claude',driver:process.env.FRENEMY_DRIVER||'unknown',title:`${process.env.FRENEMY_DRIVER||'unknown'} → claude ${name.endsWith('_write')?'work':'consult'}`}},
    'Use only your own tools for the assigned task. Do not delegate.\n'+prompt);
  return {...result,text:envelope('claude',result.text)};
}});
