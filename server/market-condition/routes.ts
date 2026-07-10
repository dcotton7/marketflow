/**
 * Market Condition API Routes
 * 
 * Endpoints:
 * - GET /api/market-condition/themes - All theme scores + metrics
 * - GET /api/market-condition/themes/:id/members - Tickers for a theme
 * - GET /api/market-condition/rai - RAI score + components
 * - GET /api/market-condition/leaders - Current leaders across all themes
 * - GET /api/market-condition/regime - Simplified regime for Scanner
 * - GET /api/market-condition/status - Polling status
 * - GET/PUT /api/market-condition/settings - Admin refresh settings
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { ClusterId, CLUSTERS, CLUSTER_IDS, OVERLAYS, getAllUniverseTickers, TimeSlice, getTickerPrimaryCluster, getClusterById } from "./universe";
import { db } from "../db";
import { subthemes, themes, tickers as tickerTable, tickerSliceMemberships, tnnSettings } from "@shared/schema";
import {
  getMarketCondition,
  getMarketConditionWithTimeSlice,
  getMarketConditionAtComparisonTime,
  getMarketConditionWithOpenBaseline,
  getThemeById,
  getAllThemes,
  getClusterMembers,
  getClusterLeaderCandidates,
  getAllLeaders,
  getPollingStatus,
  getUniverseParticipation,
  startPolling,
  stopPolling,
  setPollInterval,
  forceRefresh,
  refreshSnapshot,
  touchActivity,
  getSleepStatus,
  getMaMetadata,
} from "./engine/snapshot";
import { getRaceTimeline, listIntradaySnapshotSlots, getHistoricalSnapshotAt } from "./engine/theme-snapshots";
import { calculateRAI } from "./engine/rai";
import { refreshThemeMembersCache } from "./utils/theme-db-loader";

const router = Router();
const MIN_SUBTHEME_MARKET_CAP = 500_000_000;

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function inferSubthemeByIndustry(
  industry: string | null | undefined,
  candidates: Array<{ id: string; name: string }>
): { id: string; name: string } | null {
  const normalizedIndustry = normalizeForMatch(industry ?? "");
  if (!normalizedIndustry) return null;

  let best: { id: string; name: string; score: number } | null = null;
  for (const candidate of candidates) {
    const normalizedName = normalizeForMatch(candidate.name);
    if (!normalizedName) continue;
    const exact = normalizedIndustry === normalizedName;
    const contains = normalizedIndustry.includes(normalizedName) || normalizedName.includes(normalizedIndustry);
    const tokenOverlap = normalizedName
      .split(" ")
      .filter((token) => token.length >= 3)
      .some((token) => normalizedIndustry.includes(token));

    const score = exact ? 3 : contains ? 2 : tokenOverlap ? 1 : 0;
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { id: candidate.id, name: candidate.name, score };
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

function missingSubthemeTables(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? "");
  return (
    message.includes('relation "subthemes" does not exist') ||
    message.includes('relation "ticker_slice_memberships" does not exist')
  );
}

// =============================================================================
// Theme Endpoints
// =============================================================================

/**
 * GET /api/market-condition/themes
 * Returns all theme metrics sorted by score
 * Query params:
 *   - timeSlice: "1H" | "4H" | "1D" | "1W" | "1M" (default: "1D")
 *   - sizeFilter: "ALL" | "MEGA" | "LARGE" | "MID" | "SMALL" | "MICRO" (default: "ALL")
 *   - useIntradayBaseline: "true" | "false" (default: "false") - Uses 9:30 AM open instead of prev close during market hours
 */
router.get("/themes", async (req: Request, res: Response) => {
  try {
    touchActivity(); // Wake from sleep if needed
    
    // Parse and validate query params
    const timeSlice = (req.query.timeSlice as TimeSlice) || "TODAY";
    const snapshotAtRaw = typeof req.query.snapshotAt === "string" ? req.query.snapshotAt.trim() : "";
    const sizeFilter = (req.query.sizeFilter as string || "ALL") as any;
    const useIntradayBaseline = req.query.useIntradayBaseline === "true";
    const rotationBaseline = (req.query.rotationBaseline as string) || "";
    
    // Validate timeSlice
    const validTimeSlices: TimeSlice[] = ["TODAY", "15M", "30M", "1H", "4H", "1D", "5D", "10D", "1W", "1M", "3M", "6M", "YTD"];
    const validatedTimeSlice: TimeSlice = validTimeSlices.includes(timeSlice) ? timeSlice : "TODAY";
    
    // Validate sizeFilter
    const validSizeFilters = ["ALL", "MEGA", "LARGE", "MID", "SMALL", "MICRO"];
    const validatedSizeFilter = validSizeFilters.includes(sizeFilter) ? sizeFilter : "ALL";
    const useOpenBaselineForToday = validatedTimeSlice === "TODAY" && rotationBaseline === "open930";
    
    // Only refresh when data is stale or missing — background polling handles the normal cadence.
    // Non-ALL sizeFilter or intraday baseline still need a targeted refresh for correct deltas.
    const currentCondition = getMarketCondition();
    const dataIsStale = currentCondition.isStale;
    const needsFilteredRefresh = useIntradayBaseline || validatedSizeFilter !== "ALL";

    if (needsFilteredRefresh) {
      await refreshSnapshot(useIntradayBaseline, validatedSizeFilter as any);
    } else if (dataIsStale) {
      await refreshSnapshot(useIntradayBaseline, "ALL");
    }

    let condition;
    if (snapshotAtRaw) {
      console.log(`[MC-API] Themes requested with snapshotAt=${snapshotAtRaw}`);
      condition = await getMarketConditionAtComparisonTime(snapshotAtRaw);
    } else if (validatedTimeSlice === "TODAY") {
      condition = useOpenBaselineForToday
        ? await getMarketConditionWithOpenBaseline()
        : getMarketCondition();
    } else {
      console.log(`[MC-API] Themes requested with timeSlice=${validatedTimeSlice} (historical comparison)`);
      condition = await getMarketConditionWithTimeSlice(validatedTimeSlice);
    }

    res.json({
      themes: condition.themes,
      spyBenchmark: condition.spyBenchmark,
      benchmarks: condition.benchmarks,
      lastUpdated: condition.lastUpdated,
      isStale: condition.isStale,
      // Echo back the filters for client confirmation
      timeSlice: validatedTimeSlice,
      sizeFilter: validatedSizeFilter,
      // Comparison timestamp for deltaRank calculations
      comparisonTime: condition.comparisonTime || null,
      comparisonUnavailable: condition.comparisonUnavailable || null,
      maAsOf: condition.maAsOf ?? null,
      maMode: condition.maMode ?? null,
    });
  } catch (error) {
    console.error("[MC-API] Failed to get themes:", error);
    res.status(500).json({ error: "Failed to fetch theme data" });
  }
});

/**
 * GET /api/market-condition/themes/:id
 * Returns metrics for a specific theme
 */
