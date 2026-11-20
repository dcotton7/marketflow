/**
 * Read routes for the research-backed daily setups, mounted at /api/market-condition/setups (owner data: the
 * access rule for /api/market-condition covers them; Trading Buddy reads them through the Anima gateway).
 *
 *   GET  /leader-shakeout?date=YYYY-MM-DD           hits for one session
 *   GET  /leader-shakeout?from=YYYY-MM-DD&to=...    hits for a range (at most 400 days)
 *        Both return { rule, from, to, runs, rows }: runs says which sessions were scanned (with the symbol count
 *        and that day's market label), so "scanned, nothing hit" differs from "not scanned yet".
 *   GET  /status                                     the jobs' last run
 *   POST /run/:job                                   admin: run a job now (it does only the days not yet done)
 */
import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { requireAdmin } from "../middleware/requireAdmin";
import { LS, RULE_VERSION } from "./leader-shakeout";
import { SETUP } from "./leader-shakeout-job";
import { getSetupJobStatus, runSetupJob } from "./jobs";
import { ensureSetupTables, rowsOf } from "./store";
import { parseRange } from "./routes-helpers";
import { manualOverride, refreshMarketCaps } from "../market-condition/utils/market-cap-refresh";
import { byGrade, flags, gradesWanted, loadGradeSettings, parseSettings, saveGradeSettings, type GradeSettings } from "./grades";
import { EG, EG_RULE_VERSION, EG_SETUP, ensureEgTables } from "./earnings-gap-up";
import { upcomingStatus } from "../earnings/upcoming";
import { secUserAgent } from "../earnings/sec";
import { ensureCardTables } from "./market-card-job";
import { CARD_VERSION } from "./market-card";

const router = Router();
const GRADE_TEXT = (g: GradeSettings) =>
  `Every hit is the base rule. liquid = 20-day average dollar volume >= $${g.liquidDollarVol / 1e6}M; gapped = opened at least ${g.gapAtr} ATR below the prior close. ` +
  `Grade A = both, B = one, C = neither. Rows come grade A first, then B; C only with grades=all (or grades=C). Grades use the current settings; grade_stored is the grade when the row was written.`;
const STOP_TEXT =
  `stop_levels: each of the 50-day, 20-day, 5-day and 10-day averages (closes, including the hit day), the low of the day, the previous day's low and the day's VWAP that sits below the close, ` +
  `with its distance from the close in percent. stop_first = the first in that order within 5% of the close; none = "no logical stop inside 5%". Levels and distances only.`;

const RULE_TEXT =
  `Leader Shakeout (research S1): close >= $${LS.minPrice}, prior 20-day average dollar volume >= $${LS.minDollarVol / 1e6}M, ` +
  `a one-day fall of at least ${LS.minDropAtr} x the prior 14-day ATR and at least ${-LS.maxRet * 100}%, on at least ${LS.minRelVol} x the prior 20-day average volume, ` +
  `after a rise of more than ${LS.minRun20 * 100}% over the 20 sessions before the drop, with Wilder RSI(2) under ${LS.maxRsi2}. ` +
  `liquid = 20-day dollar volume >= $${LS.liquidDollarVol / 1e6}M; gapped = opened at least ${-LS.gapAtr} ATR below the prior close. ` +
  `History (research): a 3-5 day rebound watch, not a next-day signal; weak in a strong AGGRESSIVE tape; lost money in 2022.`;

router.get("/leader-shakeout", async (req: Request, res: Response) => {
  const range = parseRange(req.query as Record<string, unknown>);
  if ("error" in range) return res.status(400).json(range);
  const db = getDb();
  if (!db) return res.status(503).json({ error: "database unavailable" });
  try {
    await ensureSetupTables(db);
    const runs = rowsOf(await db.execute(
      sql`SELECT market_date, symbols_scanned, hits, market_label, skipped, source FROM setup_scan_runs WHERE setup = ${SETUP} AND rule_version = ${RULE_VERSION} AND market_date BETWEEN ${range.from} AND ${range.to} ORDER BY market_date`,
    ));
    const gs = await loadGradeSettings(db);
    const want = gradesWanted((req.query as any).grades);
    const all = rowsOf(await db.execute(
      sql`SELECT market_date, symbol, close, prev_close, open, volume, drop_pct, drop_atr, atr14_prev, rel_volume, avg_vol20_prev, run20, rsi2, dollar_vol20_prev, gap_atr, grade AS grade_stored, grade_settings, vwap, stop_levels, stop_first, stop_first_dist_pct, no_stop_inside_5, themes, themes_as_of, market_label, mf_regime, source FROM setup_leader_shakeout WHERE rule_version = ${RULE_VERSION} AND market_date BETWEEN ${range.from} AND ${range.to}`,
    )).map((r) => ({ ...r, ...flags(Number(r.dollar_vol20_prev), Number(r.gap_atr), gs), stop_note: r.no_stop_inside_5 ? "no logical stop inside 5%" : null }));
    const counts = { A: 0, B: 0, C: 0 } as Record<string, number>;
    for (const r of all) counts[r.grade]++;
    const rows = byGrade(all.filter((r) => want.includes(r.grade)));
    res.json({ rule: { version: RULE_VERSION, text: RULE_TEXT, grades: GRADE_TEXT(gs), stops: STOP_TEXT }, ...range, grades: want, counts, runs, rows });
  } catch (err) {
    console.error("[Setups] leader-shakeout read failed:", err);
    res.status(500).json({ error: "read failed" });
  }
});

