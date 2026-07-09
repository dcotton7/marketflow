// ---------------------------------------------------------------------------
// Discovery Scanner — main entry point
//
// Initializes the scanner, registers the MC post-refresh callback,
// and orchestrates the signal → pipeline → reaction → SSE broadcast flow.
// ---------------------------------------------------------------------------

import type { ScannerMode, MarketSession, DiscoveryCard, Signal } from "@shared/scanner-types";
import type { ThemeMetrics } from "../market-condition/engine/theme-score";
import { registerPostRefreshCallback } from "../market-condition/engine/snapshot";
import { processSnapshot, setFiveDayHighLow, type SnapshotFrame, type TickerFrame, type ThemeFrame } from "./signal-producer";
import { routeSignals } from "./pipeline-router";
import { getActivePipelines } from "./pipeline-router";
import { executeReactions } from "./reactions";
import { broadcastBatch, pushDiscoveries } from "./routes";
import type { LensContext } from "./lenses";
import { getFrame, getBufferLength, currentFrame } from "./signal-producer";
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

    tickers.set(sym, {
      price: snap.price ?? 0,
      changePct: snap.changePct ?? 0,
      volume: snap.volume ?? 0,
      avgVolume14d: snap.avgVolume ?? 0,
      extensionFrom20dAdr: 0,
      prevClose: raw?.prevClose ?? 0,
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

    const priceSignals = processSnapshot(frame, session);

    // News alerts: skip during pre-market (only gap + volume_spike there)
    const newsSignals = session === "pre_market"
      ? []
      : await detectNewsAlerts(frame).catch(() => [] as Signal[]);

    const signals = [...priceSignals, ...newsSignals];
    if (signals.length === 0) return;

    lastSignalAt = new Date().toISOString();

    const current = currentFrame();
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
    }

    if (enriched.length === 0) return;

    const cards = await executeReactions(enriched);
    if (cards.length === 0) return;

    // Persist to in-memory buffer
    pushDiscoveries(cards);

    // Broadcast to SSE clients (skip if mode is "silent" — they get history on open)
    if (scannerMode === "on") {
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
  // Seed default catalyst rules and load existing catalysts
  await seedDefaultCatalystRules().catch(() => {});
  await syncCatalystsFromDb().catch(() => {});

  // Load 5-day high/low data (fire and forget to not block init)
  refreshFiveDayLevels().catch(() => {});

  registerPostRefreshCallback((themeMetrics, snapshots, spyBenchmark) => {
    // Periodic refresh of 5-day levels
    refreshFiveDayLevels().catch(() => {});

    onSnapshotRefreshed(themeMetrics, snapshots, spyBenchmark).catch((err) => {
      console.error("[Scanner] Callback error:", err);
    });
  });

  console.log("[Scanner] Initialized — mode:", scannerMode);
}