router.get("/themes/:id", async (req: Request, res: Response) => {
  try {
    touchActivity(); // Wake from sleep if needed
    const { id } = req.params;
    
    if (!CLUSTER_IDS.includes(id as ClusterId)) {
      return res.status(400).json({ error: `Invalid theme ID: ${id}` });
    }
    
    const theme = getThemeById(id as ClusterId);
    if (!theme) {
      return res.status(404).json({ error: "Theme not found or data not loaded" });
    }
    
    res.json(theme);
  } catch (error) {
    console.error(`[MC-API] Failed to get theme ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to fetch theme data" });
  }
});

// Number of calendar days to fetch for each time slice (for historical bars)
const TIME_SLICE_DAYS: Partial<Record<TimeSlice, number>> = {
  "1D": 4,   // Fetch 4 calendar days, use the 1st trading day back (yesterday)
  "5D": 12,  // Fetch enough bars for ~5 trading days
  "10D": 20, // Fetch enough bars for ~10 trading days
  "1W": 12,  // Fetch 12 calendar days, use the 5th trading day back
  "1M": 35,  // Fetch 35 calendar days, use the 21st trading day back
};

// Intraday time slices: fetch 5-min bars for last 2 calendar days to cover comparison time
const INTRADAY_TIME_SLICES: TimeSlice[] = ["15M", "30M", "1H", "4H"];

// Number of trading days to look back for each time slice
const TRADING_DAYS_BACK: Partial<Record<TimeSlice, number>> = {
  "1D": 1,
  "5D": 5,
  "10D": 10,
  "1W": 5,
  "1M": 21,
};

/**
 * GET /api/market-condition/ticker-theme/:symbol
 * Returns the theme rank info for a given ticker symbol from the latest snapshot.
 */
router.get("/ticker-theme/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const clusterId = getTickerPrimaryCluster(symbol);
    if (!clusterId) {
      return res.json({ themeId: null, themeName: null, rank: null, totalThemes: null });
    }
    const cluster = getClusterById(clusterId);
    const mc = getMarketCondition();
    if (!mc?.themes?.length) {
      return res.json({ themeId: clusterId, themeName: cluster?.name ?? clusterId, rank: null, totalThemes: null });
    }
    const sorted = [...mc.themes].sort((a, b) => b.score - a.score);
    const idx = sorted.findIndex((t) => t.id === clusterId);
    const rank = idx >= 0 ? idx + 1 : null;
    return res.json({
      themeId: clusterId,
      themeName: cluster?.name ?? clusterId,
      rank,
      totalThemes: sorted.length,
      score: sorted[idx]?.score ?? null,
      medianPct: sorted[idx]?.medianPct ?? null,
    });
  } catch (error) {
    console.error("[MC-API] Failed to get ticker theme:", error);
    res.status(500).json({ error: "Failed to lookup ticker theme" });
  }
});

/**
 * GET /api/market-condition/themes/:id/members
 * Returns member tickers for a theme with their metrics
 * Query params:
 *   - timeSlice: TimeSlice — when "1W" or "1M", fetches historical bar data per ticker
 */
router.get("/themes/:id/members", async (req: Request, res: Response) => {
  try {
    touchActivity(); // Wake from sleep if needed
    const { id } = req.params;
    const timeSlice = (req.query.timeSlice as TimeSlice) || "TODAY";
    const snapshotAtRaw = typeof req.query.snapshotAt === "string" ? req.query.snapshotAt.trim() : "";
    
    if (!CLUSTER_IDS.includes(id as ClusterId)) {
      return res.status(400).json({ error: `Invalid theme ID: ${id}` });
    }
    
    const members = getClusterMembers(id as ClusterId);
    const leaders = getClusterLeaderCandidates(id as ClusterId);
    
    // Load ticker A/D from database
    const { getTickerAccDistMap } = await import("./utils/ticker-acc-dist-loader");
    const tickerAccDist = await getTickerAccDistMap(members.map(m => m.symbol));
    
    // Get theme-specific A/D aggregates
    const { getAccDistAggregates } = await import("./utils/size-filter-helper");
    const accDistStats = await getAccDistAggregates(id);
    
    console.log(`[API] /themes/${id}/members - A/D Stats:`, JSON.stringify(accDistStats));

    // Fetch historical bars for ticker-level comparison if timeSlice supports it
    let historicalBarsMap: Map<string, any[]> | null = null;
    const calDays = TIME_SLICE_DAYS[timeSlice];
    const isIntradaySlice = INTRADAY_TIME_SLICES.includes(timeSlice);
    // Full comparison time (ISO) for theme snapshot; used for intraday bar lookup
    let comparisonTimeIso: string | null = null;
    // Date-only for daily bar lookup (1D, 1W, 1M)
    let comparisonDateIso: string | null = null;
    try {
      if (snapshotAtRaw) {
        const histResult = await getHistoricalSnapshotAt(snapshotAtRaw);
        if (histResult?.comparisonTime) {
          comparisonTimeIso = String(histResult.comparisonTime);
          comparisonDateIso = comparisonTimeIso.split("T")[0];
        }
      } else {
        const { getHistoricalSnapshot, getMarketDateTime } = await import("./engine/theme-snapshots");
        const { date: marketDate, hour: marketHour } = getMarketDateTime();
        const histResult = await getHistoricalSnapshot(timeSlice, marketDate, marketHour);
        if (histResult && histResult.comparisonTime) {
          comparisonTimeIso = String(histResult.comparisonTime);
          comparisonDateIso = comparisonTimeIso.split("T")[0];
        }
      }
    } catch (err) {
      console.warn(`[API] /themes/${id}/members - Failed to get historical comparison date:`, err);
    }

    if (calDays) {
      try {
        const { getAlpacaProvider } = await import("./providers/alpaca");
        const provider = getAlpacaProvider();
        historicalBarsMap = await provider.getMultiSymbolBars(members.map(m => m.symbol), calDays);
        console.log(`[API] /themes/${id}/members - Fetched historical bars for ${historicalBarsMap.size} symbols (${timeSlice})`);
      } catch (err) {
        console.warn(`[API] /themes/${id}/members - Failed to fetch historical bars:`, err);
      }
    } else if (isIntradaySlice && comparisonTimeIso) {
      try {
        const { getAlpacaProvider } = await import("./providers/alpaca");
        const provider = getAlpacaProvider();
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 2); // 2 calendar days of 5-min bars
        const intradayBars = await provider.getMultiSymbolIntradayBars(
          members.map(m => m.symbol),
          startDate,
          endDate,
          "5Min"
        );
        // Use same Map<string, bar[]> shape as daily path (bar has timestamp, close, volume)
        historicalBarsMap = intradayBars as unknown as Map<string, any[]>;
        console.log(`[API] /themes/${id}/members - Fetched intraday bars for ${historicalBarsMap.size} symbols (${timeSlice})`);
      } catch (err) {
        console.warn(`[API] /themes/${id}/members - Failed to fetch intraday bars:`, err);
      }
    }

    const tradingDaysBack = TRADING_DAYS_BACK[timeSlice];

    // Merge leader info, A/D, and historical data into member data
    const enrichedMembers = members.map(m => {
      const leaderInfo = leaders.find(l => l.symbol === m.symbol);
      const adValue = tickerAccDist.get(m.symbol.toUpperCase()) ?? 0;

      // Historical price/pct from bars if available
      let historicalPrice: number | undefined;
      let historicalPct: number | undefined;
      let historicalVolExp: number | undefined;

      if (historicalBarsMap) {
        const barsRaw = historicalBarsMap.get(m.symbol) || [];
        // normalize and sort ascending by timestamp
        const bars = barsRaw.slice().sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        let histBar: any | undefined = undefined;

        if (isIntradaySlice && comparisonTimeIso) {
          // Intraday: find the latest bar at or before comparisonTime
          const comparisonMs = new Date(comparisonTimeIso).getTime();
          for (let i = bars.length - 1; i >= 0; i--) {
            const t = new Date(bars[i].timestamp).getTime();
            if (t <= comparisonMs) {
              histBar = bars[i];
              break;
            }
          }
        } else if (comparisonDateIso) {
          // Daily: find a bar whose date matches the comparison date
          histBar = bars.find((b: any) => {
            const barDate = b.timestamp instanceof Date
              ? b.timestamp.toISOString().split("T")[0]
              : String(b.timestamp).split("T")[0];
            return barDate === comparisonDateIso;
          });
          // fallback: latest bar on or before that date
          if (!histBar) {
            const targetEnd = new Date(comparisonDateIso + "T23:59:59Z").getTime();
            for (let i = bars.length - 1; i >= 0; i--) {
              const t = new Date(bars[i].timestamp).getTime();
              if (t <= targetEnd) {
                histBar = bars[i];
                break;
              }
            }
          }
        }

        // Final fallback: use N-bars-back if still not found (daily only)
        if (!histBar && typeof tradingDaysBack === "number") {
          const barIndex = bars.length - tradingDaysBack;
          if (barIndex >= 0 && barIndex < bars.length) histBar = bars[barIndex];
        }

        if (histBar) {
          historicalPrice = histBar.close;
          // Period return: from historicalPrice to current price
          const currentPrice = m.price ?? 0;
          if (historicalPrice > 0 && currentPrice > 0) {
            historicalPct = ((currentPrice - historicalPrice) / historicalPrice) * 100;
          } else {
            historicalPct = 0;
          }
          // Volume expansion: histBar.volume vs the member's current 20d avg (best approximation)
          const avgVol = m.volExp > 0 && m.volExp !== 1 ? histBar.volume / m.volExp : histBar.volume;
          historicalVolExp = avgVol > 0 ? histBar.volume / avgVol : 1;
        }
      }

      return {
        ...m,
        rsVsSpy: m.rsVsBenchmark,
        accDistDays: adValue,
        leaderScore: leaderInfo?.leaderScore || 0,
        isLeader: leaderInfo?.isLeader || false,
        isPinned: leaderInfo?.isPinned || false,
        historicalPrice,
        historicalPct,
        historicalVolExp,
      };
    });
    
    console.log(`[API] /themes/${id}/members - Sample ticker A/D:`, enrichedMembers[0]?.symbol, enrichedMembers[0]?.accDistDays);
    
    res.json({
      themeId: id,
      members: enrichedMembers,
      accDistStats, // Theme-specific A/D aggregates
      totalCount: enrichedMembers.length,
      leaderCount: enrichedMembers.filter(m => m.isLeader).length,
      ...getMaMetadata(),
    });
  } catch (error) {
    console.error(`[MC-API] Failed to get members for ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to fetch member data" });
  }
});

// =============================================================================
// RAI Endpoint
// =============================================================================

/**
 * GET /api/market-condition/rai
 * Returns Risk Appetite Index with all components
 */
router.get("/rai", async (req: Request, res: Response) => {
  try {
    touchActivity(); // Wake from sleep if needed
    const themes = getAllThemes();
    const rai = await calculateRAI(themes);
    res.json(rai);
  } catch (error) {
    console.error("[MC-API] Failed to get RAI:", error);
    res.status(500).json({ error: "Failed to calculate RAI" });
  }
});

// =============================================================================
// Leaders Endpoint
// =============================================================================

/**
 * GET /api/market-condition/leaders
 * Returns current leaders across all themes
 */
router.get("/leaders", async (req: Request, res: Response) => {
  try {
    touchActivity(); // Wake from sleep if needed
    const { theme } = req.query;
    
    if (theme && typeof theme === "string") {
      if (!CLUSTER_IDS.includes(theme as ClusterId)) {
        return res.status(400).json({ error: `Invalid theme ID: ${theme}` });
      }
      const leaders = getClusterLeaderCandidates(theme as ClusterId)
        .filter(l => l.isLeader);
      return res.json({ themeId: theme, leaders });
    }
    
    const allLeaders = getAllLeaders();
    res.json({
      leaders: allLeaders,
      totalCount: allLeaders.length,
    });
  } catch (error) {
    console.error("[MC-API] Failed to get leaders:", error);
    res.status(500).json({ error: "Failed to fetch leaders" });
  }
});

// =============================================================================
// Regime Endpoint (For Scanner Integration)
// =============================================================================

/**
 * GET /api/market-condition/regime
 * Returns simplified regime data for Scanner
 */
router.get("/regime", async (req: Request, res: Response) => {
  try {
    touchActivity(); // Wake from sleep if needed
    const regime = getMarketRegimeForScanner();
    res.json(regime);
  } catch (error) {
    console.error("[MC-API] Failed to get regime:", error);
    res.status(500).json({ error: "Failed to get market regime" });
  }
});

// =============================================================================
// Status & Admin Endpoints
// =============================================================================

/**
 * GET /api/market-condition/status
 * Returns polling status and health info
 */
/**
 * GET /api/market-condition/race-timeline
 * Query: range=1d|2d|...|1y
 * Returns ordered frames of per-theme metrics from theme_snapshots, plus the
 * effective lookback boundary, terminal session state, and whether the window
 * used trading-day or calendar semantics.
 */
/**
 * GET /api/market-condition/intraday-snapshot-slots
 * Query: date=YYYY-MM-DD (optional, defaults to current ET market date)
 * Returns 15-minute snapshot times that exist in storage for that session.
 */
router.get("/intraday-snapshot-slots", async (req: Request, res: Response) => {
  try {
    touchActivity();
    const dateRaw = typeof req.query.date === "string" ? req.query.date.trim() : undefined;
    const slots = await listIntradaySnapshotSlots(dateRaw || undefined);
    res.json({ slots, marketDate: dateRaw || null });
  } catch (error) {
    console.error("[MC-API] intraday-snapshot-slots failed:", error);
    res.status(500).json({ error: "Failed to load snapshot slots" });
  }
});

router.get("/race-timeline", async (req: Request, res: Response) => {
  try {
    touchActivity();
    const rangeRaw = (req.query.range as string) || "5d";
    const validRanges = new Set([
      "1d", "2d", "3d", "4d", "5d", "2w", "3w", "1mo", "3mo", "6mo", "1y",
    ]);
    const range = validRanges.has(rangeRaw) ? rangeRaw : "5d";
    const timeline = await getRaceTimeline(range);
    res.json({ range, resolution: "intraday", ...timeline });
  } catch (error) {
    console.error("[MC-API] race-timeline failed:", error);
    res.status(500).json({ error: "Failed to load race timeline" });
  }
});

router.get("/status", async (req: Request, res: Response) => {
  try {
    touchActivity(); // Keep server awake - status is polled every 5s when page is open
    const status = getPollingStatus();
    const sleepStatus = getSleepStatus();
    const universeSize = getAllUniverseTickers().length;
    const universeParticipation = getUniverseParticipation();
    
    res.json({
      ...status,
      ...sleepStatus,
      universeSize,
      clusterCount: CLUSTERS.length,
      overlayCount: OVERLAYS.length,
      universeParticipation,
    });
  } catch (error) {
    console.error("[MC-API] Failed to get status:", error);
    res.status(500).json({ error: "Failed to get status" });
  }
});

/**
 * GET /api/market-condition/settings
 * Returns current market condition settings
 */
router.get("/settings", async (req: Request, res: Response) => {
  try {
    const status = getPollingStatus();
    
    // Get from system settings if available
    let savedSettings: Record<string, any> = {};
    if (db) {
      const [settings] = await db
        .select()
        .from(tnnSettings)
        .where(eq(tnnSettings.settingKey, "market_condition"))
        .limit(1);
      if (settings?.settingValue) {
        try {
          savedSettings = JSON.parse(settings.settingValue);
        } catch {
          savedSettings = {};
        }
      }
    }
    
    res.json({
      marketHoursPollIntervalMs: savedSettings.marketHoursPollIntervalMs ?? status.marketHoursIntervalMs,
      offHoursPollIntervalMs: savedSettings.offHoursPollIntervalMs ?? status.offHoursIntervalMs,
      // Legacy field for backward compatibility
      pollIntervalMs: savedSettings.marketHoursPollIntervalMs ?? status.marketHoursIntervalMs,
      enableStreaming: savedSettings.enableStreaming ?? false,
      showRaiInHeader: savedSettings.showRaiInHeader ?? true,
      autoStartPolling: savedSettings.autoStartPolling ?? true,
      maBoldThresholdPct: savedSettings.maBoldThresholdPct ?? 0.5,
      clientThemesRefetchIntervalMs: savedSettings.clientThemesRefetchIntervalMs ?? 60000,
      clientTickersRefetchIntervalMs: savedSettings.clientTickersRefetchIntervalMs ?? 60000,
      isMarketHours: status.isMarketHours,
      currentIntervalMs: status.currentIntervalMs,
    });
  } catch (error) {
    console.error("[MC-API] Failed to get settings:", error);
    res.status(500).json({ error: "Failed to get settings" });
  }
});

/**
 * PUT /api/market-condition/settings
 * Updates market condition settings (admin only)
 */
const settingsSchema = z.object({
  marketHoursPollIntervalMs: z.number().min(10000).max(300000).optional(),
  offHoursPollIntervalMs: z.number().min(60000).max(600000).optional(),
  // Legacy field for backward compatibility
  pollIntervalMs: z.number().min(10000).max(300000).optional(),
  enableStreaming: z.boolean().optional(),
  showRaiInHeader: z.boolean().optional(),
  autoStartPolling: z.boolean().optional(),
  // Ticker table: bold % when within this threshold of MA (default 0.5)
  maBoldThresholdPct: z.number().min(0).max(5).optional(),
  // Client refetch intervals (ms)
  clientThemesRefetchIntervalMs: z.number().min(15000).max(600000).optional(),
  clientTickersRefetchIntervalMs: z.number().min(15000).max(600000).optional(),
});

router.put("/settings", async (req: Request, res: Response) => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid settings", details: parsed.error });
    }
    
    const newSettings = parsed.data;
    
    // Normalize: if pollIntervalMs is provided but marketHoursPollIntervalMs is not, use it
    if (newSettings.pollIntervalMs && !newSettings.marketHoursPollIntervalMs) {
      newSettings.marketHoursPollIntervalMs = newSettings.pollIntervalMs;
    }
    
    if (!db) {
      // Still apply runtime settings even without DB
      if (newSettings.marketHoursPollIntervalMs != null || newSettings.offHoursPollIntervalMs != null) {
        setPollInterval(
          newSettings.marketHoursPollIntervalMs ?? 60000,
          newSettings.offHoursPollIntervalMs ?? 300000
        );
      }
      return res.json({ success: true, settings: newSettings });
    }
    
    // Get existing settings
    const [existing] = await db
      .select()
      .from(tnnSettings)
      .where(eq(tnnSettings.settingKey, "market_condition"))
      .limit(1);
    
    let existingValue: Record<string, any> = {};
    if (existing?.settingValue) {
      try {
        existingValue = JSON.parse(existing.settingValue);
      } catch {
        existingValue = {};
      }
    }
    
    const mergedSettings = {
      ...existingValue,
      ...newSettings,
    };
    
    // Upsert settings
    if (existing) {
      await db
        .update(tnnSettings)
        .set({ settingValue: JSON.stringify(mergedSettings), updatedAt: new Date() })
        .where(eq(tnnSettings.settingKey, "market_condition"));
    } else {
      await db.insert(tnnSettings).values({
        settingKey: "market_condition",
        settingValue: JSON.stringify(mergedSettings),
        description: "Market Condition Terminal settings",
      });
    }
    
    // Apply poll interval changes if specified
    if (newSettings.marketHoursPollIntervalMs != null || newSettings.offHoursPollIntervalMs != null) {
      setPollInterval(
        newSettings.marketHoursPollIntervalMs ?? mergedSettings.marketHoursPollIntervalMs ?? 60000,
        newSettings.offHoursPollIntervalMs ?? mergedSettings.offHoursPollIntervalMs ?? 300000
      );
    }
    
    res.json({ success: true, settings: mergedSettings });
  } catch (error) {
    console.error("[MC-API] Failed to update settings:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// =============================================================================
// Control Endpoints (Admin)
// =============================================================================

/**
 * POST /api/market-condition/start
 * Start polling
 */
router.post("/start", async (req: Request, res: Response) => {
  try {
    const status = getPollingStatus();
    if (status.isPolling) {
      return res.json({ success: true, message: "Already polling" });
    }
    
    startPolling();
    res.json({ success: true, message: "Polling started" });
  } catch (error) {
    console.error("[MC-API] Failed to start polling:", error);
    res.status(500).json({ error: "Failed to start polling" });
  }
});

/**
 * POST /api/market-condition/stop
 * Stop polling
 */
router.post("/stop", async (req: Request, res: Response) => {
  try {
    stopPolling();
    res.json({ success: true, message: "Polling stopped" });
  } catch (error) {
    console.error("[MC-API] Failed to stop polling:", error);
    res.status(500).json({ error: "Failed to stop polling" });
  }
});

/**
 * POST /api/market-condition/refresh
 * Force immediate refresh
 */
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    await forceRefresh();
    res.json({ success: true, message: "Refresh complete" });
  } catch (error) {
    console.error("[MC-API] Failed to refresh:", error);
    res.status(500).json({ error: "Failed to refresh" });
  }
});