const EG_TEXT =
  `Earnings gap up that holds (research A6, real earnings dates): on the first session that could react to an earnings release, ` +
  `opened at least ${EG.minGapAtr} ATR and ${EG.minGapPct * 100}% above the prior close, closed above the open in the upper half of the range, ` +
  `on at least ${EG.minRelVol}x the prior 20-day average volume; price >= $${EG.minPrice}, 20-day dollar volume >= $${EG.minDollarVol / 1e6}M. ` +
  `date_source: sec_8k (8-K item 2.02 acceptance time) or finnhub_calendar (MarketFlow's daily calendar, listed before the date; hour_known false = the release time was not given). ` +
  `History (research): 5-day mean +0.27% / +0.68% (earlier / later), 20-day +2.2% / +3.1%; not a buy signal.`;

router.get("/earnings-gap-up", async (req: Request, res: Response) => {
  const range = parseRange(req.query as Record<string, unknown>);
  if ("error" in range) return res.status(400).json(range);
  const db = getDb();
  if (!db) return res.status(503).json({ error: "database unavailable" });
  try {
    await ensureSetupTables(db);
    await ensureEgTables(db);
    const runs = rowsOf(await db.execute(
      sql`SELECT setup, market_date, symbols_scanned, hits, market_label, source FROM setup_scan_runs WHERE setup LIKE ${EG_SETUP + ":%"} AND rule_version = ${EG_RULE_VERSION} AND market_date BETWEEN ${range.from} AND ${range.to} ORDER BY market_date, setup`,
    ));
    const rows = rowsOf(await db.execute(
      sql`SELECT market_date, symbol, report_date, report_hour, hour_known, date_source, open, high, low, close, prev_close, volume, gap_pct, gap_atr, atr14_prev, clv, rel_volume, avg_vol20_prev, dollar_vol20_prev, day_change_pct, vwap, stop_levels, stop_first, stop_first_dist_pct, no_stop_inside_5, CASE WHEN no_stop_inside_5 THEN 'no logical stop inside 5%' END AS stop_note, themes, themes_as_of, market_label, source FROM setup_earnings_gap_up WHERE rule_version = ${EG_RULE_VERSION} AND market_date BETWEEN ${range.from} AND ${range.to} ORDER BY market_date, gap_atr DESC`,
    ));
    res.json({ rule: { version: EG_RULE_VERSION, text: EG_TEXT, stops: STOP_TEXT }, ...range, runs, rows });
  } catch (err) {
    console.error("[Setups] earnings-gap-up read failed:", err);
    res.status(500).json({ error: "read failed" });
  }
});

/** GET /market-card?date=YYYY-MM-DD (or from=&to=; no date = the latest): the day's market card and watch list. */
router.get("/market-card", async (req: Request, res: Response) => {
  const q = req.query as Record<string, unknown>;
  const db = getDb();
  if (!db) return res.status(503).json({ error: "database unavailable" });
  try {
    await ensureCardTables(db);
    if (!q.date && !q.from) {
      const r = rowsOf(await db.execute(sql`SELECT market_date, label, card, watch, source, created_at FROM market_card_daily WHERE version = ${CARD_VERSION} ORDER BY market_date DESC LIMIT 1`));
      return res.json({ version: CARD_VERSION, rows: r });
    }
    const range = parseRange(q);
    if ("error" in range) return res.status(400).json(range);
    const r = rowsOf(await db.execute(sql`SELECT market_date, label, card, watch, source, created_at FROM market_card_daily WHERE version = ${CARD_VERSION} AND market_date BETWEEN ${range.from} AND ${range.to} ORDER BY market_date`));
    res.json({ version: CARD_VERSION, ...range, rows: r });
  } catch (err) {
    console.error("[Setups] market-card read failed:", err);
    res.status(500).json({ error: "read failed" });
  }
});

router.get("/status", (_req: Request, res: Response) => {
  res.json({ jobs: getSetupJobStatus(), upcomingEarnings: upcomingStatus(), secJob: secUserAgent() ? "on" : "off (SEC_USER_AGENT is empty)" });
});

/** GET /settings: the grade thresholds now in use. PUT (admin) { liquidDollarVol, gapAtr }: change them. */
router.get("/settings", async (_req: Request, res: Response) => {
  res.json({ grades: await loadGradeSettings(getDb()) });
});
router.put("/settings", requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: "database unavailable" });
  const s = parseSettings({ ...(await loadGradeSettings(db)), ...(req.body ?? {}) });
  await saveGradeSettings(db, s);
  res.json({ grades: s });
});

/**
 * POST /market-caps/refresh?dryRun=1 (admin): the market cap refresh (market-condition/utils/market-cap-refresh.ts).
 * dryRun=1 prints and returns the plan and counts and writes nothing; without it, it appends market_cap_history
 * and updates tickers. One at a time.
 */
let capsRunning = false;
router.post("/market-caps/refresh", requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: "database unavailable" });
  if (capsRunning) return res.status(409).json({ error: "already running" });
  capsRunning = true;
  try {
    const yes = (v: unknown) => ["1", "true", "yes"].includes(String(v ?? "").toLowerCase());
    // bigStoredRule=1 switches on the big-stored rule (off by default; every run lists what it would touch)
    res.json(await refreshMarketCaps(db, { dryRun: yes(req.query.dryRun), bigStoredRule: yes(req.query.bigStoredRule) }));
  } catch (err) {
    console.error("[MarketCaps] refresh failed:", err);
    res.status(500).json({ error: String(err).slice(0, 200) });
  } finally {
    capsRunning = false;
  }
});

/** POST /market-caps/override (admin) { symbol, marketCap, reason }: a one-off manual correction, kept in history. */
router.post("/market-caps/override", requireAdmin, async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: "database unavailable" });
  const r = await manualOverride(db, req.body ?? {});
  res.status(r.ok ? 200 : 400).json(r);
});

router.post("/run/:job", requireAdmin, async (req: Request, res: Response) => {
  res.json(await runSetupJob(String(req.params.job), "manual"));
});

export default router;
