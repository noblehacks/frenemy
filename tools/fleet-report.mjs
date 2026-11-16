
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function findFleet() {
  const candidates = [
    process.env.FLEET_BIN,
    join(HERE, "..", "snitch", "bin", "fleet.mjs"),
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (existsSync(c)) return c; } catch { /* unreadable */ }
  }
  return null;
}

const FLEET = findFleet();
// The job tool is a Node script and is started with this same Node. A FLEET_BIN that names
// any other kind of program is started as it is.
const FLEET_IS_SCRIPT = FLEET ? /\.(mjs|cjs|js)$/i.test(FLEET) : false;

function fleetCall(args, cwd) {
  if (!FLEET) return;
  try {
    spawnSync(FLEET_IS_SCRIPT ? process.execPath : FLEET, FLEET_IS_SCRIPT ? [FLEET, ...args] : args,
      { cwd, stdio: "ignore", timeout: 5000, windowsHide: true });
  } catch { /* Snitch is never allowed to break a consult */ }
}

function note(text, max = 90) {
  const one = String(text ?? "").replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

const BEAT_MS = 30_000;

/**
 * Open a Snitch row for one relay call.
 *
 * spec: { agent, driver, title, prompt, maxSilenceS }
 * Returns a handle with beat(note) / done(note) / fail(note); every method is
 * idempotent after the row is closed.
 */
export function fleetJob({ agent, driver, title, prompt, maxSilenceS, cwd, watch }) {
  const id = `${driver}-${agent}-${randomBytes(3).toString("hex")}`;
  let closed = false;

  const args = ["start", id, "--agent", agent, "--driver", driver, "--title", note(title, 60)];
  if (watch) args.push("--watch", watch);
  if (prompt) args.push("--note", note(prompt));
  if (maxSilenceS) args.push("--max-silence", String(maxSilenceS));
  args.push("--beat-every", String(Math.round(BEAT_MS / 1000)));
  fleetCall(args, cwd);

  const timer = setInterval(() => {
    if (!closed) fleetCall(["beat", id], cwd);
  }, BEAT_MS);
  timer.unref?.();

  const close = (verb, text) => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    const a = [verb, id, "--agent", agent, "--driver", driver, "--title", note(title, 60)];
    if (text) a.push("--note", note(text));
    fleetCall(a, cwd);
  };

  return {
    id,
    beat: (text) => { if (!closed) fleetCall(text ? ["beat", id, "--note", note(text)] : ["beat", id], cwd); },
    done: (text) => close("done", text),
    fail: (text) => close("fail", text),
  };
}
