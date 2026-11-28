/**
 * The pass list, read only (mounted at /api/triggers; through the Anima gateway as /api/anima/triggers).
 *
 *   GET /api/triggers?since=<cursor>&grade=A,B&side=long|short&setup=<key>&limit=100&day=YYYY-MM-DD
 *       Candidates with id > since, newest first in the answer, at most `limit` (1-500). Default grades A and B
 *       ("all" or a list). `next_cursor` is the highest id in the answer: pass it as `since` next time; `has_more`
 *       says more rows wait after it (ask again at once). Built-in setups' candidates are the same for every account;
 *       a user's own setups' candidates are served to that account only.
 *   GET /api/triggers/status
 *       Whether it runs, its state and why, last pass, bars lag, universe size, today's counts by setup and grade.
 *
 * With TRIGGER_SCANNER off both answer 404 and touch nothing.
 */
import { Router, type Request, type Response } from "express";
import { gradesWanted } from "../setups/grades";
import { getEtClock } from "@shared/usEquityMarketSession";
import { listSetups } from "./registry";
import { RULE_VERSION, scannerEnabled } from "./settings";
import type { ScannerStatus } from "./scheduler";
import type { StoredCandidate, TriggerStore } from "./store";

export interface RouteDeps {
  enabled(): boolean;
  store(): TriggerStore | null;
  status(): ScannerStatus | null;
  now?(): Date;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function present(c: StoredCandidate) {
  return {
    id: c.id,
    symbol: c.symbol,
    side: c.side,
    setup_key: c.setupKey,
    setup_owner: c.setupOwner,
    variant: c.variant,
    grade: c.grade,
    grade_points: c.gradePoints,
    grade_components: c.gradeComponents,
    trigger_at: c.triggerAt,
    why: c.why,
    entry_ref: c.entryRef,
    stop: { level: c.stopLevel, level_price: c.stopLevelPrice, price: c.stopPrice, gap: c.stopGap },
    risk_pct: c.riskPct,
    risk_adr: c.riskAdr,
    adr_pct: c.adrPct,
    rel_volume: c.relVolume,
    trigger_bar: c.bar,
    levels: c.levels,
    liquidity: c.liquidity,
    regime: c.regime,
    cap_size: c.capSize,
    sector: c.sector,
    group_leading: c.groupLeading,
    rotation: c.rotation,
    data_as_of: c.dataAsOf,
    facts: c.facts,
    dedupe_key: c.dedupeKey,
    market_date: c.marketDate,
    rule_version: c.ruleVersion,
    // trend facts (trend.ts), measured, never a filter; null on rows stored before 031
    trend: c.trend ?? null,
  };
}

export function createTriggerRoutes(deps: RouteDeps): Router {
  const router = Router();
  const hidden = (res: Response) => res.status(404).json({ error: "Not found" });
  const viewer = (req: Request): number | null => {
    const id = Number((req as any).session?.userId);
    return Number.isInteger(id) && id > 0 ? id : null;
  };
  const today = () => getEtClock(deps.now?.() ?? new Date()).dateKey;

  router.get("/", async (req: Request, res: Response) => {
    if (!deps.enabled()) return hidden(res);
    const store = deps.store();
    if (!store) return res.status(503).json({ error: "Database not available" });
    const since = Math.max(0, Math.floor(Number(req.query.since ?? 0)) || 0);
    const limit = Math.min(500, Math.max(1, Math.floor(Number(req.query.limit ?? 100)) || 100));
    const side = req.query.side === "long" || req.query.side === "short" ? req.query.side : undefined;
    const setup = typeof req.query.setup === "string" && /^[a-z0-9_]{1,40}$/.test(req.query.setup) ? req.query.setup : undefined;
    const day = typeof req.query.day === "string" && DAY.test(req.query.day) ? req.query.day : today();
    const grades = gradesWanted(req.query.grade);
    try {
      const rows = await store.listCandidates({ day, since, grades, side, setup, limit: limit + 1, viewerUserId: viewer(req) });
      const page = rows.slice(0, limit);
      const next = page.length ? page[page.length - 1].id : since;
      res.json({
        as_of: (deps.now?.() ?? new Date()).toISOString(),
        market_date: day,
        rule_version: RULE_VERSION,
        filters: { grades, side: side ?? null, setup: setup ?? null },
        since,
        next_cursor: next,
        has_more: rows.length > limit,
        count: page.length,
        candidates: page.reverse().map(present),
      });
    } catch (err) {
      res.status(500).json({ error: "Read failed", detail: String(err).slice(0, 200) });
    }
  });

  router.get("/status", async (req: Request, res: Response) => {
    if (!deps.enabled()) return hidden(res);
    const st = deps.status();
    const store = deps.store();
    const day = st?.marketDate ?? today();
    let counts: { setupKey: string; grade: string; n: number }[] = [];
    let lastRun = null;
    try {
      if (store) {
        counts = await store.countsToday(day, viewer(req));
        lastRun = await store.lastRun();
      }
    } catch { /* status still answers */ }
    const bySetup: Record<string, Record<string, number>> = {};
    const byGrade: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const c of counts) {
      (bySetup[c.setupKey] ??= {})[c.grade] = c.n;
      byGrade[c.grade] = (byGrade[c.grade] ?? 0) + c.n;
    }
    res.json({
      as_of: (deps.now?.() ?? new Date()).toISOString(),
      enabled: true,
      running: st?.state === "running",
      state: st?.state ?? "not_started",
      why: st ? st.why : "the scanner has not started in this process",
      market_date: day,
      tier: st?.tier ?? null,
      tier_why: st?.tierWhy ?? null,
      last_pass_at: st?.lastPassAt ?? (lastRun ? lastRun.passAt.toISOString() : null),
      last_bar_close: st?.lastBarClose ?? null,
      bars_lag_sec: st?.barsLagSec ?? null,
      universe_size: st?.universeSize ?? null,
      day_loaded_at: st?.dayLoadedAt ?? null,
      day_load_skipped: st?.dayLoadSkipped ?? {},
      watching_daily_setups: st?.watching ?? 0,
      user_setups: st?.userSetups ?? [],
      bars_in_memory: st?.barsInMemory ?? 0,
      requests_today: st?.requestsToday ?? 0,
      stored_today: st?.storedToday ?? 0,
      over_daily_cap_today: st?.overCapToday ?? 0,
      fetch_failures_today: st?.fetchFailuresToday ?? 0,
      last_error: st?.lastError ?? null,
      last_pass: st?.lastPass ?? null,
      regime: st?.regime ?? null,
      rotation: st?.rotation ?? null,
      today: { by_setup: bySetup, by_grade: byGrade, total: counts.reduce((n, c) => n + c.n, 0) },
      setups: listSetups().map((s) => ({ key: s.key, owner: s.owner, side: s.side, description: s.description, tested: s.tested, dedupe_min: s.dedupeMin, params: s.params })),
      rule_version: RULE_VERSION,
    });
  });

  return router;
}

/** The live router: flag from the environment, store on the app's database, status from this process's scanner. */
export async function liveTriggerRoutes(): Promise<Router> {
  const { getDb } = await import("../db");
  const { pgTriggerStore } = await import("./store");
  const { getScanner } = await import("./scheduler");
  let store: TriggerStore | null = null;
  return createTriggerRoutes({
    enabled: () => scannerEnabled(),
    store: () => {
      if (store) return store;
      const db = getDb();
      return db ? (store = pgTriggerStore(db as any)) : null;
    },
    status: () => getScanner()?.status ?? null,
  });
}
