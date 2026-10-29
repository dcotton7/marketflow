import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AnimaGatewayOptions } from "./animaGateway";

/**
 * MarketFlow's /embed pages inside Anima's online Lab. Browsers keep the normal (SameSite=Lax) login cookie out of a
 * frame on another site, so Anima's server hands the owner a short-lived ticket (anima/marketflow.py embed_ticket):
 *
 * - GET /embed/...?anima_ticket=<exp>.<hmac> with a valid ticket sets EMBED_COOKIE, then redirects without the ticket.
 *   The cookie is Partitioned (CHIPS): the browser only sends it while MarketFlow is framed by that same site.
 * - A GET/HEAD request with a valid EMBED_COOKIE and no normal login runs as the owner (ANIMA_GATEWAY_USER_ID), like
 *   the gateway: nothing stored server-side. Anything else (POST, PUT, ...) is never signed in by it, except the
 *   JSON POSTs in EMBED_POSTS (JSON forces a CORS preflight from any other site): the room summary, and the full
 *   watchlist panel's paste and From Screen, which read a screenshot (screen-grab/extract) and bulk-add tickers to
 *   one of the owner's lists, with `update` (entry, and shares in a portfolio list, of tickers already there) and
 *   `remove` (the tickers not in the screenshot, when he ticks From Screen's opt-in box after reviewing them;
 *   bulk-add allows it only on a portfolio list). These are his own clicks in the panel: Anima's server goes through
 *   the gateway (animaGateway.ts), which refuses `remove`.
 *
 * Tickets and cookies are HMACs under a key derived from ANIMA_GATEWAY_TOKEN, so only Anima's server can make them.
 */
export const EMBED_COOKIE = "mf_anima_embed";
export const COOKIE_SECONDS = 12 * 60 * 60;
const TICKET_MAX_SECONDS = 600;
const SESSION_COOKIE = "connect.sid";
const EMBED_POSTS = /^\/api\/(discord-stream\/summary|sentinel\/watchlist\/bulk-add|sentinel\/screen-grab\/extract)$/;

const embedPost = (req: Request) =>
  req.method === "POST" && EMBED_POSTS.test(req.path) && /^application\/json\b/i.test(req.get("content-type") || "");

const embedKey = (token: string) => createHash("sha256").update(`anima-embed\n${token}`).digest();
const sign = (token: string, what: string) => createHmac("sha256", embedKey(token)).update(what).digest("hex");

export function makeSigned(kind: "ticket" | "cookie", token: string, exp: number): string {
  return `${exp}.${sign(token, `${kind}:${exp}`)}`;
}

export function checkSigned(value: unknown, kind: "ticket" | "cookie", token: string, now: number, maxAhead: number) {
  const m = typeof value === "string" ? /^(\d{9,11})\.([0-9a-f]{64})$/.exec(value) : null;
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp <= now || exp > now + maxAhead) return false;
  const given = Buffer.from(m[2]);
  const want = Buffer.from(sign(token, `${kind}:${exp}`));
  return given.length === want.length && timingSafeEqual(given, want);
}

export function readCookie(header: string | undefined, name: string): string {
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

export function createAnimaEmbed(
  opts: AnimaGatewayOptions,
  now: () => number = () => Math.floor(Date.now() / 1000),
): RequestHandler {
  const on = !!opts.token && opts.token.length >= 32 && !!opts.userId;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!on || (req.method !== "GET" && req.method !== "HEAD" && !embedPost(req))) return next();
    const token = opts.token!;
    const t = now();
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
    const q = new URLSearchParams(qs);
    if (q.has("anima_ticket") && req.path.toLowerCase().startsWith("/embed/")) {
      if (checkSigned(q.get("anima_ticket"), "ticket", token, t, TICKET_MAX_SECONDS)) {
        res.setHeader("Set-Cookie", `${EMBED_COOKIE}=${makeSigned("cookie", token, t + COOKIE_SECONDS)}; Path=/; ` +
          `Max-Age=${COOKIE_SECONDS}; HttpOnly; Secure; SameSite=None; Partitioned`);
      }
      q.delete("anima_ticket");
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, req.path + (q.toString() ? `?${q}` : ""));
    }
    const cookies = req.headers.cookie;
    if (readCookie(cookies, SESSION_COOKIE)) return next();
    if (!checkSigned(readCookie(cookies, EMBED_COOKIE), "cookie", token, t, COOKIE_SECONDS)) return next();
    const done = (cb?: (err?: unknown) => void) => { cb?.(); };
    (req as any).session = { userId: opts.userId, save: done, reload: done, regenerate: done, destroy: done, touch() {} };
    return next();
  };
}
