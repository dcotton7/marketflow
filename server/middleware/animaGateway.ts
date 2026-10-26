import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { normalizeApiPath } from "./dataAccess";

/**
 * Anima's read-only door into MarketFlow: GET /api/anima/<path> runs GET /api/<path> as the owner.
 *
 * - Only Anima's server may use it: the shared ANIMA_GATEWAY_TOKEN (32+ chars) in X-Anima-Token, and the request
 *   must come over Render's private network (an internal host name with no dot, and no X-Forwarded-For, which
 *   Render's public edge always adds). Anything else gets a plain 404.
 * - GET only, and only the read routes in ALLOWED. Nothing that trades, writes, or spends LLM credit on demand:
 *   force/refresh are dropped so cached analyses and briefings are served as they are.
 * - The request carries the owner's id (ANIMA_GATEWAY_USER_ID) for this request only; express-session leaves an
 *   existing req.session alone, so nothing is stored and no cookie is issued. dataAccess still checks the route.
 */
export const ANIMA_PREFIX = "/api/anima/";

const SYM = "[a-z0-9.^=-]{1,15}";
export const ALLOWED: RegExp[] = [
  new RegExp(`^/api/stocks/${SYM}/(quote|history)$`),
  /^\/api\/watchlist\/quotes$/,
  new RegExp(`^/api/news/${SYM}$`),
  /^\/api\/market\/indicators$/,
  new RegExp(
    `^/api/market-condition/(themes|themes/[\\w-]+|themes/[\\w-]+/(members|subthemes)|ticker-theme/${SYM}|rai|leaders|` +
      `regime|race-timeline|status|subthemes|subthemes/[\\w-]+/members|search|briefing|briefing/preview)$`,
  ),
  /^\/api\/marketflow\/options\/(pulse|regime)$/,
  new RegExp(`^/api/marketflow/${SYM}/cached$`),
  /^\/api\/bigidea\/(ideas|ideas\/\d+|thoughts|setups|setups\/\d+)$/,
  /^\/api\/discord-stream\/(summary|analysis)$/,
  /^\/api\/sentinel\/(dashboard|trade-journal|trades\/closed|trade\/\d+|watchlists|watchlist)$/,
];
const DROPPED = new Set(["force", "refresh"]);

export function allowedPath(path: string): boolean {
  const p = normalizeApiPath(path);
  return ALLOWED.some((rx) => rx.test(p));
}

export function internalRequest(req: Pick<Request, "headers">): boolean {
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  return !!host && !host.includes(".") && !req.headers["x-forwarded-for"];
}

function sameToken(given: unknown, token: string): boolean {
  if (typeof given !== "string" || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

export interface AnimaGatewayOptions {
  token: string | undefined;
  userId: number | undefined;
}

export function loadAnimaGatewayOptions(env: NodeJS.ProcessEnv = process.env): AnimaGatewayOptions {
  const id = Number(env.ANIMA_GATEWAY_USER_ID);
  return { token: env.ANIMA_GATEWAY_TOKEN?.trim(), userId: Number.isInteger(id) && id > 0 ? id : undefined };
}

export function createAnimaGateway(opts: AnimaGatewayOptions): RequestHandler {
  const on = !!opts.token && opts.token.length >= 32 && !!opts.userId;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.toLowerCase().startsWith(ANIMA_PREFIX)) return next();
    const hidden = () => res.status(404).json({ error: "Not found" });
    if (!on || !internalRequest(req) || !sameToken(req.headers["x-anima-token"], opts.token!)) return hidden();
    if (req.method !== "GET") return res.status(405).json({ error: "Read only" });
    const target = "/api/" + req.path.slice(ANIMA_PREFIX.length);
    if (!allowedPath(target)) return res.status(403).json({ error: "Not available to Anima" });
    const q = new URLSearchParams(req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "");
    for (const k of [...q.keys()]) if (DROPPED.has(k.toLowerCase())) q.delete(k);
    const done = (cb?: (err?: unknown) => void) => { cb?.(); };
    (req as any).session = { userId: opts.userId, save: done, reload: done, regenerate: done, destroy: done, touch() {} };
    req.url = target + (q.toString() ? `?${q}` : "");
    return next();
  };
}
