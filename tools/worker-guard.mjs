import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const script = join(dirname(fileURLToPath(import.meta.url)), 'worker-workspace.mjs');
export const guardChildren = new Set();
function runGuard(args) {
  return new Promise((resolve,reject) => {
    const child = execFile(process.execPath,args,{encoding:'utf8',maxBuffer:1024*1024},(error,stdout,stderr) => {
      guardChildren.delete(child.pid);
      if (error) { error.stderr=stderr; reject(error); } else resolve(stdout);
    });
    if (child.pid) guardChildren.add(child.pid);
  });
}
export function jobCommand(command, root, job, stopped = false) {
  const args = [script, command, '--root', root];
  if (job) args.push('--job', job);
  if (stopped && ['abandon', 'recover'].includes(command)) args.push('--stopped');
  return runGuard(args);
}
export async function prepareWorker(root, agent, files) {
  if (!root || !Array.isArray(files) || !files.length || files.some(f => typeof f !== 'string' || !f.trim())) {
    throw new Error('Writable assignments require working_directory and a nonempty allowed_files list of exact relative file paths.');
  }
  const output = await runGuard([script, 'prepare', '--root', root, '--agent', agent, '--files', ...files]);
  const job = output.match(/^job ([0-9a-f]{12})$/m)?.[1];
  if (!job) throw new Error('Guard did not return a job ID; no worker launched.');
  return {job, root, workspace:join(root,'.worker-state','workspaces',job)};
}
export const jobTools = ['status','apply','abandon','recover'].map(action => ({
  name:'crew_job_'+action,
  description: action === 'status' ? 'Inspect retained crew assignments and file ownership.' :
    action === 'apply' ? 'Driver applies an authorized worker result after review. Refuses conflicting or out-of-scope edits.' :
    'Driver resolves a retained assignment only after confirming its old worker has stopped. Never hand off while it still runs.',
  inputSchema:{type:'object',properties:{working_directory:{type:'string'},job:{type:'string'},stopped:{type:'boolean'}},
    required: action === 'status' ? ['working_directory'] : ['working_directory','job']},
}));
