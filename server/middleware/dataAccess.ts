import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Server-side access levels for every /api route.
 *
 * - public:      no login (auth endpoints, health, Twilio delivery webhook)
 * - auth:        any logged-in, active user (user-owned content: journal, rules, settings, alerts CRUD...)
 * - owner:       vendor data (Alpaca / Finnhub / FMP raw prices, bars, quotes, news and anything
 *                computed from them). Licensed for the owner's own use only.
 * - owner_admin: owner who is also an admin (AI analysis run + cache clear: spends LLM credit and
 *                returns vendor data).
 *
 * Unknown /api paths default to "auth", so new routes are never anonymous by accident.
 */
export type ApiAccessLevel = "public" | "auth" | "owner" | "owner_admin";

type Rule = { level: ApiAccessLevel; method?: string; pattern: RegExp };

const RULES: Rule[] = [
  { level: "public", method: "POST", pattern: /^\/api\/auth\/(login|logout|register)$/ },
  { level: "public", method: "GET", pattern: /^\/api\/auth\/me$/ },
  { level: "public", pattern: /^\/api\/health(\/|$)/ },
  { level: "public", method: "POST", pattern: /^\/api\/alerts\/deliveries\/twilio-status$/ },

  { level: "owner_admin", method: "POST", pattern: /^\/api\/marketflow\/[^/]+$/ },
  { level: "owner_admin", method: "DELETE", pattern: /^\/api\/marketflow\/[^/]+\/cache$/ },

  // Operational status on data routers: no vendor values, polled by app chrome.
  { level: "auth", method: "GET", pattern: /^\/api\/market-condition\/(time|server-status|settings)$/ },
  { level: "auth", method: "GET", pattern: /^\/api\/scanner\/(status|config)$/ },

  { level: "owner", pattern: /^\/api\/(stocks|news|market|industry-comps|scanner|market-condition|marketflow|market-leaders)(\/|$)/ },
  { level: "owner", pattern: /^\/api\/watchlist\/quotes$/ },
  { level: "owner", pattern: /^\/api\/sentinel\/(chart-data|trade-chart-metrics|evaluate|suggest)$/ },
  { level: "owner", pattern: /^\/api\/sentinel\/(ticker|company-logo|sentiment|chart-setup-enrich)(\/|$)/ },
  { level: "owner", pattern: /^\/api\/bigidea\/(scan|scan-tune|marketflow)(\/|$)/ },
  { level: "owner", pattern: /^\/api\/bigidea\/custom-indicators\/test$/ },
  { level: "owner", pattern: /^\/api\/pattern-learning\/scan$/ },
  { level: "owner", method: "POST", pattern: /^\/api\/alerts\/preview$/ },
  { level: "owner", method: "POST", pattern: /^\/api\/alerts\/[^/]+\/evaluate$/ },
];

export function classifyApiPath(method: string, path: string): ApiAccessLevel | null {
  if (path !== "/api" && !path.startsWith("/api/")) return null;
  const m = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  for (const rule of RULES) {
    if (rule.method && rule.method !== m) continue;
    if (rule.pattern.test(path)) return rule.level;
  }
  return "auth";
}

export interface OwnerConfig {
  /** Explicit owner ids from OWNER_USER_IDS; null means "fall back to is_admin". */
  ownerIds: ReadonlySet<number> | null;
}

export function parseOwnerUserIds(raw: string | undefined): ReadonlySet<number> | null {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? new Set(ids) : null;
}

export function loadOwnerConfig(env: NodeJS.ProcessEnv = process.env): OwnerConfig {
  return { ownerIds: parseOwnerUserIds(env.OWNER_USER_IDS) };
}

export interface AccessUser {
  id: number;
  isAdmin?: boolean | null;
  isActive?: boolean | null;
}

export function isOwnerUser(user: AccessUser | null | undefined, config: OwnerConfig): boolean {
  if (!user || user.isActive === false) return false;
  if (config.ownerIds) return config.ownerIds.has(user.id);
  return user.isAdmin === true;
}

export const OWNER_ONLY_ERROR = {
  error: "Market data isn't available on your plan.",
  code: "OWNER_ONLY",
} as const;

export interface ApiAccessGuardOptions {
  config: OwnerConfig;
  /** Returns the user for a session id, or null if unknown. */
  getUser: (userId: number) => Promise<AccessUser | null | undefined>;
  /** Ends the session of a disabled/unknown user. */
  destroySession?: (req: Request) => Promise<void>;
}

export function createApiAccessGuard(opts: ApiAccessGuardOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const level = classifyApiPath(req.method, req.path);
    if (level === null || level === "public") return next();
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Login required" });
      }
      const user = await opts.getUser(userId);
      if (!user || user.isActive === false) {
        await opts.destroySession?.(req);
        return res.status(401).json({ error: "Login required" });
      }
      if (level === "auth") return next();
      if (!isOwnerUser(user, opts.config)) {
        return res.status(403).json(OWNER_ONLY_ERROR);
      }
      if (level === "owner_admin" && user.isAdmin !== true) {
        return res.status(403).json({ error: "Admin access required" });
      }
      return next();
    } catch (e) {
      next(e);
    }
  };
}
