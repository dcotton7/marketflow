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
import { ClusterId, CLUSTERS, CLUSTER_IDS, OVERLAYS, getAllUniverseTickers, TimeSlice } from "./universe";
import {
  getMarketCondition,
  getMarketConditionWithTimeSlice,
  getThemeById,
  getAllThemes,
  getClusterMembers,
  getClusterLeaderCandidates,
  getAllLeaders,
  getPollingStatus,
  startPolling,
  stopPolling,
  setPollInterval,
  forceRefresh,
  refreshSnapshot,
  touchActivity,
  getSleepStatus,
} from "./engine/snapshot";
import { calculateRAI, getCachedRAI } from "./engine/rai";
import { getMarketRegimeForScanner } from "./exports";
import { db } from "../db";
import { tnnSettings, tickers, themes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { refreshThemeMembersCache } from "./utils/theme-db-loader";

const router = Router();

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
    const sizeFilter = (req.query.sizeFilter as string || "ALL") as any;
    const useIntradayBaseline = req.query.useIntradayBaseline === "true";
    
    // Validate timeSlice
    const validTimeSlices: TimeSlice[] = ["TODAY", "15M", "30M", "1H", "4H", "1D", "5D", "1W", "1M", "3M", "6M", "YTD"];
    const validatedTimeSlice: TimeSlice = validTimeSlices.includes(timeSlice) ? timeSlice : "TODAY";
    
    // Validate sizeFilter
    const validSizeFilters = ["ALL", "MEGA", "LARGE", "MID", "SMALL", "MICRO"];
    const validatedSizeFilter = validSizeFilters.includes(sizeFilter) ? sizeFilter : "ALL";
    
    // Get condition with appropriate deltaRank calculation
    // ALWAYS force fresh calculation for ANY size filter to prevent cache poisoning
    let condition;
    if (useIntradayBaseline || validatedSizeFilter !== "ALL") {
      // Force fresh snapshot with filters
      await refreshSnapshot(useIntradayBaseline, validatedSizeFilter as any);
      condition = getMarketCondition();
    } else if (validatedTimeSlice !== "TODAY") {
      // Use historical comparison for non-default time slices
      console.log(`[MC-API] Themes requested with timeSlice=${validatedTimeSlice} (historical comparison)`);
      condition = await getMarketConditionWithTimeSlice(validatedTimeSlice);
    } else {
      // ALWAYS refresh for "ALL" to clear any previous filter cache
      await refreshSnapshot(useIntradayBaseline, "ALL");
      condition = getMarketCondition();
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
  "1W": 12,  // Fetch 12 calendar days, use the 5th trading day back
  "1M": 35,  // Fetch 35 calendar days, use the 21st trading day back
};

// Intraday time slices: fetch 5-min bars for last 2 calendar days to cover comparison time
const INTRADAY_TIME_SLICES: TimeSlice[] = ["15M", "30M", "1H", "4H"];

// Number of trading days to look back for each time slice
const TRADING_DAYS_BACK: Partial<Record<TimeSlice, number>> = {
  "1D": 1,
  "1W": 5,
  "1M": 21,
};

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
      const { getHistoricalSnapshot, getMarketDateTime } = await import("./engine/theme-snapshots");
      const { date: marketDate, hour: marketHour } = getMarketDateTime();
      const histResult = await getHistoricalSnapshot(timeSlice, marketDate, marketHour);
      if (histResult && histResult.comparisonTime) {
        comparisonTimeIso = String(histResult.comparisonTime);
        comparisonDateIso = comparisonTimeIso.split("T")[0];
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
router.get("/status", async (req: Request, res: Response) => {
  try {
    touchActivity(); // Keep server awake - status is polled every 5s when page is open
    const status = getPollingStatus();
    const sleepStatus = getSleepStatus();
    const universeSize = getAllUniverseTickers().length;
    
    res.json({
      ...status,
      ...sleepStatus,
      universeSize,
      clusterCount: CLUSTERS.length,
      overlayCount: OVERLAYS.length,
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
    const { id } = req.params;
    const { tickers, force } = req.body as { tickers: string[]; force?: boolean };
    
    if (!CLUSTER_IDS.includes(id as ClusterId)) {
      return res.status(400).json({ error: `Invalid theme ID: ${id}` });
    }
    
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return res.status(400).json({ error: "No tickers provided" });
    }
    
    // Normalize tickers
    const normalizedTickers = tickers.map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
    
    // Check for conflicts
    const conflicts: Array<{ ticker: string; existingTheme: string; isCore: boolean }> = [];
    const targetCluster = CLUSTERS.find(c => c.id === id);
    
    if (!targetCluster) {
      return res.status(404).json({ error: "Theme not found" });
    }
    
    for (const ticker of normalizedTickers) {
      // Check if already in target theme
      if (targetCluster.core.includes(ticker) || targetCluster.candidates.includes(ticker)) {
        conflicts.push({ ticker, existingTheme: id, isCore: targetCluster.core.includes(ticker) });
        continue;
      }
      
      // Check other themes
      for (const cluster of CLUSTERS) {
        if (cluster.id === id) continue;
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
          const themeRow = CLUSTERS.find(c => c.id === id);
          if (themeRow) {
            await db.insert(themes).values({
              id: id,
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
          const existing = await db.select({ symbol: tickers.symbol }).from(tickers).where(eq(tickers.symbol, ticker)).limit(1);
          if (existing.length > 0) {
            await db.update(tickers).set({ themeId: id, isCore: false }).where(eq(tickers.symbol, ticker));
          } else {
            await db.insert(tickers).values({
              symbol: ticker,
              sector: "Unknown",
              industry: "Unknown",
              themeId: id,
              isCore: false,
              fetchedAt: new Date(),
            }).onConflictDoUpdate({
              target: tickers.symbol,
              set: { themeId: id, isCore: false },
            });
          }
        } catch (err) {
          console.error(`[MC-API] Failed to persist ${ticker} to DB:`, err);
        }
      }
    }

    if (db && added.length > 0) {
      try {
        await refreshThemeMembersCache();
      } catch (err) {
        console.error("[MC-API] Failed to refresh theme cache:", err);
      }
    }
    
    console.log(`[MC-API] Added ${added.length} tickers to ${id}: ${added.join(", ")}`);
    
    res.json({
      success: true,
      added,
      skipped,
      message: `Added ${added.length} ticker(s) to ${targetCluster.name}`,
    });
  } catch (error) {
    console.error("[MC-API] Failed to add tickers:", error);
    res.status(500).json({ error: "Failed to add tickers" });
  }
});

export default router;
