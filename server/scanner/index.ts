// ---------------------------------------------------------------------------
// Discovery Scanner — main entry point
//
// Initializes the scanner, registers the MC post-refresh callback,
// and orchestrates the signal → pipeline → reaction → SSE broadcast flow.
// ---------------------------------------------------------------------------

import type { ScannerMode, MarketSession, DiscoveryCard, Signal } from "@shared/scanner-types";
import type { ThemeMetrics } from "../market-condition/engine/theme-score";
import { registerPostRefreshCallback } from "../market-condition/engine/snapshot";
import {
  processSnapshot,
  setFiveDayHighLow,
  onLodBounceGaveUp,
  getFrame,
  getBufferLength,
  currentFrame,
  type SnapshotFrame,
  type TickerFrame,
  type ThemeFrame,
} from "./signal-producer";
import { routeSignals, getActivePipelines, clearPipelineCooldown } from "./pipeline-router";
import { executeReactions } from "./reactions";
import { broadcastBatch, broadcastClear, pushDiscoveries, removeDiscoveries } from "./routes";
import {
  trackLodBounceDiscoveries,
  evaluateActiveLodBounces,
} from "./active-lod-bounces";
import type { LensContext } from "./lenses";
import { getCachedRAI } from "../market-condition/engine/rai";
import { getMaDataForScanner, getRawSnapshotsForScanner } from "../market-condition/engine/snapshot";
import {
  ensureSynced as ensureCatalystSynced,
  updateDecayWeights,
  evaluateForCatalysts,
  checkCatalystResolution,
  getCatalystBoost,
  seedDefaultCatalystRules,
  syncFromDb as syncCatalystsFromDb,
} from "./catalyst";
import { captureSessionSegment } from "./session-segment-capture";
import { detectNewsAlerts } from "./news-detector";
import { createEarningsCatalyst } from "./catalyst/auto-detector";
import { startOutcomeTracker } from "./outcome-tracker";
import { startIpoDetector } from "./ipo-detector";

// ── Scanner state ───────────────────────────────────────────────────────────

let scannerMode: ScannerMode = "on";
let lastSignalAt: string | null = null;
let universeSize = 0;

export function getScannerState(): {
  mode: ScannerMode;
  universeSize: number;
  activePipelines: number;
  lastSignalAt: string | null;
  sessionMode: MarketSession;
} {
  return {
    mode: scannerMode,
    universeSize,
    activePipelines: getActivePipelines().length,
    lastSignalAt,
    sessionMode: getCurrentSession(),
  };
}

export function setScannerMode(mode: ScannerMode): void {
  const prev = scannerMode;
  scannerMode = mode;
  console.log(`[Scanner] Mode changed: ${prev} → ${mode}`);
}

function getCurrentSession(): MarketSession {
  const now = new Date();
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);

  const h = parseInt(et.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(et.find((p) => p.type === "minute")?.value ?? "0", 10);
  const day = et.find((p) => p.type === "weekday")?.value ?? "";

  if (["Sat", "Sun"].includes(day)) return "closed";
  const mins = h * 60 + m;
  if (mins < 4 * 60) return "closed";
  if (mins < 9 * 60 + 30) return "pre_market";
  if (mins < 10 * 60) return "open_drive";
  if (mins < 12 * 60) return "mid_morning";
  if (mins < 14 * 60) return "midday";
  if (mins < 15 * 60 + 30) return "power_hour";
  if (mins < 16 * 60) return "close";
  if (mins < 20 * 60) return "after_hours";
  return "closed";
}

// ── Frame builder ───────────────────────────────────────────────────────────

