#!/usr/bin/env node
// run-job: watch over one command and keep its Snitch row honest.
//
//   run-job.mjs FLEET_EXEC JOB_ID EVERY_SECONDS TITLE AGENT TOTAL NOTE -- COMMAND [ARG...]
//
// Records a real job around a real command: `start` before it is launched, `beat` on a timer
// only while the command is actually running, `done` or `fail` on its actual exit (or when it
// could not be launched at all). When this process is told to stop, the whole process tree the
// command started is stopped first, including grandchildren that set up their own process
// groups, and nothing else on the computer is touched.
//
// `fleet run` uses runJob() below with the row writer inside the same process. Started as a
// command of its own, FLEET_EXEC is the recorder program to call for each change to the row.
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WIN, resolveBin, spawnCli, stopProcessTree } from '../../tools/platform.mjs';

const USAGE = 'usage: run-job.mjs FLEET_EXEC JOB_ID EVERY_SECONDS TITLE AGENT TOTAL NOTE -- COMMAND [ARG...]';
const SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];
const LONGEST_TIMER_MS = 2147483647;

/** Text in quotes, the way the earlier tool printed a value inside its messages. */
function quoted(text) {
  const value = String(text);
  const mark = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === mark) out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += '\\x' + code.toString(16).padStart(2, '0');
    else out += ch;
  }
  return mark + out + mark;
}

/** The seconds between beats as a number, or the words that say what is wrong with it. */
export function checkEvery(raw) {
  const text = String(raw);
  if (!/^[0-9]+$/.test(text)) return 'EVERY_SECONDS must be an integer, got ' + quoted(text);
  const every = Number(text);
  if (every < 1) return 'EVERY_SECONDS must be >= 1, got ' + every;
  return every;
}

function launchProblem(error, program) {
  if (error && error.code === 'ENOENT') return { code: 127, text: '[Errno 2] No such file or directory: ' + quoted(program) };
  if (error && (error.code === 'EACCES' || error.code === 'EPERM')) return { code: 126, text: '[Errno 13] Permission denied: ' + quoted(program) };
  return { code: 1, text: error && error.message ? error.message : String(error) };
}

function startProgram(program, args, options) {
  // On Windows a bare name is looked up here, so an app that is really a .cmd launcher starts too.
  const bin = WIN && !/[\\/]/.test(program) ? (resolveBin(program, '=') || program) : program;
  return spawnCli(bin, args, { ...options, group: true });
}

/**
 * A recorder that starts a program for each change to the row. It is given ten seconds; a
 * recorder that hangs is stopped with everything it started.
 */
export function externalRecorder(fleetExec) {
  let active = null;
  const viaNode = /\.(mjs|cjs|js)$/i.test(fleetExec);
  const record = args => new Promise((resolve, reject) => {
    let child;
    try {
      child = viaNode
        ? startProgram(process.execPath, [fleetExec, ...args], { stdio: ['inherit', 'pipe', 'pipe'] })
        : startProgram(fleetExec, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    } catch (error) { reject(error); return; }
    active = child;
    let out = '', err = '', settled = false;
    const settle = finish => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (active === child) active = null;
      finish();
    };
    const timer = setTimeout(async () => {
      try { if (child.pid) await stopProcessTree(child.pid, 1000); } catch { /* reported below */ }
      const shown = '[' + [fleetExec, ...args].map(quoted).join(', ') + ']';
      settle(() => reject(new Error("Command '" + shown + "' timed out after 10 seconds")));
    }, 10000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { out += text; });
    child.stderr.on('data', text => { err += text; });
    child.once('error', error => settle(() => reject(new Error(launchProblem(error, fleetExec).text))));
    child.once('close', (code, signal) => settle(() => resolve({
      code: code === null ? -(os.constants.signals[signal] || 1) : code, stdout: out, stderr: err })));
  });
  record.stopActive = async () => { if (active && active.pid) await stopProcessTree(active.pid, 1000); };
  return record;
}

/**
 * Run `command`, keep its row alive, and record how it ended. Resolves with the exit code this
 * process should end with. `record(args)` writes one change to the row and gives {code, stderr}
 * (directly or as a promise).
 */