/**
 * POST /api/market-condition/force-snapshot
 * Force save an intraday snapshot (admin only - for when data is stale)
 */
router.post("/force-snapshot", async (req: Request, res: Response) => {
  try {
    const { forceSaveSnapshot } = await import("./engine/snapshot");
    const saved = await forceSaveSnapshot();
    if (saved) {
      res.json({ success: true, message: "Snapshot saved" });
    } else {
      res.status(400).json({ success: false, message: "No data to save" });
    }
  } catch (error) {
    console.error("[MC-API] Failed to force save snapshot:", error);
    res.status(500).json({ error: "Failed to save snapshot" });
  }
});

// =============================================================================
// Time Endpoint
// =============================================================================

/**
 * GET /api/market-condition/time
 * Returns current NYC time (for client clock sync)
 */
router.get("/time", (req: Request, res: Response) => {
  const now = new Date();
  const etString = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // Parse "02/24/2026, 11:15:30" format
  const [datePart, timePart] = etString.split(", ");
  const [month, day, year] = datePart.split("/");
  const [hour, minute, second] = timePart.split(":");
  
  // Construct an ISO timestamp representing this ET time
  // Note: This creates a Date object where the UTC values match the ET display values
  const etDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
  
  res.json({
    timestamp: etDate.toISOString(),
    etHour: parseInt(hour, 10),
    etMinute: parseInt(minute, 10),
    etSecond: parseInt(second, 10),
    etDate: `${year}-${month}-${day}`,
  });
});