function buildSnapshotFrame(
  themeMetrics: ThemeMetrics[],
  snapshots: Map<string, any>,
  spyBenchmark: any
): SnapshotFrame {
  const maData = getMaDataForScanner();
  const rawSnaps = getRawSnapshotsForScanner();

  const tickers = new Map<string, TickerFrame>();
  snapshots.forEach((snap, symbol) => {
    const sym = symbol.toUpperCase();
    const ma = maData.get(sym);
    const raw = rawSnaps.get(sym) ?? rawSnaps.get(symbol);

    // Avg volume: prefer true 20d avg when present. Alpaca snapshots omit avgVolume,
    // so fall back to prior-day volume — a hard 0 here zeroed every LOD bounce / volume_spike.
    const avgVolume14d = [snap.avgVolume20D, snap.avgVolume, snap.prevDayVolume]
      .find((v): v is number => typeof v === "number" && v > 0) ?? 0;

    const prevClose = raw?.prevClose ?? 0;
    const priorDayDollarVol =
      prevClose > 0 && avgVolume14d > 0 ? prevClose * avgVolume14d : 0;

    tickers.set(sym, {
      price: snap.price ?? 0,
      changePct: snap.changePct ?? 0,
      volume: snap.volume ?? 0,
      avgVolume14d,
      priorDayDollarVol,
      extensionFrom20dAdr: (() => {
        const sma20 = ma?.sma20d;
        // ADR comes from session MA cache (historical_bars high−low). Alpaca
        // snapshots never set adr20/avgDailyRange — reading those left extension at 0 forever.
        const adr = ma?.adr20 ?? snap.adr20 ?? snap.avgDailyRange ?? null;
        if (sma20 == null || sma20 <= 0 || adr == null || adr <= 0) return 0;
        const price = snap.price ?? 0;
        return (price - sma20) / adr;
      })(),
      prevClose,
      todayOpen: raw?.open ?? 0,
      todayHigh: raw?.high ?? 0,
      todayLow: raw?.low ?? 0,
      sma20d: ma?.sma20d ?? null,
      sma50d: ma?.sma50d ?? null,
      sma200d: ma?.sma200d ?? null,
      prevDayHigh: raw?.prevDayHigh ?? 0,
      prevDayLow: raw?.prevDayLow ?? 0,
    });
  });

  const themes = new Map<string, ThemeFrame>();
  for (const tm of themeMetrics) {
    themes.set(tm.id, {
      score: tm.score,
      acceleration: tm.acceleration,
      membersUp: tm.greenCount,
      membersDown: tm.totalCount - tm.greenCount,
      memberCount: tm.totalCount,
      rank: tm.rank ?? 0,
      percentile: tm.percentile ?? 0,
    });
  }

  const rai = getCachedRAI();
  const raiScore = rai?.score ?? 50;
  const regime = rai?.label ?? "NEUTRAL";

  return {
    timestamp: new Date(),
    tickers,
    themes,
    rai: raiScore,
    regime,
    spyChangePct: spyBenchmark?.changePct ?? 0,
  };
}

// ── Main processing callback ────────────────────────────────────────────────

