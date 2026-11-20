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
import { EG, EG_RULE_VERSION, EG_SETUP, ensureEgTables } from "./earnings-gap-up";
import { upcomingStatus } from "../earnings/upcoming";
import { secUserAgent } from "../earnings/sec";

const router = Router();
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
    const rows = rowsOf(await db.execute(
      sql`SELECT market_date, symbol, close, prev_close, open, volume, drop_pct, drop_atr, atr14_prev, rel_volume, avg_vol20_prev, run20, rsi2, dollar_vol20_prev, gap_atr, liquid, gapped, themes, themes_as_of, market_label, mf_regime, source FROM setup_leader_shakeout WHERE rule_version = ${RULE_VERSION} AND market_date BETWEEN ${range.from} AND ${range.to} ORDER BY market_date, drop_atr DESC`,
    ));
    res.json({ rule: { version: RULE_VERSION, text: RULE_TEXT }, ...range, runs, rows });
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
      sql`SELECT market_date, symbol, report_date, report_hour, hour_known, date_source, open, high, low, close, prev_close, volume, gap_pct, gap_atr, atr14_prev, clv, rel_volume, avg_vol20_prev, dollar_vol20_prev, day_change_pct, themes, themes_as_of, market_label, source FROM setup_earnings_gap_up WHERE rule_version = ${EG_RULE_VERSION} AND market_date BETWEEN ${range.from} AND ${range.to} ORDER BY market_date, gap_atr DESC`,
    ));
    res.json({ rule: { version: EG_RULE_VERSION, text: EG_TEXT }, ...range, runs, rows });
  } catch (err) {
    console.error("[Setups] earnings-gap-up read failed:", err);
    res.status(500).json({ error: "read failed" });
  }
});

router.get("/status", (_req: Request, res: Response) => {
  res.json({ jobs: getSetupJobStatus(), upcomingEarnings: upcomingStatus(), secJob: secUserAgent() ? "on" : "off (SEC_USER_AGENT is empty)" });
});

router.post("/run/:job", requireAdmin, async (req: Request, res: Response) => {
  res.json(await runSetupJob(String(req.params.job), "manual"));
});

export default router;
