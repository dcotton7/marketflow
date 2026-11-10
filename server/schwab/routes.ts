import type { Express, Request, Response } from "express";
import { SchwabSignedOut } from "./auth";
import { checkState, makeState } from "./config";
import { balancesFrom, positionsFrom, SchwabHttpError } from "./rest";
import { schwab } from "./service";

/**
 * Schwab routes (docs/schwab-readonly.md). Every Schwab call they make is a GET; the only POSTs here are
 * MarketFlow's own: Disconnect (deletes the stored tokens) and Sync now (writes the "Schwab positions" list).
 * Access (dataAccess.ts): /api/schwab/* is owner only, except the OAuth callback, which proves the user with the
 * signed state; /api/health/schwab is public and carries no account data.
 */
const SETTINGS = "/sentinel/settings";
const SYM = /^[A-Z0-9.^/$-]{1,15}$/;

function fail(res: Response, err: unknown) {
  if (err instanceof SchwabSignedOut) return res.status(409).json({ error: err.message, state: err.state });
  if (err instanceof SchwabHttpError) return res.status(502).json({ error: err.message });
  console.warn("[Schwab] route failed:", (err as Error)?.message ?? err);
  return res.status(500).json({ error: "Schwab request failed" });
}

function userOf(req: Request): number | null {
  const id = (req as any).session?.userId;
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerSchwabRoutes(app: Express): void {
  app.get("/api/health/schwab", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await schwab.health().catch(() => ({ enabled: schwab.cfg.enabled, state: "error" })));
  });

  // Everything else answers only when the flag is on and the keys are set.
  app.use("/api/schwab", (req, res, next) => {
    if (req.path === "/status" || schwab.ready) return next();
    return res.status(404).json({ error: "Schwab link is off" });
  });

  app.get("/api/schwab/status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const health = await schwab.health(userOf(req) ?? undefined);
    const conn = schwab.store && userOf(req) ? await schwab.store.load(userOf(req)!) : null;
    res.json({ ...health, syncWatchlistId: conn?.syncWatchlistId ?? null, lastSyncAt: conn?.lastSyncAt ? new Date(conn.lastSyncAt).toISOString() : null, lastSync: schwab.lastSync });
  });

  app.get("/api/schwab/connect", (req, res) => {
    const id = userOf(req);
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    res.redirect(schwab.tokens!.authorizeUrl(makeState(schwab.cfg.tokenKey!, id)));
  });

  app.get("/api/schwab/callback", async (req, res) => {
    const id = checkState(schwab.cfg.tokenKey!, req.query.state);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!id || !code) return res.redirect(`${SETTINGS}?schwab=failed`);
    try {
      await schwab.tokens!.exchangeCode(id, code);
      schwab.begin(id);
      res.redirect(`${SETTINGS}?schwab=connected`);
    } catch (err) {
      console.warn("[Schwab] sign-in failed:", (err as Error)?.message ?? err);
      res.redirect(`${SETTINGS}?schwab=failed`);
    }
  });

  app.post("/api/schwab/disconnect", async (req, res) => {
    const id = userOf(req);
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    schwab.stop();
    await schwab.tokens!.disconnect(id);
    res.json({ ok: true });
  });

  app.post("/api/schwab/sync", async (_req, res) => {
    try {
      res.json(await schwab.sync());
    } catch (err) {
      fail(res, err);
    }
  });

  // Positions and balances come from one accounts read; 20 s of cache keeps Quinn and the page under the budget.
  let accountsCache: { id: number; at: number; data: Promise<any> } | null = null;
  const accounts = (id: number) => {
    if (!accountsCache || accountsCache.id !== id || Date.now() - accountsCache.at > 20_000) {
      const data = schwab.rest(id).accounts();
      data.catch(() => { accountsCache = null; });
      accountsCache = { id, at: Date.now(), data };
    }
    return accountsCache.data;
  };

  const read = (fn: (req: Request, userId: number) => Promise<unknown>) => async (req: Request, res: Response) => {
    const id = userOf(req);
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    try {
      res.json(await fn(req, id));
    } catch (err) {
      fail(res, err);
    }
  };

  app.get("/api/schwab/positions", read(async (_req, id) => ({ positions: positionsFrom(await accounts(id)) })));
  app.get("/api/schwab/balances", read(async (_req, id) => ({ balances: balancesFrom(await accounts(id)) })));
  app.get("/api/schwab/quotes", read(async (req, id) => {
    const symbols = String(req.query.symbols ?? "").toUpperCase().split(",").map((s) => s.trim()).filter((s) => SYM.test(s)).slice(0, 100);
    return { quotes: await schwab.rest(id).quotes(symbols) };
  }));
  app.get("/api/schwab/orders", read(async (req, id) => {
    const days = Math.min(60, Math.max(1, Number(req.query.days) || 7));
    const to = new Date(), from = new Date(to.getTime() - days * 86_400_000);
    const rest = schwab.rest(id);
    const accounts = await rest.accountNumbers();
    const out = [];
    for (const a of accounts) out.push({ account: `…${a.accountNumber.slice(-4)}`, orders: await rest.orders(a.hashValue, from.toISOString(), to.toISOString()) });
    return { days, accounts: out };
  }));
  app.get("/api/schwab/transactions", read(async (req, id) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const to = new Date(), from = new Date(to.getTime() - days * 86_400_000);
    const rest = schwab.rest(id);
    const accounts = await rest.accountNumbers();
    const out = [];
    for (const a of accounts) out.push({ account: `…${a.accountNumber.slice(-4)}`, transactions: await rest.transactions(a.hashValue, from.toISOString(), to.toISOString()) });
    return { days, accounts: out };
  }));
  app.get("/api/schwab/history/:symbol", read(async (req, id) => {
    const symbol = String(req.params.symbol).toUpperCase();
    if (!SYM.test(symbol)) throw new SchwabHttpError(400, "history");
    const minute = req.query.frequency === "minute";
    return schwab.rest(id).priceHistory(symbol, minute
      ? { periodType: "day", period: Math.min(10, Number(req.query.period) || 1), frequencyType: "minute", frequency: 1 }
      : { periodType: "year", period: 1, frequencyType: "daily", frequency: 1 });
  }));
}