async function onSnapshotRefreshed(
  themeMetrics: ThemeMetrics[],
  snapshots: Map<string, any>,
  spyBenchmark: any
): Promise<void> {
  if (scannerMode === "off") return;

  const session = getCurrentSession();
  if (session === "closed") return;

  try {
    const frame = buildSnapshotFrame(themeMetrics, snapshots, spyBenchmark);
    universeSize = frame.tickers.size;

    // Capture session segment data for multi-day pattern tracking
    const spyTick = frame.tickers.get("SPY");
    const qqqTick = frame.tickers.get("QQQ");
    const iwmTick = frame.tickers.get("IWM");
    if (spyTick && qqqTick && iwmTick) {
      const themesUp = themeMetrics.filter((t) => (t as any).medianChangePct > 0).length;
      const themesDown = themeMetrics.filter((t) => (t as any).medianChangePct <= 0).length;
      const avgScore = themeMetrics.length > 0
        ? themeMetrics.reduce((s, t) => s + ((t as any).score ?? 0), 0) / themeMetrics.length
        : 0;
      captureSessionSegment({
        spyPrice: spyTick.price,
        qqqPrice: qqqTick.price,
        iwmPrice: iwmTick.price,
        avgThemeScore: Math.round(avgScore * 100) / 100,
        themesUp,
        themesDown,
      }).catch(() => {});
    }

    const priceSignals = await processSnapshot(frame, session);

    const current = currentFrame();
    if (current) {
      const clears = evaluateActiveLodBounces(current);
      if (clears.length > 0) {
        const clearIds = clears.flatMap((c) => c.cardIds);
        removeDiscoveries(clearIds);
        const gaveUpSymbols = clears
          .filter((c) => c.reason === "gave_up")
          .map((c) => c.subject);
        if (gaveUpSymbols.length > 0) {
          onLodBounceGaveUp(gaveUpSymbols);
          for (const sym of gaveUpSymbols) clearPipelineCooldown("lod_bounce_scan", sym);
        }
        // Broadcast clears whenever the feed is live (on + silent). Off = no clients expected.
        if (scannerMode !== "off") broadcastClear(clears);
        console.log(
          `[Scanner] Cleared ${clearIds.length} LOD bounce card(s): ` +
            clears.map((c) => `${c.subject}(${c.reason})`).join(", ")
        );
      }
    }

    // News alerts: skip during pre-market (only gap + volume_spike there)
    const newsSignals = session === "pre_market"
      ? []
      : await detectNewsAlerts(frame).catch((err) => {
          console.warn("[Scanner] News detection error:", String(err).slice(0, 150));
          return [] as Signal[];
        });

    const signals = [...priceSignals, ...newsSignals];
    if (signals.length === 0) return;

    lastSignalAt = new Date().toISOString();

    if (!current) return;

    const lensCtx: LensContext = {
      currentFrame: current,
      getFrame,
      bufferLength: getBufferLength(),
    };

    // Keep catalyst data fresh and decay weights current
    await ensureCatalystSynced();
    updateDecayWeights();

    const enriched = await routeSignals(signals, lensCtx, session);

    // Apply catalyst boost to enriched signals
    for (const es of enriched) {
      if (es.signal.subjectKind === "ticker") {
        const boost = getCatalystBoost(es.signal.subject);
        if (boost > 0) es.qualifyScore = Math.min(100, es.qualifyScore + boost);
      }
    }

    // Evaluate signals for new catalyst entries + check resolutions
    for (const es of enriched) {
      const newsCtx = es.context.news as import("@shared/scanner-types").NewsResult | undefined;
      await evaluateForCatalysts(es.signal, newsCtx ?? null).catch(() => {});
      await checkCatalystResolution(es.signal).catch(() => {});

      // Auto-create earnings catalyst on post-earnings reaction signals
      if (es.signal.type === "earnings_reaction") {
        const epsA = es.signal.meta?.epsActual as number | undefined;
        const epsE = es.signal.meta?.epsEstimate as number | undefined;
        const changePct = (es.signal.meta?.gapPct as number) ?? 0;
        if (epsA != null && epsE != null) {
          await createEarningsCatalyst(es.signal.subject, epsA, epsE, changePct).catch(() => {});
        }
      }
    }

    if (enriched.length === 0) return;

    const cards = await executeReactions(enriched);
    if (cards.length === 0) return;

    // Persist to in-memory buffer
    pushDiscoveries(cards);
    trackLodBounceDiscoveries(cards, current);

    // Broadcast whenever feed is live. Silent still gets cards (no chime); off skips push.
    if (scannerMode !== "off") {
      broadcastBatch(cards);
    }

    console.log(
      `[Scanner] Processed ${signals.length} signals → ${enriched.length} enriched → ${cards.length} discoveries`
    );
  } catch (err) {
    console.error("[Scanner] Processing error:", err);
  }
}

// ── Initialization ──────────────────────────────────────────────────────────

// ── 5-day high/low data refresh ─────────────────────────────────────────────

let lastFiveDayRefresh = 0;
const FIVE_DAY_REFRESH_INTERVAL = 6 * 60 * 60_000; // every 6 hours