export async function runJob({ jobId, every, title, agent, total, note, command, record }) {
  let cancelled = false, child = null, childGone = false;
  const warn = text => process.stderr.write('run-job: ' + text + '\n');
  const parked = () => new Promise(() => {});   // the stop handler ends the process from here on

  const runFleet = async (args, warnOnFailure = true) => {
    let result;
    try { result = await record(args); }
    catch (error) {
      if (warnOnFailure) warn('fleet ' + args[0] + ' failed: ' + (error && error.message ? error.message : String(error)));
      return null;
    }
    if (result.code !== 0 && warnOnFailure) {
      warn('fleet ' + args[0] + ' exited ' + result.code + ': ' + String(result.stderr || '').trim());
    }
    return result;
  };

  // Told to stop: take down the recorder if one is running, then the command's whole tree,
  // say so in the row, and leave with the usual code for that signal.
  const onSignal = name => {
    if (cancelled) return;
    cancelled = true;
    (async () => {
      try { if (record.stopActive) await record.stopActive(); } catch { /* keep going */ }
      try { if (child && child.pid && !childGone) await stopProcessTree(child.pid, 1000); } catch { /* keep going */ }
      await runFleet(['fail', jobId, '--agent', agent, '--title', title, '--note', 'stopped by ' + name], false);
      process.exit(128 + os.constants.signals[name]);
    })();
  };
  for (const name of SIGNALS) process.on(name, () => onSignal(name));

  const started = await runFleet(['start', jobId, '--agent', agent, '--title', title, '--total', total,
    '--note', note, '--beat-every', String(every)]);
  // A stop request that arrived while the row was being opened is handled before anything is launched.
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setImmediate(resolve));
  if (cancelled) await parked();
  if (!started || started.code !== 0) {
    warn('could not record fleet start; command was not launched');
    return 2;
  }

  const launchFailed = async error => {
    const problem = launchProblem(error, command[0]);
    await runFleet(['fail', jobId, '--note', 'launch failed: ' + problem.text]);
    return problem.code;
  };
  try { child = startProgram(command[0], command.slice(1), { stdio: 'inherit', cwd: process.cwd(), env: process.env }); }
  catch (error) { return launchFailed(error); }
  const ended = new Promise(resolve => {
    child.once('error', error => { childGone = true; resolve({ error }); });
    child.once('exit', (code, signal) => { childGone = true; resolve({ code, signal }); });
  });

  let outcome;
  for (;;) {
    let timer;
    const tick = new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.min(every * 1000, LONGEST_TIMER_MS)); });
    outcome = await Promise.race([ended, tick]);
    clearTimeout(timer);
    if (cancelled) await parked();
    if (outcome) break;
    await runFleet(['beat', jobId], false);
    if (cancelled) await parked();
  }

  if (outcome.error) {
    const code = await launchFailed(outcome.error);
    if (cancelled) await parked();
    return code;
  }
  let code;
  if (outcome.signal) {
    const number = os.constants.signals[outcome.signal] || 0;
    await runFleet(['fail', jobId, '--note', 'killed by signal ' + number]);
    code = 128 + number;
  } else if (outcome.code === 0) {
    await runFleet(['done', jobId, '--note', 'finished']);
    code = 0;
  } else {
    await runFleet(['fail', jobId, '--note', 'exited ' + outcome.code]);
    code = outcome.code;
  }
  if (cancelled) await parked();
  return code;
}

async function main(argv) {
  const die = text => { process.stderr.write('run-job: ' + text + '\n'); return 2; };
  if (argv.length < 8) return die(USAGE);
  const [fleetExec, jobId, everyRaw, title, agent, total, note] = argv;
  if (argv[7] !== '--') return die(USAGE);
  const command = argv.slice(8);
  if (!command.length) return die('at least one command is required after --');
  if (!jobId) return die('JOB_ID must not be empty');
  const every = checkEvery(everyRaw);
  if (typeof every === 'string') return die(every);
  return runJob({ jobId, every, title, agent, total, note, command, record: externalRecorder(fleetExec) });
}

function startedDirectly() {
  if (!process.argv[1]) return false;
  try {
    const asked = fs.realpathSync(process.argv[1]), self = fs.realpathSync(fileURLToPath(import.meta.url));
    return WIN ? asked.toLowerCase() === self.toLowerCase() : asked === self;
  } catch { return false; }
}

if (startedDirectly()) {
  main(process.argv.slice(2)).then(code => process.exit(code),
    error => { process.stderr.write('run-job: ' + (error && error.message ? error.message : String(error)) + '\n'); process.exit(1); });
}
