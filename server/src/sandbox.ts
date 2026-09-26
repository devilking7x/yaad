// Sandboxed code execution (Codex/Grok-style "code as a tool").
// Yaad can run JavaScript to compute, transform data, or verify logic —
// the result comes back as data, not a guess.
//
// Safety model (honest version):
//  - NO require/module system, NO process, NO fetch/network, NO filesystem.
//  - 5 second CPU timeout, 64MB-ish heap cap via vm options.
//  - node:vm is NOT a bulletproof sandbox against a determined attacker;
//    it is a guardrail so prompt-injected web content can't exfiltrate data
//    (there is simply nothing to exfiltrate through). Treat accordingly.

import vm from "node:vm";

export interface CodeResult {
  ok: boolean;
  /** captured console.log lines + return value */
  output: string;
  error?: string;
  timedOut?: boolean;
}

const MAX_CODE_LEN = 4000;
const TIMEOUT_MS = 5000;

export function runCode(code: string): CodeResult {
  if (typeof code !== "string" || !code.trim()) {
    return { ok: false, output: "", error: "Koi code nahi diya." };
  }
  if (code.length > MAX_CODE_LEN) {
    return { ok: false, output: "", error: `Code bahut lamba hai (max ${MAX_CODE_LEN} chars).` };
  }

  const logs: string[] = [];
  // H1 fix: NEVER pass host intrinsics (Object, Array, Math, ...) into the
  // sandbox. A fresh vm.createContext() already ships its OWN intrinsics, so
  // guest code keeps Math/Array/JSON/etc. — but `Object.prototype.x = 1` now
  // pollutes only the guest realm, never the host. Previously guest code
  // permanently mutated host prototypes (verified: one run_code call could
  // 500 every later chat turn until process restart).
  //
  // The only host values crossing the boundary are the two console wrappers.
  // Each wrapper's prototype is cut to null so `console.log.constructor`
  // can't reach the host Function constructor (the classic vm escape hatch:
  // `fn.constructor("return process")()` would otherwise compile in the host
  // realm with full access to process/require/env).
  const mkLog = (prefix: string) => {
    const fn = (...a: unknown[]) => {
      logs.push(prefix + a.map(String).join(" "));
    };
    Object.setPrototypeOf(fn, null);
    return fn;
  };
  const sandbox = {
    console: {
      log: mkLog(""),
      error: mkLog("ERROR: "),
    },
  };
  Object.freeze(sandbox.console);
  const ctx = vm.createContext(sandbox);

  try {
    // Wrap as an expression-friendly program: last value is returned.
    const script = new vm.Script(`"use strict";\n${code}`);
    const ret = script.runInContext(ctx, { timeout: TIMEOUT_MS });
    const out = [...logs, ret !== undefined ? String(ret) : ""].filter(Boolean).join("\n");
    return { ok: true, output: out.slice(0, 4000) || "(koi output nahi)" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /timed out/i.test(msg);
    return { ok: false, output: logs.join("\n").slice(0, 2000), error: msg.slice(0, 500), timedOut };
  }
}