async function refreshFiveDayLevels(): Promise<void> {
  if (Date.now() - lastFiveDayRefresh < FIVE_DAY_REFRESH_INTERVAL) return;

  try {
    const { getAlpacaProvider } = await import("../market-condition/providers/alpaca");
    const { getAllUniverseTickers } = await import("../market-condition/universe");

    const provider = getAlpacaProvider();
    const tickers = getAllUniverseTickers();
    const data = new Map<string, { high5d: number; low5d: number }>();

    // Parallel batches of 10 to respect rate limits
    const CONCURRENCY = 10;
    for (let i = 0; i < tickers.length; i += CONCURRENCY) {
      const batch = tickers.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (sym) => {
          const bars = await provider.getHistoricalBars(sym, 7);
          return { sym, bars };
        })
      );
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { sym, bars } = r.value;
        if (bars.length < 2) continue;
        const recentBars = bars.slice(-6, -1);
        if (recentBars.length === 0) continue;
        const high5d = Math.max(...recentBars.map(b => b.high));
        const low5d = Math.min(...recentBars.map(b => b.low));
        data.set(sym.toUpperCase(), { high5d, low5d });
      }
    }

    if (data.size > 0) {
      setFiveDayHighLow(data);
      lastFiveDayRefresh = Date.now();
      console.log(`[Scanner] Refreshed 5-day high/low for ${data.size} tickers`);
    }
  } catch (err) {
    console.error("[Scanner] Failed to refresh 5-day levels:", err);
  }
}

export async function initScanner(): Promise<void> {
  // Seed default catalyst rules and load existing catalysts (lightweight DB reads)
  await seedDefaultCatalystRules().catch(() => {});
  await syncCatalystsFromDb().catch(() => {});

  // Register the MC callback immediately so signals start flowing once MC refreshes
  registerPostRefreshCallback((themeMetrics, snapshots, spyBenchmark) => {
    // Periodic refresh of 5-day levels (throttled internally)
    refreshFiveDayLevels().catch(() => {});

    onSnapshotRefreshed(themeMetrics, snapshots, spyBenchmark).catch((err) => {
      console.error("[Scanner] Callback error:", err);
    });
  });

  // ─── Staggered sub-system startup ───────────────────────────────────────────
  // Defer heavy background jobs to avoid overlapping with MC snapshot memory peak.
  // Delays are relative to scanner init (which is already 30s after boot).

  // 5-day high/low: deferred 15s — fetches bars for all tickers
  setTimeout(() => {
    console.log("[Scanner] Starting 5-day high/low refresh (deferred)...");
    refreshFiveDayLevels().catch(() => {});
  }, 15_000);

  // Outcome tracker: deferred 30s — DB-heavy, processes discoveries
  setTimeout(() => {
    console.log("[Scanner] Starting outcome tracker (deferred)...");
    startOutcomeTracker();
  }, 30_000);

  // IPO detector: deferred 45s — polls external API
  setTimeout(() => {
    console.log("[Scanner] Starting IPO detector (deferred)...");
    startIpoDetector(async (signals) => {
      if (scannerMode === "off") return;
      try {
        lastSignalAt = new Date().toISOString();
        const current = currentFrame();
        if (!current) return;

        const lensCtx: LensContext = {
          currentFrame: current,
          getFrame,
          bufferLength: getBufferLength(),
        };

        const enriched = await routeSignals(signals, lensCtx, getCurrentSession());
        if (enriched.length === 0) return;

        const cards = await executeReactions(enriched);
        if (cards.length === 0) return;

        pushDiscoveries(cards);
        if (scannerMode !== "off") broadcastBatch(cards);
        console.log(`[Scanner/IPO] ${signals.length} IPO signals → ${cards.length} discoveries`);
      } catch (err) {
        console.error("[Scanner/IPO] Processing error:", err);
      }
    }, 100);
  }, 45_000);

  console.log("[Scanner] Initialized (subsystems staggered) — mode:", scannerMode);
}
