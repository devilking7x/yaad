import dns from "node:dns";
import type { NextFunction, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Central security helpers: audit logging, error sanitization, SSRF guard.

function logFile(): string {
  fs.mkdirSync(config.memoryDir, { recursive: true });
  return path.join(config.memoryDir, "security.log");
}

// L2 fix: security.log had no rotation — an attacker spamming blocked requests
// could fill the disk. Cap at 5MB; on overflow keep the newest half (recent
// attack evidence matters more than old noise).
const SECURITY_LOG_MAX_BYTES = 5 * 1024 * 1024;

function rotateIfNeeded(file: string): void {
  try {
    const st = fs.statSync(file);
    if (st.size <= SECURITY_LOG_MAX_BYTES) return;
    const data = fs.readFileSync(file, "utf-8");
    const half = data.slice(-Math.floor(SECURITY_LOG_MAX_BYTES / 2));
    const cut = half.indexOf("\n");
    fs.writeFileSync(file, (cut >= 0 ? half.slice(cut + 1) : half) + "\n", "utf-8");
  } catch {
    /* best effort */
  }
}

/** Append a security-relevant event. Reads are local-only; never served over HTTP. */
export function logSecurity(event: string, detail: string, ip?: string): void {
  try {
    const file = logFile();
    rotateIfNeeded(file);
    const line = `${new Date().toISOString()} [${event}]${ip ? ` ip=${ip}` : ""} ${detail}\n`;
    fs.appendFileSync(file, line.slice(0, 2000), "utf-8");
  } catch {
    /* logging must never break the request */
  }
}

/** Error text safe for API responses: redacts secret-looking tokens, caps length. */
export function safeError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  msg = msg
    .replace(/sk-[A-Za-z0-9-_]{8,}/g, "sk-[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9-_.~+/=]{8,}/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key\s*[:=]\s*)["']?[A-Za-z0-9-_.~+/=]{8,}["']?/gi, "$1[redacted]");
  return msg.slice(0, 300);
}

/** Helmet-lite: the security headers that matter for a JSON/SSE API. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
}

// --- SSRF guard ---------------------------------------------------------------

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // treat garbage as private
  const [a, b] = p;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isPrivateV6(ip: string): boolean {
  const l = ip.toLowerCase();
  if (l.startsWith("::ffff:")) return isPrivateV4(l.slice("::ffff:".length)); // IPv4-mapped
  return (
    l === "::1" ||
    l === "::" ||
    l.startsWith("fc") ||
    l.startsWith("fd") ||
    l.startsWith("fe80") ||
    l.startsWith("fec0")
  );
}

function isPrivateIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateV6(ip) : isPrivateV4(ip);
}

/**
 * Throws unless the URL is safe for the server to fetch itself:
 * http(s) only, no embedded credentials, and every resolved IP is public.
 * (DNS is resolved up-front; a rebinding race between check and fetch is
 * out of scope for this threat model, but the window is tiny.)
 */
export async function assertPublicUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Wo valid URL nahi lagta");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Sirf http/https URLs allowed hain");
  }
  if (u.username || u.password) {
    throw new Error("URL me credentials allowed nahi hain");
  }
  let addrs: dns.LookupAddress[];
  try {
    addrs = await dns.promises.lookup(u.hostname, { all: true });
  } catch {
    throw new Error("Us hostname ko resolve nahi kar paye");
  }
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error("Internal/private addresses fetch nahi kar sakte");
    }
  }
}

const MAX_REDIRECTS = 5;

/**
 * fetch() that validates EVERY hop: fetch follows redirects automatically,
 * so a "safe" initial URL could 302 to http://169.254.169.254/. With
 * redirect:"manual" we check each Location with assertPublicUrl before
 * following it. Returns the final response.
 */
export async function safeFetch(url: string, init: RequestInit = {}): Promise<globalThis.Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop === MAX_REDIRECTS) {
        await res.arrayBuffer().catch(() => {});
        throw new Error("Bahut zyada redirects");
      }
      current = new URL(loc, current).toString(); // handles relative Location
      await res.arrayBuffer().catch(() => {}); // free the socket
      continue;
    }
    return res;
  }
  throw new Error("Redirect loop");
}
