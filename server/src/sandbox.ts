// Sandboxed code execution (Codex/Grok-style "code as a tool").
// Yaad can run JavaScript to compute, transform data, or verify logic —
// the result comes back as data, not a guess.
//
// Safety model (honest version):
//  - Guest code runs in a DEDICATED Worker thread with a REAL 64MB heap cap
//    (resourceLimits.maxOldGenerationSizeMb). An allocation bomb kills ONLY
//    the worker — the host process (and all ephemeral demo state) survives.
//    The old code claimed a "heap cap via vm options" that never existed:
//    node:vm has no such option, so `while(true) a.push(new Array(1e6))`
//    OOM-killed the whole 512MB Render instance mid-demo. (H1 fix)
//  - Inside the worker, node:vm strips require/process/fetch/fs (defense in
//    depth) and a 5s CPU timeout kills infinite loops; a host-side 7s wall
//    terminates anything that wedges outside the vm timeout.
//  - node:vm is NOT a bulletproof sandbox against a determined attacker;
//    it is a guardrail so prompt-injected web content can't exfiltrate data
//    (there is simply nothing to exfiltrate through). Treat accordingly.

import { Worker } from "node:worker_threads";

export interface CodeResult {
  ok: boolean;
  /** captured console.log lines + return value */
  output: string;
  error?: string;
  timedOut?: boolean;
}

const MAX_CODE_LEN = 4000;
const TIMEOUT_MS = 5000;
const HEAP_MB = 64;

// Runs inside the worker: vm sandbox with stripped globals, posts the result
// back. Inline source because Worker(eval:true) needs it; guest code travels
// via workerData (structured clone), never string-interpolated.
const WORKER_SRC = `
const vm = require("node:vm");
const { parentPort, workerData } = require("node:worker_threads");
const logs = [];
const mkLog = (prefix) => {
  const fn = (...a) => { logs.push(prefix + a.map(String).join(" ")); };
  Object.setPrototypeOf(fn, null);
  return fn;
};
const sandbox = { console: { log: mkLog(""), error: mkLog("ERROR: ") } };
Object.freeze(sandbox.console);
try {
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script('"use strict";\\n' + workerData.code);
  const ret = script.runInContext(ctx, { timeout: ${TIMEOUT_MS} });
  const out = logs.concat(ret !== undefined ? [String(ret)] : []).filter(Boolean).join("\\n");
  parentPort.postMessage({ ok: true, output: out.slice(0, 4000) || "(koi output nahi)" });
} catch (e) {
  const msg = e && e.message ? String(e.message) : String(e);
  parentPort.postMessage({ ok: false, output: logs.join("\\n").slice(0, 2000), error: msg.slice(0, 500), timedOut: /timed out/i.test(msg) });
}
`;

export function runCode(code: string): Promise<CodeResult> {
  if (typeof code !== "string" || !code.trim()) {
    return Promise.resolve({ ok: false, output: "", error: "Koi code nahi diya." });
  }
  if (code.length > MAX_CODE_LEN) {
    return Promise.resolve({ ok: false, output: "", error: `Code bahut lamba hai (max ${MAX_CODE_LEN} chars).` });
  }
  return new Promise((resolve) => {
    let done = false;
    let worker: Worker;
    // Hard wall: even if the worker wedges outside the vm timeout, die here.
    const killTimer = setTimeout(() => {
      finish({ ok: false, output: "", error: `Timeout: ${TIMEOUT_MS}ms se zyada laga.`, timedOut: true });
    }, TIMEOUT_MS + 2000);
    if (typeof killTimer.unref === "function") killTimer.unref();
    const finish = (r: CodeResult) => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      try {
        worker.terminate().catch(() => {});
      } catch {
        /* already gone */
      }
      resolve(r);
    };
    try {
      worker = new Worker(WORKER_SRC, {
        eval: true,
        workerData: { code },
        resourceLimits: { maxOldGenerationSizeMb: HEAP_MB },
      });
    } catch (e) {
      clearTimeout(killTimer);
      resolve({ ok: false, output: "", error: `Sandbox start nahi hua: ${(e as Error).message}` });
      return;
    }
    worker.on("message", (m) => finish(m as CodeResult));
    worker.on("error", (e) => {
      // Worker died (e.g. heap cap hit) — the HOST is unharmed, only the guest died.
      const msg = (e as Error).message ?? String(e);
      const oom = /heap|memory|allocation failed/i.test(msg);
      finish({
        ok: false,
        output: "",
        error: oom
          ? "Code ne bahut zyada memory kha li (64MB cap) — server safe hai."
          : `Worker error: ${msg.slice(0, 300)}`,
      });
    });
    worker.on("exit", (exitCode) => {
      if (exitCode !== 0) {
        finish({ ok: false, output: "", error: `Sandbox exit code ${exitCode} (shayad memory cap).` });
      }
    });
  });
}
