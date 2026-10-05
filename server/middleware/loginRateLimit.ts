import type { Request } from "express";

/** In-memory per-IP throttle; auto-expires (unlike the per-account lock in loginLockout.ts). */
export const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_MAX_FAILURES = 10;

export function clientKey(req: Request): string {
  return (typeof req.ip === "string" && req.ip) || req.socket?.remoteAddress || "unknown";
}

export function createLoginRateLimiter(opts: { max?: number; windowMs?: number; now?: () => number } = {}) {
  const max = opts.max ?? LOGIN_IP_MAX_FAILURES;
  const windowMs = opts.windowMs ?? LOGIN_IP_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const failures = new Map<string, { count: number; windowStart: number }>();

  function live(key: string, t: number) {
    const e = failures.get(key);
    if (e && t - e.windowStart > windowMs) {
      failures.delete(key);
      return undefined;
    }
    return e;
  }

  return {
    isLimited(key: string): boolean {
      const e = live(key, now());
      return !!e && e.count >= max;
    },
    recordFailure(key: string): number {
      const t = now();
      const e = live(key, t) ?? { count: 0, windowStart: t };
      e.count += 1;
      failures.set(key, e);
      if (e.count === max) console.warn(`[auth-audit] login throttled ip=${key} failures=${e.count} window=${windowMs / 60000}m`);
      return e.count;
    },
    clear(key: string): void {
      failures.delete(key);
    },
  };
}

const limiter = createLoginRateLimiter();

/** Too many failed logins from this client in the rolling window. */
export function isLoginRateLimited(req: Request): boolean {
  return limiter.isLimited(clientKey(req));
}

export function recordLoginFailure(req: Request): void {
  limiter.recordFailure(clientKey(req));
}

export function clearLoginFailures(req: Request): void {
  limiter.clear(clientKey(req));
}
