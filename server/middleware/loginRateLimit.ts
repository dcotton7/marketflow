import type { Request } from "express";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 25;

function clientKey(req: Request): string {
  return (typeof req.ip === "string" && req.ip) || req.socket.remoteAddress || "unknown";
}

const failures = new Map<string, { count: number; windowStart: number }>();

function prune(key: string, now: number) {
  const e = failures.get(key);
  if (e && now - e.windowStart > WINDOW_MS) {
    failures.delete(key);
  }
}

/** Too many failed logins from this client in the rolling window. */
export function isLoginRateLimited(req: Request): boolean {
  const key = clientKey(req);
  const now = Date.now();
  prune(key, now);
  const e = failures.get(key);
  if (!e) return false;
  if (now - e.windowStart > WINDOW_MS) return false;
  return e.count >= MAX_FAILURES;
}

export function recordLoginFailure(req: Request): void {
  const key = clientKey(req);
  const now = Date.now();
  let e = failures.get(key);
  if (!e || now - e.windowStart > WINDOW_MS) {
    e = { count: 0, windowStart: now };
  }
  e.count += 1;
  failures.set(key, e);
}

export function clearLoginFailures(req: Request): void {
  failures.delete(clientKey(req));
}
