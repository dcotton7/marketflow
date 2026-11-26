/**
 * Read routes built for Quinn's reach into MarketFlow (docs/gateway-reads.md), mounted at /api/market-condition before
 * the market-condition router. Owner data: the access rule for
 * /api/market-condition covers them. Reads only, from stored data; each answer is kept a short while in memory.
 *
 *   GET /earnings/upcoming?symbols=A,B (<= 50)  |  ?days=N (1-30, the liquid universe)
 */
import { Router, type Request, type Response } from "express";
import { getDb } from "../db";
import { getEtClock } from "@shared/usEquityMarketSession";
import { parseDays, parseSymbols, pgEarningsSource, upcomingForSymbols, upcomingWindow, type EarningsSource } from "./earnings";

type Deps = { earnings?: () => EarningsSource | null; now?: () => Date };

/** A small TTL cache, like the other read routes' (scanner upcoming-earnings, the VIX quote). */
export function ttlCache<T>(ttlMs: number, max = 200) {
  const m = new Map<string, { at: number; v: T }>();
  return {
    async get(key: string, make: () => Promise<T>): Promise<T> {
      const hit = m.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.v;
      const v = await make();
      if (m.size >= max) m.delete(m.keys().next().value as string);
      m.set(key, { at: Date.now(), v });
      return v;
    },
    clear: () => m.clear(),
  };
}

export function gatewayReadRoutes(deps: Deps = {}): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  const earningsSrc = deps.earnings ?? (() => { const db = getDb(); return db ? pgEarningsSource(db) : null; });
  const earningsCache = ttlCache<unknown>(10 * 60_000);

  const fail = (res: Response, err: unknown, what: string) => {
    console.warn(`[GatewayReads] ${what} failed:`, String(err).slice(0, 200));
    return res.status(500).json({ error: `${what} failed` });
  };

  router.get("/earnings/upcoming", async (req: Request, res: Response) => {
    const src = earningsSrc();
    if (!src) return res.status(503).json({ error: "database unavailable" });
    const today = getEtClock(now()).dateKey;
    try {
      if (req.query.symbols !== undefined) {
        const { symbols, dropped } = parseSymbols(req.query.symbols);
        if (!symbols.length) return res.status(400).json({ error: "symbols= needs at least one ticker (up to 50)" });
        const out = await earningsCache.get(`s|${today}|${symbols.join(",")}`, () => upcomingForSymbols(src, symbols, today));
        return res.json(dropped ? { ...(out as object), dropped, note: `only the first 50 symbols were read; ${dropped} dropped` } : out);
      }
      const days = parseDays(req.query.days);
      return res.json(await earningsCache.get(`w|${today}|${days}`, () => upcomingWindow(src, days, today)));
    } catch (err) {
      return fail(res, err, "earnings read");
    }
  });

  return router;
}