// =============================================================================
// Universe Info Endpoints
// =============================================================================

/**
 * GET /api/market-condition/universe
 * Returns universe definition info
 */
router.get("/universe", async (req: Request, res: Response) => {
  try {
    res.json({
      clusters: CLUSTERS.map(c => ({
        id: c.id,
        name: c.name,
        tier: c.tier,
        coreCount: c.core.length,
        candidateCount: c.candidates.length,
        leadersTarget: c.leadersTarget,
        notes: c.notes,
      })),
      overlays: OVERLAYS,
      totalTickers: getAllUniverseTickers().length,
    });
  } catch (error) {
    console.error("[MC-API] Failed to get universe:", error);
    res.status(500).json({ error: "Failed to get universe info" });
  }
});

/**
 * GET /api/market-condition/universe/:id
 * Returns full ticker list for a cluster
 */
router.get("/universe/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!CLUSTER_IDS.includes(id as ClusterId)) {
      return res.status(400).json({ error: `Invalid cluster ID: ${id}` });
    }
    
    const cluster = CLUSTERS.find(c => c.id === id);
    if (!cluster) {
      return res.status(404).json({ error: "Cluster not found" });
    }
    
    res.json({
      ...cluster,
      totalTickers: cluster.core.length + cluster.candidates.length,
    });
  } catch (error) {
    console.error(`[MC-API] Failed to get universe ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to get cluster info" });
  }
});

// =============================================================================
// Sub-theme and unified search endpoints
// =============================================================================

/**
 * GET /api/market-condition/subthemes
 * Returns active sub-themes with parent-theme context and member counts.
 */
router.get("/subthemes", async (_req: Request, res: Response) => {
  try {
    if (!db) {
      return res.json([]);
    }

    const rows = await db
      .select({
        id: subthemes.id,
        name: subthemes.name,
        description: subthemes.description,
        themeId: subthemes.themeId,
        themeName: themes.name,
        sortOrder: subthemes.sortOrder,
      })
      .from(subthemes)
      .leftJoin(themes, eq(subthemes.themeId, themes.id))
      .where(eq(subthemes.isActive, true))
      .orderBy(asc(subthemes.themeId), asc(subthemes.sortOrder), asc(subthemes.name));

    const subthemeIds = rows.map((r) => r.id);
    const membershipCounts =
      subthemeIds.length > 0
        ? await db
            .select({
              subthemeId: tickerSliceMemberships.subthemeId,
              memberCount: sql<number>`count(*)::int`,
              leaderEligibleCount:
                sql<number>`sum(case when ${tickerSliceMemberships.isLeaderEligible} then 1 else 0 end)::int`,
            })
            .from(tickerSliceMemberships)
            .where(
              and(
                sql`${tickerSliceMemberships.subthemeId} is not null`,
                inArray(tickerSliceMemberships.subthemeId, subthemeIds)
              )
            )
            .groupBy(tickerSliceMemberships.subthemeId)
        : [];

    const countsById = new Map(
      membershipCounts.map((c) => [
        c.subthemeId ?? "",
        {
          memberCount: c.memberCount ?? 0,
          leaderEligibleCount: c.leaderEligibleCount ?? 0,
        },
      ])
    );

    res.json(
      rows.map((row) => {
        const counts = countsById.get(row.id);
        return {
          ...row,
          memberCount: counts?.memberCount ?? 0,
          leaderEligibleCount: counts?.leaderEligibleCount ?? 0,
        };
      })
    );
  } catch (error) {
    if (missingSubthemeTables(error)) {
      return res.json([]);
    }
    console.error("[MC-API] Failed to get subthemes:", error);
    res.status(500).json({ error: "Failed to fetch subthemes" });
  }
});

/**
 * GET /api/market-condition/themes/:id/subthemes
 * Returns sub-themes under a given parent theme.
 */
router.get("/themes/:id/subthemes", async (req: Request, res: Response) => {
  try {
    const themeId = String(req.params.id);
    if (!db) return res.json([]);

    const rows = await db
      .select({
        id: subthemes.id,
        name: subthemes.name,
        description: subthemes.description,
        themeId: subthemes.themeId,
        sortOrder: subthemes.sortOrder,
      })
      .from(subthemes)
      .where(and(eq(subthemes.themeId, themeId), eq(subthemes.isActive, true)))
      .orderBy(asc(subthemes.sortOrder), asc(subthemes.name));

    const subthemeIds = rows.map((r) => r.id);
    const membershipCounts =
      subthemeIds.length > 0
        ? await db
            .select({
              subthemeId: tickerSliceMemberships.subthemeId,
              memberCount: sql<number>`count(*)::int`,
              leaderEligibleCount:
                sql<number>`sum(case when ${tickerSliceMemberships.isLeaderEligible} then 1 else 0 end)::int`,
            })
            .from(tickerSliceMemberships)
            .where(
              and(
                sql`${tickerSliceMemberships.subthemeId} is not null`,
                inArray(tickerSliceMemberships.subthemeId, subthemeIds)
              )
            )
            .groupBy(tickerSliceMemberships.subthemeId)
        : [];

    const countsById = new Map(
      membershipCounts.map((c) => [
        c.subthemeId ?? "",
        {
          memberCount: c.memberCount ?? 0,
          leaderEligibleCount: c.leaderEligibleCount ?? 0,
        },
      ])
    );

    res.json(
      rows.map((row) => {
        const counts = countsById.get(row.id);
        return {
          ...row,
          memberCount: counts?.memberCount ?? 0,
          leaderEligibleCount: counts?.leaderEligibleCount ?? 0,
        };
      })
    );
  } catch (error) {
    if (missingSubthemeTables(error)) {
      return res.json([]);
    }
    console.error(`[MC-API] Failed to get subthemes for theme ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to fetch theme subthemes" });
  }
});

