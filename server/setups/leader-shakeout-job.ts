/**
 * The Leader Shakeout job: after each close, every symbol MarketFlow keeps daily bars for (historical_bars), every
 * session that has no finished run yet. The first run therefore backfills the whole stored history; later runs do
 * the new day (and any day a missed evening left behind).
 *
 * A day is only done once its bars are in: the newest session waits until it has bars for at least 90% of the
 * symbols the session before it had (the bar cron writes symbol by symbol). A symbol is skipped on a day when its
 * stored bars miss a session inside the 21-day window, or the day looks like a split cliff in the stored history;
 * the run row counts both.
 */
import { contiguous, looksLikeSplit, RESEARCH_ETFS, volumePrev, type DBar } from "./daily-math";
import { evaluateAt, LOOKBACK, prepare, RULE_VERSION } from "./leader-shakeout";
import { addBreadth, labelDates, type Breadth, type MarketLabel } from "./market-label";
import type { RunRow, SetupStore, ShakeoutRow } from "./store";

export const SETUP = "leader_shakeout";
/** Sessions of history loaded before the first day to compute: 21 for the rule, 50 + 21 for breadth's 50-day. */
const WARMUP_SESSIONS = 75;
const SYMBOL_BATCH = 150;
const COMPLETE_SHARE = 0.9;

export interface BarSource {
  /** Market sessions MarketFlow has bars for (SPY's dates in historical_bars), oldest first. */
  sessions(): Promise<string[]>;
  symbols(): Promise<string[]>;
  countOn(date: string): Promise<number>;
  /** Daily bars on or after `from`, oldest first, per symbol. */
  bars(symbols: string[], from: string): Promise<Map<string, DBar[]>>;
  /** SPY, QQQ, IWM, VIXY daily bars on or after `from` (for the market label). Empty object when unavailable. */
  indexBars(from: string): Promise<Record<string, DBar[]>>;
  themes(symbol: string): { id: string; name: string }[];
  /** MarketFlow's own regime label (RAI) for that date, when the job runs on the day itself. */
  mfRegime(date: string): string | null;
  /** True when the job should stop between batches (memory pressure). */
  shouldStop?(): boolean;
}

export interface ScanResult {
  dates: string[];
  hits: number;
  waiting: string | null;
  stopped: boolean;
}

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export async function scanLeaderShakeout(
  src: BarSource,
  store: SetupStore,
  opts: { source?: RunRow["source"]; today?: string; maxDates?: number } = {},
): Promise<ScanResult> {
  const sessions = await src.sessions();
  const out: ScanResult = { dates: [], hits: 0, waiting: null, stopped: false };
  if (sessions.length <= LOOKBACK) return out;
  const done = await store.doneDates(SETUP, RULE_VERSION);
  let todo = sessions.slice(LOOKBACK).filter((d) => !done.has(d));
  if (!todo.length) return out;

  // the newest session waits for its bars
  const last = sessions[sessions.length - 1];
  if (todo.includes(last)) {
    const [nLast, nPrev] = [await src.countOn(last), await src.countOn(sessions[sessions.length - 2])];
    if (nLast < COMPLETE_SHARE * nPrev) {
      todo = todo.filter((d) => d !== last);
      out.waiting = `${last}: bars for ${nLast} of ${nPrev} symbols so far`;
    }
  }
  if (opts.maxDates && todo.length > opts.maxDates) todo = todo.slice(0, opts.maxDates);
  if (!todo.length) return out;

  const sessionIndex = new Map(sessions.map((d, k) => [d, k]));
  const want = new Set(todo);
  const from = sessions[Math.max(0, sessionIndex.get(todo[0])! - WARMUP_SESSIONS)];
  const symbols = (await src.symbols()).filter((s) => !RESEARCH_ETFS.has(s.toUpperCase()));

  const breadth: Breadth = new Map();
  const scanned = new Map<string, number>();
  const gaps = new Map<string, number>();
  const splits = new Map<string, string[]>();
  const hits: Omit<ShakeoutRow, "marketLabel" | "source">[] = [];
  const bump = (m: Map<string, number>, d: string) => m.set(d, (m.get(d) ?? 0) + 1);

  for (let k = 0; k < symbols.length; k += SYMBOL_BATCH) {
    if (src.shouldStop?.()) { out.stopped = true; return out; }
    const batch = await src.bars(symbols.slice(k, k + SYMBOL_BATCH), from);
    for (const [sym, b] of batch) {
      if (b.length <= LOOKBACK) continue;
      addBreadth(breadth, b, (i) => (i >= 21 ? volumePrev(b, i).dollarVol : NaN));
      const p = prepare(b);
      for (let i = LOOKBACK; i < b.length; i++) {
        const d = b[i].date;
        if (!want.has(d)) continue;
        if (!contiguous(b, i, LOOKBACK, sessionIndex)) { bump(gaps, d); continue; }
        if (looksLikeSplit(b[i - 1].close, b[i].open, b[i].close)) { splits.set(d, [...(splits.get(d) ?? []), sym]); continue; }
        bump(scanned, d);
        const r = evaluateAt(p, i);
        if (!r?.hit) continue;
        const { hit: _h, failed: _f, ...numbers } = r;
        hits.push({
          ...numbers,
          symbol: sym.toUpperCase(),
          ruleVersion: RULE_VERSION,
          themes: src.themes(sym),
          themesAsOf: opts.today ?? null,
          mfRegime: src.mfRegime(d),
        });
      }
    }
  }

  let labels = new Map<string, MarketLabel>();
  try {
    labels = labelDates(await src.indexBars(addDays(todo[0], -420)), breadth, want);
  } catch (err) {
    console.warn("[LeaderShakeout] market label unavailable:", err);
  }

  for (const d of todo) {
    // a scheduled run labels its older days (the first run's backfill, a missed evening) as backfill
    const source = (opts.source ?? "daily") === "daily" && d !== last ? "backfill" : opts.source ?? "daily";
    const lab = labels.get(d) ?? null;
    const dayHits = hits.filter((h) => h.date === d).map((h) => ({ ...h, marketLabel: lab?.label ?? null, source }));
    out.hits += await store.insertShakeouts(dayHits);
    await store.insertRun({
      setup: SETUP,
      ruleVersion: RULE_VERSION,
      marketDate: d,
      symbolsScanned: scanned.get(d) ?? 0,
      hits: dayHits.length,
      skipped: { missingSession: gaps.get(d) ?? 0, splitCliff: splits.get(d) ?? [] },
      marketLabel: lab?.label ?? null,
      marketInputs: lab,
      source,
    });
    out.dates.push(d);
  }
  return out;
}
