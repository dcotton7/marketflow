/**
 * Read routes built for Quinn's reach into MarketFlow (docs/gateway-reads.md), mounted at /api/market-condition before
 * the market-condition router (so /themes/move is not read as a theme id). Owner data: the access rule for
 * /api/market-condition covers them. Reads only, from stored data; each answer is kept a short while in memory.
 *
 *   GET /earnings/upcoming?symbols=A,B (<= 50)  |  ?days=N (1-30, the liquid universe)
 *   GET /themes/move?from=&to=[&group=theme|sector|size][&ids=A,B]
 *   GET /themes/velocity?window=5|15|30|60[&at=][&group=..][&limit=..][&ids=..]
 */
import { Router, type Request, type Response } from "express";
import { getDb } from "../db";
import { getEtClock } from "@shared/usEquityMarketSession";
import { parseDays, parseSymbols, pgEarningsSource, upcomingForSymbols, upcomingWindow, type EarningsSource } from "./earnings";
import { GROUPS, parseInstant, pgHistorySource, Refusal, themeMove, velocity, type Group, type HistorySource } from "./theme-history";

type Deps = { earnings?: () => EarningsSource | null; history?: () => HistorySource | null; names?: (id: string) => string; now?: () => Date };

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

let themeNames: ((id: string) => string) | null = null;
async function defaultNames(): Promise<(id: string) => string> {
  if (themeNames) return themeNames;
  const { CLUSTERS } = await import("../market-condition/universe");
  const map = new Map(CLUSTERS.map((c) => [String(c.id), c.name]));
  themeNames = (id) => map.get(id) ?? id;
  return themeNames;
}

async function themeMembersNow(): Promise<Map<string, string[]>> {
  // loaded on use, so the tests never load the theme engine
  const out = new Map<string, string[]>();
  try {
    const { CLUSTER_IDS } = await import("../market-condition/universe");
    const { getThemeMembersFromCache } = await import("../market-condition/utils/theme-db-loader");
    for (const id of CLUSTER_IDS) out.set(String(id), getThemeMembersFromCache(id).map((m) => String(m.symbol).toUpperCase()));
  } catch { /* none */ }
  return out;
}

const idsOf = (raw: unknown) => {
  const ids = String(raw ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9 &_.-]{1,40}$/.test(s));
  return ids.length ? new Set(ids.slice(0, 60)) : null;
};
const groupOf = (raw: unknown): Group | null => {
  const g = String(raw ?? "theme").toLowerCase();
  return (GROUPS as string[]).includes(g) ? (g as Group) : null;
};

export function gatewayReadRoutes(deps: Deps = {}): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  const earningsSrc = deps.earnings ?? (() => { const db = getDb(); return db ? pgEarningsSource(db) : null; });
  const historySrc = deps.history ?? (() => { const db = getDb(); return db ? pgHistorySource(db, { themeMembersNow }) : null; });
  const earningsCache = ttlCache<unknown>(10 * 60_000);
  const moveCache = ttlCache<unknown>(5 * 60_000);
  const velocityCache = ttlCache<unknown>(60_000);
  const names = async (g: Group) => (g === "theme" ? deps.names ?? (await defaultNames()) : (id: string) => id);

  const fail = (res: Response, err: unknown, what: string) => {
    if (err instanceof Refusal) return res.status(err.status).json({ error: err.message, ...err.extra });
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

  router.get("/themes/move", async (req: Request, res: Response) => {
    const g = groupOf(req.query.group);
    if (!g) return res.status(400).json({ error: "group must be theme, sector or size" });
    const from = parseInstant(req.query.from), to = parseInstant(req.query.to);
    if (!from || !to) return res.status(400).json({ error: "from and to are required: YYYY-MM-DD (that day's close) or YYYY-MM-DDTHH:MM (New York time, or with Z / an offset)" });
    const src = historySrc();
    if (!src) return res.status(503).json({ error: "database unavailable" });
    const ids = idsOf(req.query.ids);
    try {
      const nm = await names(g);
      const key = `${g}|${from.raw}|${to.raw}|${[...(ids ?? [])].join(",")}`;
      return res.json(await moveCache.get(key, () => themeMove(src, g, from, to, { ids, names: nm, now: now() })));
    } catch (err) {
      return fail(res, err, "move read");
    }
  });

  router.get("/themes/velocity", async (req: Request, res: Response) => {
    const g = groupOf(req.query.group);
    if (!g) return res.status(400).json({ error: "group must be theme, sector or size" });
    const windowMin = Number(req.query.window ?? 15);
    const at = req.query.at === undefined ? now() : parseInstant(req.query.at)?.at ?? null;
    if (!at) return res.status(400).json({ error: "at must be YYYY-MM-DDTHH:MM (New York time, or with Z / an offset)" });
    const limit = Math.floor(Number(req.query.limit ?? 50)) || 50;
    const src = historySrc();
    if (!src) return res.status(503).json({ error: "database unavailable" });
    const ids = idsOf(req.query.ids);
    try {
      const nm = await names(g);
      const key = `${g}|${windowMin}|${Math.floor(at.getTime() / 60_000)}|${limit}|${[...(ids ?? [])].join(",")}`;
      return res.json(await velocityCache.get(key, () => velocity(src, g, windowMin, at, { limit, names: nm, ids })));
    } catch (err) {
      return fail(res, err, "velocity read");
    }
  });

  return router;
}