/**
 * GET /api/market-condition/subthemes/:id/members
 * Returns members for a sub-theme from slice memberships.
 */
router.get("/subthemes/:id/members", async (req: Request, res: Response) => {
  try {
    const subthemeId = String(req.params.id);
    if (!db) return res.json({ subthemeId, members: [], totalCount: 0 });

    const memberRows = await db
      .select({
        symbol: tickerSliceMemberships.symbol,
        themeId: tickerSliceMemberships.themeId,
        isAnchor: tickerSliceMemberships.isAnchor,
        isLeaderEligible: tickerSliceMemberships.isLeaderEligible,
        isDefaultVisible: tickerSliceMemberships.isDefaultVisible,
        source: tickerSliceMemberships.source,
        companyName: tickerTable.companyName,
        sector: tickerTable.sector,
        industry: tickerTable.industry,
        marketCap: tickerTable.marketCap,
        marketCapSize: tickerTable.marketCapSize,
      })
      .from(tickerSliceMemberships)
      .innerJoin(tickerTable, eq(tickerSliceMemberships.symbol, tickerTable.symbol))
      .where(eq(tickerSliceMemberships.subthemeId, subthemeId))
      .orderBy(asc(tickerSliceMemberships.symbol));

    res.json({
      subthemeId,
      members: memberRows,
      totalCount: memberRows.length,
      leaderEligibleCount: memberRows.filter((m) => m.isLeaderEligible).length,
    });
  } catch (error) {
    if (missingSubthemeTables(error)) {
      return res.json({ subthemeId: String(req.params.id), members: [], totalCount: 0, leaderEligibleCount: 0 });
    }
    console.error(`[MC-API] Failed to get members for subtheme ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to fetch subtheme members" });
  }
});

/**
 * GET /api/market-condition/search?q=
 * Unified search across themes, sub-themes, and tickers.
 */
router.get("/search", async (req: Request, res: Response) => {
  try {
    const raw = String(req.query.q || "").trim();
    if (!raw) return res.json({ themes: [], subthemes: [], tickers: [] });
    const q = raw.toUpperCase();

    // Fallback keeps old behavior if DB is unavailable.
    if (!db) {
      const themeMatches = getAllThemes()
        .filter((t) => t.name.toUpperCase().includes(q))
        .slice(0, 8)
        .map((t) => ({ id: t.id, name: t.name, tier: t.tier }));
      return res.json({ themes: themeMatches, subthemes: [], tickers: [] });
    }

    const [themeRows, subthemeRows, tickerRows] = await Promise.all([
      db
        .select({
          id: themes.id,
          name: themes.name,
          tier: themes.tier,
        })
        .from(themes)
        .where(ilike(themes.name, `%${raw}%`))
        .orderBy(asc(themes.name))
        .limit(8),
      db
        .select({
          id: subthemes.id,
          name: subthemes.name,
          themeId: subthemes.themeId,
          themeName: themes.name,
        })
        .from(subthemes)
        .leftJoin(themes, eq(subthemes.themeId, themes.id))
        .where(and(eq(subthemes.isActive, true), ilike(subthemes.name, `%${raw}%`)))
        .orderBy(asc(subthemes.name))
        .limit(10),
      db
        .select({
          symbol: tickerTable.symbol,
          companyName: tickerTable.companyName,
          anchorThemeId: tickerTable.themeId,
        })
        .from(tickerTable)
        .where(
          or(
            ilike(tickerTable.symbol, `%${q}%`),
            ilike(tickerTable.companyName, `%${raw}%`)
          )
        )
        .orderBy(asc(tickerTable.symbol))
        .limit(20),
    ]);

    const tickerSymbols = tickerRows.map((row) => row.symbol);
    const sliceRows =
      tickerSymbols.length > 0
        ? await db
            .select({
              symbol: tickerSliceMemberships.symbol,
              themeId: tickerSliceMemberships.themeId,
              subthemeId: tickerSliceMemberships.subthemeId,
            })
            .from(tickerSliceMemberships)
            .where(inArray(tickerSliceMemberships.symbol, tickerSymbols))
        : [];

    const tickerSlices = new Map<
      string,
      { themes: string[]; subthemes: string[] }
    >();
    for (const row of sliceRows) {
      const key = row.symbol.toUpperCase();
      if (!tickerSlices.has(key)) {
        tickerSlices.set(key, { themes: [], subthemes: [] });
      }
      const entry = tickerSlices.get(key)!;
      if (row.themeId && !entry.themes.includes(row.themeId)) entry.themes.push(row.themeId);
      if (row.subthemeId && !entry.subthemes.includes(row.subthemeId)) entry.subthemes.push(row.subthemeId);
    }

    const tickersOut = tickerRows.map((row) => {
      const key = row.symbol.toUpperCase();
      const slices = tickerSlices.get(key);
      const themesOut = slices?.themes ?? (row.anchorThemeId ? [row.anchorThemeId] : []);
      return {
        symbol: row.symbol,
        companyName: row.companyName,
        themeId: themesOut[0] ?? null,
        themes: themesOut.map((themeId) => ({ theme: themeId, isCore: false })),
        subthemes: slices?.subthemes ?? [],
      };
    });

    res.json({
      themes: themeRows,
      subthemes: subthemeRows,
      tickers: tickersOut,
    });
  } catch (error) {
    if (missingSubthemeTables(error)) {
      return res.json({ themes: [], subthemes: [], tickers: [] });
    }
    console.error("[MC-API] Unified search failed:", error);
    res.status(500).json({ error: "Failed to search market condition entities" });
  }
});

// =============================================================================
// Admin: Ticker Management
// =============================================================================

/**
 * GET /api/market-condition/ticker-assignments
 * Returns all tickers and which themes they belong to
 */
router.get("/ticker-assignments", async (req: Request, res: Response) => {
  try {
    const assignments: Record<string, { themes: string[]; isCore: boolean }[]> = {};
    
    for (const cluster of CLUSTERS) {
      // Core tickers
      for (const ticker of cluster.core) {
        if (!assignments[ticker]) assignments[ticker] = [];
        assignments[ticker].push({ themes: [cluster.id], isCore: true });
      }
      // Candidate tickers
      for (const ticker of cluster.candidates) {
        if (!assignments[ticker]) assignments[ticker] = [];
        assignments[ticker].push({ themes: [cluster.id], isCore: false });
      }
    }
    
    // Flatten to simpler format
    const result: Record<string, { theme: string; isCore: boolean }[]> = {};
    for (const [ticker, entries] of Object.entries(assignments)) {
      result[ticker] = entries.map(e => ({ theme: e.themes[0], isCore: e.isCore }));
    }

    // Merge DB-backed slice memberships so search reflects new many-to-many model.
    if (db) {
      const sliceRows = await db
        .select({
          symbol: tickerSliceMemberships.symbol,
          themeId: tickerSliceMemberships.themeId,
          isLeaderEligible: tickerSliceMemberships.isLeaderEligible,
        })
        .from(tickerSliceMemberships)
        .where(sql`${tickerSliceMemberships.themeId} is not null`);

      for (const row of sliceRows) {
        const symbol = row.symbol.toUpperCase();
        const themeId = row.themeId;
        if (!themeId) continue;
        if (!result[symbol]) result[symbol] = [];
        if (!result[symbol].some((e) => e.theme === themeId)) {
          result[symbol].push({
            theme: themeId,
            isCore: !!row.isLeaderEligible,
          });
        }
      }
    }
    
    res.json(result);
  } catch (error) {
    console.error("[MC-API] Failed to get ticker assignments:", error);
    res.status(500).json({ error: "Failed to get ticker assignments" });
  }
});

/**
 * POST /api/market-condition/themes/:id/add-tickers
 * Add tickers to a theme's candidate pool (admin only)
 * Body: { tickers: string[], force?: boolean }
 */
router.post("/themes/:id/add-tickers", async (req: Request, res: Response) => {
  try {
    const themeId = String(req.params.id);
    const { tickers, force, subthemeId } = req.body as {
      tickers: string[];
      force?: boolean;
      subthemeId?: string | null;
    };
    
    if (!CLUSTER_IDS.includes(themeId as ClusterId)) {
      return res.status(400).json({ error: `Invalid theme ID: ${themeId}` });
    }
    
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return res.status(400).json({ error: "No tickers provided" });
    }

    let targetSubtheme:
      | {
          id: string;
          name: string;
        }
      | null = null;
    if (subthemeId && db) {
      const match = await db
        .select({ id: subthemes.id, name: subthemes.name })
        .from(subthemes)
        .where(and(eq(subthemes.id, subthemeId), eq(subthemes.themeId, themeId), eq(subthemes.isActive, true)))
        .limit(1);
      if (match.length === 0) {
        return res.status(400).json({ error: `Invalid subtheme for theme ${themeId}` });
      }
      targetSubtheme = match[0]!;
    }

    const themeSubthemes =
      db
        ? await db
            .select({ id: subthemes.id, name: subthemes.name })
            .from(subthemes)
            .where(and(eq(subthemes.themeId, themeId), eq(subthemes.isActive, true)))
        : [];
    
    // Normalize tickers
    const normalizedTickers = tickers.map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
    
    // Check for conflicts
    const conflicts: Array<{ ticker: string; existingTheme: string; isCore: boolean }> = [];
    const targetCluster = CLUSTERS.find(c => c.id === themeId);
    
    if (!targetCluster) {
      return res.status(404).json({ error: "Theme not found" });
    }
    
    for (const ticker of normalizedTickers) {
      // Check if already in target theme
      if (targetCluster.core.includes(ticker) || targetCluster.candidates.includes(ticker)) {
        conflicts.push({ ticker, existingTheme: themeId, isCore: targetCluster.core.includes(ticker) });
        continue;
      }
      
      // Check other themes
      for (const cluster of CLUSTERS) {
        if (cluster.id === themeId) continue;
        if (cluster.core.includes(ticker)) {
          conflicts.push({ ticker, existingTheme: cluster.id, isCore: true });
        } else if (cluster.candidates.includes(ticker)) {
          conflicts.push({ ticker, existingTheme: cluster.id, isCore: false });
        }
      }
    }
    
    // If conflicts and not forcing, return conflicts for user confirmation
    if (conflicts.length > 0 && !force) {
      return res.json({
        success: false,
        conflicts,
        message: "Some tickers already exist in other themes",
      });
    }
    
    // Add tickers to candidates (in-memory + persist to DB)
    const added: string[] = [];
    const skipped: string[] = [];
    const marketCapFiltered: string[] = [];
    const addedToSubtheme: string[] = [];
    const inferredSubthemeAssignments: Array<{ symbol: string; subthemeId: string; subthemeName: string }> = [];
    const deferredData: string[] = [];
    
    for (const ticker of normalizedTickers) {
      // Skip if already in this theme
      if (targetCluster.core.includes(ticker) || targetCluster.candidates.includes(ticker)) {
        skipped.push(ticker);
        continue;
      }
      
      // Add to candidates (in-memory)
      targetCluster.candidates.push(ticker);
      added.push(ticker);

      // Persist to DB so it survives restarts and shows in list
      if (db) {
        try {
          const themeRow = CLUSTERS.find(c => c.id === themeId);
          if (themeRow) {
            await db.insert(themes).values({
              id: themeId,
              name: themeRow.name,
              tier: themeRow.tier,
              leadersTarget: themeRow.leadersTarget,
              notes: themeRow.notes,
              etfProxies: themeRow.etfProxies,
              updatedAt: new Date(),
            }).onConflictDoUpdate({
              target: themes.id,
              set: { name: themeRow.name, tier: themeRow.tier, updatedAt: new Date() },
            });
          }
          const existing = await db.select({ symbol: tickerTable.symbol }).from(tickerTable).where(eq(tickerTable.symbol, ticker)).limit(1);
          if (existing.length > 0) {
            await db.update(tickerTable).set({ themeId, isCore: false }).where(eq(tickerTable.symbol, ticker));
          } else {
            await db.insert(tickerTable).values({
              symbol: ticker,
              sector: "Unknown",
              industry: "Unknown",
              themeId,
              isCore: false,
              fetchedAt: new Date(),
            }).onConflictDoUpdate({
              target: tickerTable.symbol,
              set: { themeId, isCore: false },
            });
          }

          const [tickerMeta] = await db
            .select({ marketCap: tickerTable.marketCap, industry: tickerTable.industry })
            .from(tickerTable)
            .where(eq(tickerTable.symbol, ticker))
            .limit(1);

          const existingThemeLevel = await db
            .select({ id: tickerSliceMemberships.id })
            .from(tickerSliceMemberships)
            .where(
              and(
                eq(tickerSliceMemberships.symbol, ticker),
                eq(tickerSliceMemberships.themeId, themeId),
                isNull(tickerSliceMemberships.subthemeId)
              )
            )
            .limit(1);

          if (existingThemeLevel.length === 0) {
            await db.insert(tickerSliceMemberships).values({
              symbol: ticker,
              themeId,
              subthemeId: null,
              isAnchor: false,
              isLeaderEligible: false,
              isDefaultVisible: true,
              source: "manual",
              updatedAt: new Date(),
            });
          }

          const inferredSubtheme = !targetSubtheme
            ? inferSubthemeByIndustry(tickerMeta?.industry, themeSubthemes)
            : null;
          const subthemeTarget = targetSubtheme ?? inferredSubtheme;

          if (subthemeTarget) {
            const marketCap = tickerMeta?.marketCap ?? null;
            if (marketCap == null || marketCap < MIN_SUBTHEME_MARKET_CAP) {
              marketCapFiltered.push(ticker);
              if (marketCap == null) {
                deferredData.push(ticker);
              }
            } else {
              await db
                .insert(tickerSliceMemberships)
                .values({
                  symbol: ticker,
                  themeId,
                  subthemeId: subthemeTarget.id,
                  isAnchor: false,
                  isLeaderEligible: false,
                  isDefaultVisible: true,
                  source: "manual",
                  updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: [
                    tickerSliceMemberships.symbol,
                    tickerSliceMemberships.themeId,
                    tickerSliceMemberships.subthemeId,
                  ],
                  set: {
                    isDefaultVisible: true,
                    source: "manual",
                    updatedAt: new Date(),
                  },
                });
              addedToSubtheme.push(ticker);
              if (!targetSubtheme && inferredSubtheme) {
                inferredSubthemeAssignments.push({
                  symbol: ticker,
                  subthemeId: inferredSubtheme.id,
                  subthemeName: inferredSubtheme.name,
                });
              }
            }
          } else if ((tickerMeta?.marketCap ?? null) == null) {
            deferredData.push(ticker);
          }
        } catch (err) {
          console.error(`[MC-API] Failed to persist ${ticker} to DB:`, err);
        }
      }
    }

    if (db && added.length > 0) {
      try {
        await refreshThemeMembersCache();
        // Pull fresh quotes/metrics now so newly added symbols populate immediately.
        await refreshSnapshot(false, "ALL");
      } catch (err) {
        console.error("[MC-API] Failed to refresh theme cache:", err);
      }
    }
    
    console.log(`[MC-API] Added ${added.length} tickers to ${themeId}: ${added.join(", ")}`);
    const uniqueDeferredData = [...new Set(deferredData)];
    
    res.json({
      success: true,
      added,
      addedToSubtheme,
      skipped,
      marketCapFiltered,
      inferredSubthemeAssignments,
      deferredData: uniqueDeferredData,
      message:
        targetSubtheme
          ? `Added ${added.length} ticker(s) to ${targetCluster.name} (${targetSubtheme.name})${
              marketCapFiltered.length > 0 ? `; ${marketCapFiltered.length} skipped under $500M cap` : ""
            }`
          : `Added ${added.length} ticker(s) to ${targetCluster.name}`,
    });
  } catch (error) {
    console.error("[MC-API] Failed to add tickers:", error);
    res.status(500).json({ error: "Failed to add tickers" });
  }
});

/**
 * GET /api/market-condition/briefing/preview
 * Pre/post briefing options with session dates.
 */
router.get("/briefing/preview", async (_req: Request, res: Response) => {
  try {
    touchActivity();
    const { buildBriefingPreviews } = await import("./briefing");
    const preview = await buildBriefingPreviews();
    res.json({ preview });
  } catch (error) {
    console.error("[MC-API] briefing/preview failed:", error);
    res.status(500).json({ error: "Failed to load briefing preview" });
  }
});

/**
 * GET /api/market-condition/briefing?mode=pre|post|auto&synthesize=1
 * Theme-focused market briefing: rule-derived story atoms + GPT-5.1 narrative (fallback: rules).
 */
router.get("/briefing", async (req: Request, res: Response) => {
  try {
    touchActivity();
    const modeRaw = typeof req.query.mode === "string" ? req.query.mode : "auto";
    const synthParam = req.query.synthesize;
    const synthesize =
      synthParam === "0" || synthParam === "false"
        ? false
        : synthParam === "1" || synthParam === "true" || synthParam === undefined;
    const force =
      req.query.force === "1" || req.query.force === "true" || req.query.refresh === "1";
    const { buildThemeBriefing } = await import("./briefing");
    const briefing = await buildThemeBriefing(modeRaw, synthesize, { force });
    res.json(briefing);
  } catch (error) {
    console.error("[MC-API] briefing failed:", error);
    res.status(500).json({ error: "Failed to generate theme briefing" });
  }
});

/**
 * POST /api/market-condition/themes/:id/ticker-review
 * Score theme members with AND/OR criteria (+ optional HVC from daily bars).
 */
router.post("/themes/:id/ticker-review", async (req: Request, res: Response) => {
  try {
    touchActivity();
    const { id } = req.params;
    if (!CLUSTER_IDS.includes(id as ClusterId)) {
      return res.status(400).json({ error: `Invalid theme ID: ${id}` });
    }

    const body = req.body ?? {};
    const mode = (body.mode as string) || "auto";
    const enabledRequired = Array.isArray(body.enabledRequired) ? body.enabledRequired : undefined;
    const enabledOptional = Array.isArray(body.enabledOptional) ? body.enabledOptional : undefined;
    const scope = body.scope === "leaders" ? "leaders" : "theme";
    const maxResults = typeof body.maxResults === "number" ? body.maxResults : 10;

    const members = getClusterMembers(id as ClusterId);
    const leaders = getClusterLeaderCandidates(id as ClusterId);
    const leaderSymbols = new Set(
      leaders.filter((l) => l.isLeader).map((l) => l.symbol.toUpperCase())
    );

    const { getTickerAccDistMap } = await import("./utils/ticker-acc-dist-loader");
    const accDistMap = await getTickerAccDistMap(members.map((m) => m.symbol));

    const themes = getAllThemes();
    const themeMetrics = themes.find((t) => t.id === id);
    let raiLabel = body.raiLabel as "AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE" | undefined;
    if (!raiLabel) {
      try {
        const rai = await calculateRAI(themes);
        raiLabel = rai.label;
      } catch {
        raiLabel = undefined;
      }
    }

    const { runThemeTickerReview } = await import("./ticker-review");
    const result = await runThemeTickerReview(
      id as ClusterId,
      members,
      leaderSymbols,
      accDistMap,
      {
        mode: mode as any,
        enabledRequired,
        enabledOptional,
        raiLabel,
        themeRank: body.themeRank ?? themeMetrics?.rank,
        themeMedianPct: body.themeMedianPct ?? themeMetrics?.medianPct,
        maxResults,
        scope,
      }
    );

    res.json({
      themeId: id,
      themeName: themeMetrics?.name ?? id,
      scanMode: result.scanMode,
      effectiveMode: result.effectiveMode,
      referenceSession: new Date().toISOString(),
      dataQuality: {
        memberCount: result.memberCount,
        patternEnriched: result.patternEnriched,
        hvcEnriched: result.hvcEnriched,
        warnings: result.warnings,
      },
      results: result.results,
      hiddenCount: result.hiddenCount,
    });
  } catch (error) {
    console.error(`[MC-API] ticker-review failed for ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to run ticker review scan" });
  }
});

/**
 * POST /api/market-condition/themes/:id/ticker-review/enrich
 * Batch LLM enrich for starred tickers before View Saved Charts.
 */
router.post("/themes/:id/ticker-review/enrich", async (req: Request, res: Response) => {
  try {
    touchActivity();
    const { id } = req.params;
    if (!CLUSTER_IDS.includes(id as ClusterId)) {
      return res.status(400).json({ error: `Invalid theme ID: ${id}` });
    }

    const body = req.body ?? {};
    const symbols: string[] = Array.isArray(body.symbols)
      ? body.symbols.map((s: string) => String(s).toUpperCase())
      : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!symbols.length) {
      return res.status(400).json({ error: "symbols array required" });
    }

    const themes = getAllThemes();
    const themeMetrics = themes.find((t) => t.id === id);

    const rowBySym = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (row?.symbol) rowBySym.set(String(row.symbol).toUpperCase(), row);
    }

    const { enrichTickerReviewBatch } = await import("./ticker-review/synthesis/engine");
    const items = symbols.map((sym) => ({
      symbol: sym,
      row: rowBySym.get(sym) ?? { symbol: sym, setupNarrative: "", summaryLines: [], firedOptional: [], bucket: "setup_forming", watchScore: 0, patternHits: [], tags: [], tightMa: { fired: false, clusterSize: 0, masInCluster: [], onStack: false, tier: null }, rs: { vsSpy: 0, rankInTheme: 0, memberCount: 0 }, structure: { pctVs20: null, pctVs50: null, pctVs200: null } },
      themeName: themeMetrics?.name,
      themeRank: body.themeRank ?? themeMetrics?.rank,
    }));

    const enriched = await enrichTickerReviewBatch(items);
    const bySymbol: Record<string, { decisionBrief: string; invalidation: string; source: string }> = {};
    for (const e of enriched) {
      bySymbol[e.symbol] = {
        decisionBrief: e.decisionBrief,
        invalidation: e.invalidation,
        source: e.source,
      };
    }

    res.json({ themeId: id, enriched: bySymbol });
  } catch (error) {
    console.error(`[MC-API] ticker-review enrich failed for ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to enrich ticker review" });
  }
});

export default router;
