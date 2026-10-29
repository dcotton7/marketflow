import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { normalizeApiPath } from "./dataAccess";

/**
 * Anima's read-only door into MarketFlow: GET /api/anima/<path> runs GET /api/<path> as the owner.
 *
 * - Only Anima's server may use it: the shared ANIMA_GATEWAY_TOKEN (32+ chars) in X-Anima-Token, and the request
 *   must come over Render's private network (an internal host name with no dot, and no X-Forwarded-For, which
 *   Render's public edge always adds) or, when the services sit in different regions, over the public address from
 *   one of the ANIMA_GATEWAY_IPS ranges (Anima's outbound IPs). Anything else gets a plain 404.
 * - GET only, and only the read routes in ALLOWED. Nothing that trades, writes, or spends LLM credit on demand:
 *   force/refresh are dropped so cached analyses and briefings are served as they are. The exceptions are the JSON
 *   POSTs in ALLOWED_POSTS: a trim's new share count (the route itself only lowers a count), and the watchlist edits
 *   Don asks Quinn for in chat (add tickers, remove named tickers, create a list), each only with the body shape in
 *   POST_BODIES: tickers, with the shares, entry and short side his broker screenshot shows and update (so rows
 *   already in the list take them, as From Screen does) but never remove; a name alone; and one row's shares, entry,
 *   stop, entry date or side with the values last read (watchlist/:id/plan, compare-and-set). Deleting a list,
 *   renaming it and every other write stay closed.
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
  /^\/api\/alerts\/feed$/,
  /^\/api\/positions\/snapshot$/,
];
const SHARES_POST = /^\/api\/sentinel\/watchlist\/\d+\/shares$/;
const PLAN_POST = /^\/api\/sentinel\/watchlist\/\d+\/plan$/;
const PLAN_KEYS = ["targetEntry", "stopPlan", "entryDate", "shares", "direction"];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every((k) => keys.includes(k));
const listId = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
const positiveOrNull = (v: unknown) => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v > 0);
const symbolText = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 12;
/** The watchlist writes and the only bodies they take. */
export const POST_BODIES: [RegExp, (body: unknown) => boolean][] = [
  [/^\/api\/sentinel\/watchlist\/bulk-add$/, (b) => isObject(b) && onlyKeys(b, ["watchlistId", "items", "update"]) &&
    listId(b.watchlistId) && Array.isArray(b.items) && (b.update === undefined || typeof b.update === "boolean") &&
    b.items.every((i) => isObject(i) && onlyKeys(i, ["symbol", "shares", "entry", "short"]) && symbolText(i.symbol) &&
      positiveOrNull(i.shares) && positiveOrNull(i.entry) && (i.short === undefined || typeof i.short === "boolean"))],
  [/^\/api\/sentinel\/watchlist\/remove-tickers$/, (b) => isObject(b) && onlyKeys(b, ["watchlistId", "symbols"]) &&
    listId(b.watchlistId) && Array.isArray(b.symbols) && b.symbols.every(symbolText)],
  // Don's row corrections in chat: those fields and expect only (the route checks values and compare-and-sets).
  [PLAN_POST, (b) => isObject(b) && onlyKeys(b, [...PLAN_KEYS, "expect"]) && isObject(b.expect) &&
    onlyKeys(b.expect, PLAN_KEYS)],
  [/^\/api\/sentinel\/watchlists$/, (b) => isObject(b) && onlyKeys(b, ["name"]) && typeof b.name === "string" &&
    b.name.trim().length > 0 && b.name.length <= 60],
];
/** "Trimmed" on a position alert sets the new share count; the rest are his chat's watchlist edits. */
export const ALLOWED_POSTS: RegExp[] = [SHARES_POST, ...POST_BODIES.map(([rx]) => rx)];
const DROPPED = new Set(["force", "refresh"]);

export function allowedPath(path: string, method = "GET"): boolean {
  const p = normalizeApiPath(path);
  return (method === "POST" ? ALLOWED_POSTS : ALLOWED).some((rx) => rx.test(p));
}

/** A body the write's route may get from Anima; an unparsed body never passes. */
export function allowedBody(path: string, body: unknown): boolean {
  const p = normalizeApiPath(path);
  if (SHARES_POST.test(p)) return true;
  const rule = POST_BODIES.find(([rx]) => rx.test(p));
  return !!rule && rule[1](body);
}

function jsonBody(req: Pick<Request, "headers">): boolean {
  return String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() === "application/json";
}

export function internalRequest(req: Pick<Request, "headers">): boolean {
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  return !!host && !host.includes(".") && !req.headers["x-forwarded-for"];
}

function ipv4(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function ipAllowed(ip: string, ranges: string[]): boolean {
  const addr = ipv4(ip);
  if (addr === null) return false;
  return ranges.some((range) => {
    const [base, bitsText] = range.split("/");
    const net = ipv4(base);
    const bits = bitsText === undefined ? 32 : Number(bitsText);
    if (net === null || !Number.isInteger(bits) || bits < 8 || bits > 32) return false;
    const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
    return ((addr & mask) >>> 0) === ((net & mask) >>> 0);
  });
}

/** Over the public address, only from Anima's outbound ranges. Cloudflare sets CF-Connecting-IP and overwrites any
 *  value the caller sends; X-Forwarded-For is not used because Render keeps whatever the caller put in it. */
export function publicFromAnima(req: Pick<Request, "headers">, ranges: string[]): boolean {
  const ip = req.headers["cf-connecting-ip"];
  return ranges.length > 0 && typeof ip === "string" && ipAllowed(ip, ranges);
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
  ips?: string[];
}

export function loadAnimaGatewayOptions(env: NodeJS.ProcessEnv = process.env): AnimaGatewayOptions {
  const id = Number(env.ANIMA_GATEWAY_USER_ID);
  const ips = (env.ANIMA_GATEWAY_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return { token: env.ANIMA_GATEWAY_TOKEN?.trim(), userId: Number.isInteger(id) && id > 0 ? id : undefined, ips };
}

export function createAnimaGateway(opts: AnimaGatewayOptions): RequestHandler {
  const on = !!opts.token && opts.token.length >= 32 && !!opts.userId;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.toLowerCase().startsWith(ANIMA_PREFIX)) return next();
    const hidden = () => res.status(404).json({ error: "Not found" });
    const from = internalRequest(req) || publicFromAnima(req, opts.ips || []);
    if (!on || !from || !sameToken(req.headers["x-anima-token"], opts.token!)) return hidden();
    const target = "/api/" + req.path.slice(ANIMA_PREFIX.length);
    const write = req.method === "POST" && allowedPath(target, "POST");
    if (req.method !== "GET" && !write) return res.status(405).json({ error: "Read only" });
    if (write && !jsonBody(req)) return res.status(415).json({ error: "JSON only" });
    if (write && !allowedBody(target, req.body)) return res.status(403).json({ error: "Not available to Anima" });
    if (!write && !allowedPath(target)) return res.status(403).json({ error: "Not available to Anima" });
    const q = new URLSearchParams(req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "");
    for (const k of [...q.keys()]) if (DROPPED.has(k.toLowerCase())) q.delete(k);
    const done = (cb?: (err?: unknown) => void) => { cb?.(); };
    (req as any).session = { userId: opts.userId, save: done, reload: done, regenerate: done, destroy: done, touch() {} };
    req.url = target + (q.toString() ? `?${q}` : "");
    return next();
  };
}
