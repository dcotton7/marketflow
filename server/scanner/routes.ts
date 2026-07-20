// ---------------------------------------------------------------------------
// Scanner API Routes
//
// Endpoints:
//   GET  /api/scanner/stream    — SSE stream for real-time discovery cards
//   GET  /api/scanner/history   — recent discoveries (last 100, or by date)
//   GET  /api/scanner/status    — current scanner state
//   POST /api/scanner/mode      — set scanner mode (on/silent/off)
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from "express";
import OpenAI from "openai";
import type {
  DiscoveryCard,
  DiscoveryFilterFields,
  ScannerMode,
  ScannerStatus,
  ThemeMembershipResult,
} from "@shared/scanner-types";

function hydrateDiscoveryFilters(
  context: DiscoveryCard["context"] | Record<string, unknown> | null | undefined
): Pick<DiscoveryCard, "themePercentile" | "themeRank" | "priorDayDollarVol" | "context"> {
  const ctx = (context ?? {}) as DiscoveryCard["context"];
  const stored = ctx.discovery_filters as DiscoveryFilterFields | undefined;
  const membership = ctx.theme_membership as ThemeMembershipResult | undefined;
  return {
    context: ctx,
    themePercentile: stored?.themePercentile ?? membership?.themePercentile ?? null,
    themeRank: stored?.themeRank ?? membership?.themeRank ?? null,
    priorDayDollarVol: stored?.priorDayDollarVol ?? null,
  };
}
import { DEFAULT_SCANNER_CONFIG } from "@shared/scanner-config";
import { getScannerState, setScannerMode } from "./index";
import { getScannerConfig, setScannerConfig, currentFrame } from "./signal-producer";
import {
  getAllActiveCatalysts,
  getCatalystRules,
  updateCatalystRule,
  resolveCatalyst,
} from "./catalyst";
import { getSessionPatternsForApi } from "./session-patterns";
import { getMaDataForScanner } from "../market-condition/engine/snapshot";
import { getDailyBarRefreshStatus, isDailyBarApiHealthy } from "../data-layer/daily-bar-refresh";
import { getScannerPicks } from "./reactions/watchlist-add";
// heat map disabled — no frontend consumer
import { db } from "../db";
import { scannerDiscoveries } from "@shared/schema";
import { desc, eq, and, gte, lte, sql, isNull, isNotNull } from "drizzle-orm";
import { getCachedEarningsData } from "../fundamentals";

const router = Router();

// ── SSE client registry ─────────────────────────────────────────────────────

const sseClients = new Set<Response>();

export function broadcastDiscovery(card: DiscoveryCard): void {
  const payload = `data: ${JSON.stringify(card)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function broadcastBatch(cards: DiscoveryCard[]): void {
  for (const card of cards) broadcastDiscovery(card);
}

export function broadcastClear(events: Array<{
  type: "discovery_clear";
  signalType: string;
  subject: string;
  cardIds: number[];
  reason: string;
}>): void {
  for (const event of events) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }
}

// ── In-memory discovery buffer + DB persistence ────────────────────────────

const DISCOVERY_BUFFER_MAX = 200;
const discoveryBuffer: DiscoveryCard[] = [];

export function pushDiscoveries(cards: DiscoveryCard[]): void {
  discoveryBuffer.push(...cards);
  if (discoveryBuffer.length > DISCOVERY_BUFFER_MAX) {
    discoveryBuffer.splice(0, discoveryBuffer.length - DISCOVERY_BUFFER_MAX);
  }
  persistToDb(cards);
}

/** Drop cards from the live memory buffer (e.g. LOD bounce invalidated). */
export function removeDiscoveries(cardIds: number[]): void {
  if (cardIds.length === 0) return;
  const idSet = new Set(cardIds);
  for (let i = discoveryBuffer.length - 1; i >= 0; i--) {
    if (idSet.has(discoveryBuffer[i]!.id)) {
      discoveryBuffer.splice(i, 1);
    }
  }
}

function persistToDb(cards: DiscoveryCard[]): void {
  if (!db || cards.length === 0) return;
  const frame = currentFrame();
  const rows = cards.map((c) => {
    let priceAtSignal: number | null = null;
    if (c.subjectKind === "ticker" && frame) {
      const tick = frame.tickers.get(c.subject);
      if (tick) priceAtSignal = tick.price;
    }
    return {
      pipelineId: c.pipelineId,
      pipelineName: c.pipelineName,
      signalType: c.signalType,
      subject: c.subject,
      subjectKind: c.subjectKind,
      direction: c.direction,
      magnitude: String(c.magnitude ?? 0),
      priority: c.priority ?? "normal",
      headline: c.headline,
      narrative: c.narrative,
      tickers: c.tickers ?? [],
      themeId: c.themeId ?? null,
      qualifyScore: String(c.qualifyScore ?? 0),
      contextJson: c.context ?? null,
      createdAt: new Date(c.createdAt),
      priceAtSignal,
      regimeAtSignal: frame?.regime ?? null,
      sessionAtSignal: frame ? getScannerState().sessionMode : null,
      raiAtSignal: frame?.rai ?? null,
    };
  });
  db.insert(scannerDiscoveries)
    .values(rows)
    .then(() => {})
    .catch((err) => console.warn("[Scanner DB] Persist failed:", String(err).slice(0, 150)));
}

// Flush any cards already in memory to DB on first import (catches cards created before wiring)
setTimeout(() => {
  if (discoveryBuffer.length > 0) {
    console.log(`[Scanner DB] Flushing ${discoveryBuffer.length} in-memory cards to DB...`);
    persistToDb(discoveryBuffer);
  }
}, 5_000);

// ── GET /stream — SSE endpoint ──────────────────────────────────────────────

router.get("/stream", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

  sseClients.add(res);
  console.log(`[Scanner SSE] Client connected (${sseClients.size} total)`);

  req.on("close", () => {
    sseClients.delete(res);
    console.log(`[Scanner SSE] Client disconnected (${sseClients.size} remaining)`);
  });
});

// ── GET /history — recent discoveries (DB-backed with memory fallback) ──────

router.get("/history", async (_req: Request, res: Response) => {
  const limit = Math.min(200, parseInt(String(_req.query.limit) || "50", 10));
  const dateFilter = _req.query.date as string | undefined;
  const signalFilter = _req.query.signal_type as string | undefined;
  const subjectFilter = (_req.query.subject as string | undefined)?.toUpperCase();

  if (!db) {
    const recent = discoveryBuffer.slice(-limit).reverse();
    return res.json({ discoveries: recent, total: discoveryBuffer.length, source: "memory" });
  }

  try {
    const conditions = [];
    if (dateFilter) {
      // Inclusive single day — previously only gte, so older "date=" queries leaked later days.
      conditions.push(gte(scannerDiscoveries.createdAt, new Date(dateFilter + "T00:00:00.000Z")));
      conditions.push(lte(scannerDiscoveries.createdAt, new Date(dateFilter + "T23:59:59.999Z")));
    }
    if (signalFilter) {
      conditions.push(eq(scannerDiscoveries.signalType, signalFilter));
    }
    if (subjectFilter) {
      conditions.push(eq(scannerDiscoveries.subject, subjectFilter));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(scannerDiscoveries)
      .where(where)
      .orderBy(desc(scannerDiscoveries.createdAt))
      .limit(limit);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(scannerDiscoveries)
      .where(where);

    const cards: DiscoveryCard[] = rows.map((r) => {
      const filters = hydrateDiscoveryFilters(r.contextJson as DiscoveryCard["context"]);
      return {
        id: r.id,
        pipelineId: r.pipelineId,
        pipelineName: r.pipelineName,
        signalType: r.signalType as DiscoveryCard["signalType"],
        subject: r.subject,
        subjectKind: r.subjectKind as "ticker" | "theme" | "market",
        direction: r.direction as "up" | "down" | "neutral",
        magnitude: Number(r.magnitude),
        priority: r.priority as "normal" | "high" | "urgent",
        headline: r.headline,
        narrative: r.narrative,
        tickers: r.tickers ?? [],
        themeId: r.themeId ?? null,
        qualifyScore: Number(r.qualifyScore),
        context: filters.context,
        createdAt: r.createdAt.toISOString(),
        themePercentile: filters.themePercentile,
        themeRank: filters.themeRank,
        priorDayDollarVol: filters.priorDayDollarVol,
      };
    });

    res.json({ discoveries: cards, total: Number(countResult[0]?.count ?? 0), source: "db" });
  } catch (err) {
    console.warn("[Scanner DB] History query failed, falling back to memory:", String(err).slice(0, 150));
    const recent = discoveryBuffer.slice(-limit).reverse();
    res.json({ discoveries: recent, total: discoveryBuffer.length, source: "memory" });
  }
});

// ── GET /status — scanner state ─────────────────────────────────────────────

router.get("/status", (_req: Request, res: Response) => {
  const state = getScannerState();
  const status: ScannerStatus = {
    mode: state.mode,
    universeSize: state.universeSize,
    activePipelines: state.activePipelines,
    lastSignalAt: state.lastSignalAt,
    discoveriesToday: discoveryBuffer.filter((d) => {
      const today = new Date().toISOString().slice(0, 10);
      return d.createdAt.startsWith(today);
    }).length,
    sessionMode: state.sessionMode,
  };
  res.json(status);
});

// ── POST /mode — toggle scanner mode ────────────────────────────────────────

router.post("/mode", (req: Request, res: Response) => {
  const { mode } = req.body as { mode?: ScannerMode };
  if (!mode || !["on", "silent", "off"].includes(mode)) {
    return res.status(400).json({ error: "Invalid mode. Use: on, silent, off" });
  }
  setScannerMode(mode);
  res.json({ mode });
});

// ── GET /session-patterns — multi-day intraday patterns ─────────────────────

router.get("/session-patterns", async (_req: Request, res: Response) => {
  const lookback = parseInt(String(_req.query.lookback ?? "10"), 10);
  const result = await getSessionPatternsForApi(lookback);
  res.json(result);
});

// ── GET /catalysts/queue — active catalyst entries ──────────────────────────

router.get("/catalysts/queue", (_req: Request, res: Response) => {
  const active = getAllActiveCatalysts();
  res.json({
    catalysts: active,
    total: active.length,
  });
});

// ── GET /catalysts/rules — catalyst rule definitions ────────────────────────

router.get("/catalysts/rules", (_req: Request, res: Response) => {
  const rules = getCatalystRules();
  res.json({ rules, total: rules.length });
});

// ── PUT /catalysts/rules/:id — update a catalyst rule ────────────────────

router.put("/catalysts/rules/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body;
  if (!updates || typeof updates !== "object") {
    return res.status(400).json({ error: "Body must be an object" });
  }
  const result = await updateCatalystRule(id!, updates);
  if (!result) {
    return res.status(404).json({ error: "Rule not found or update failed" });
  }
  res.json({ rule: result });
});

// ── POST /catalysts/resolve/:id — resolve/dismiss a catalyst ─────────────

router.post("/catalysts/resolve/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id!, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid catalyst id" });
  }
  const magnitude = typeof req.body?.magnitude === "number" ? req.body.magnitude : 0;
  await resolveCatalyst(id, magnitude);
  res.json({ resolved: true, id });
});

// ── GET /config — current scanner config ─────────────────────────────────────

router.get("/config", (_req: Request, res: Response) => {
  res.json({
    config: getScannerConfig(),
    defaults: DEFAULT_SCANNER_CONFIG,
  });
});

// ── PUT /config — update scanner config ──────────────────────────────────────

router.put("/config", (req: Request, res: Response) => {
  const updates = req.body as Record<string, unknown>;
  if (!updates || typeof updates !== "object") {
    return res.status(400).json({ error: "Body must be an object of config fields" });
  }

  // Validate: only accept known keys
  const validKeys = new Set(Object.keys(DEFAULT_SCANNER_CONFIG));
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (validKeys.has(k)) clean[k] = v;
  }

  setScannerConfig(clean as any);
  console.log(`[Scanner] Config updated: ${Object.keys(clean).join(", ")}`);
  res.json({ config: getScannerConfig() });
});

// ── GET /debug/bar-health — daily bar refresh status ─────────────────────────

router.get("/debug/bar-health", (_req: Request, res: Response) => {
  res.json(getDailyBarRefreshStatus());
});

// ── GET /debug/ma/:symbol — inspect MA values for a ticker ──────────────────

router.get("/debug/ma/:symbol", (req: Request, res: Response) => {
  const symbol = (req.params.symbol ?? "").toUpperCase();
  const maData = getMaDataForScanner();
  const entry = maData.get(symbol);
  if (!entry) {
    return res.json({ symbol, found: false, totalMaEntries: maData.size });
  }
  res.json({ symbol, found: true, ...entry, totalMaEntries: maData.size });
});

// ── GET /debug/ma — dump all MA data ────────────────────────────────────────

router.get("/debug/ma", (_req: Request, res: Response) => {
  const maData = getMaDataForScanner();
  const entries: Record<string, any> = {};
  maData.forEach((v, k) => { entries[k] = v; });
  res.json({ total: maData.size, sample: Object.fromEntries(Object.entries(entries).slice(0, 20)) });
});

// ── GET /picks — scanner auto-watchlist picks for the session ────────────────

router.get("/picks", (_req: Request, res: Response) => {
  const picks = getScannerPicks();
  res.json({ picks, total: picks.length, date: new Date().toISOString().slice(0, 10) });
});

// ── Workbench: GET /workbench/hit-rates — aggregated signal hit rate data ─────

type WindowKey = "15m" | "30m" | "1hr" | "4hr" | "d1_close" | "d2_open" | "d2_close" | "1w" | "1mo";
const WINDOW_MOVE_COL: Record<WindowKey, string> = {
  "15m": "move15m", "30m": "move30m", "1hr": "move1hr", "4hr": "move4hr",
  d1_close: "moveD1Close", d2_open: "moveD2Open", d2_close: "moveD2Close",
  "1w": "move1w", "1mo": "move1mo",
};

router.get("/workbench/hit-rates", async (req: Request, res: Response) => {
  if (!db) return res.status(503).json({ error: "Database not available" });

  const from = (req.query.from as string) || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
  const hitThreshold = parseFloat(String(req.query.hit_threshold ?? "0.5"));
  const minSamples = parseInt(String(req.query.min_samples ?? "5"), 10);
  const sessionFilter = req.query.session as string | undefined;
  const window = (req.query.window as WindowKey) || "1hr";

  try {
    const conditions = [
      gte(scannerDiscoveries.createdAt, new Date(from + "T00:00:00Z")),
      lte(scannerDiscoveries.createdAt, new Date(to + "T23:59:59Z")),
    ];
    if (sessionFilter && sessionFilter !== "all") {
      conditions.push(eq(scannerDiscoveries.sessionAtSignal, sessionFilter));
    }

    const rows = await db
      .select()
      .from(scannerDiscoveries)
      .where(and(...conditions))
      .orderBy(desc(scannerDiscoveries.createdAt));

    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = grouped.get(row.signalType) || [];
      list.push(row);
      grouped.set(row.signalType, list);
    }

    const moveCol = WINDOW_MOVE_COL[window] || "move1hr";

    const signalTypes = [];
    for (const [signalType, entries] of grouped) {
      const totalFired = entries.length;
      const tracked = entries.filter((r) => (r as any)[moveCol] != null).length;

      if (tracked < minSamples) {
        signalTypes.push({ signalType, totalFired, tracked, hitRate: null, avgMove: null, avgPeakMove: null, avgGiveback: null, failRate: null, reversalRate: null, mfe3Rate: null, mae3Rate: null });
        continue;
      }

      const withData = entries.filter((r) => (r as any)[moveCol] != null);
      let hits = 0;
      let totalMove = 0;
      for (const r of withData) {
        const move = Number((r as any)[moveCol]);
        totalMove += move;
        const isHit =
          (r.direction === "up" && move >= hitThreshold) ||
          (r.direction === "down" && move <= -hitThreshold);
        if (isHit) hits++;
      }

      const withPeak = entries.filter((r) => r.peakMove != null);
      const avgPeakMove = withPeak.length > 0
        ? Math.round((withPeak.reduce((s, r) => s + Number(r.peakMove), 0) / withPeak.length) * 100) / 100
        : null;

      const withGiveback = entries.filter((r) => r.givebackPct != null);
      const avgGiveback = withGiveback.length > 0
        ? Math.round((withGiveback.reduce((s, r) => s + Number(r.givebackPct), 0) / withGiveback.length) * 100) / 100
        : null;

      const failCount = entries.filter((r) => r.outcomeFailed === true).length;
      const reversalCount = entries.filter((r) => r.outcomeStatus === "reversed").length;

      // MFE/MAE distribution: % of tracked signals that hit +3% or worse than -3%
      const mfe3PctCount = withPeak.filter((r) => Number(r.peakMove) >= 3).length;
      const mae3PctCount = entries.filter((r) => r.worstDrawdown != null && Number(r.worstDrawdown) <= -3).length;
      const mfe3Rate = withPeak.length > 0 ? Math.round((mfe3PctCount / withPeak.length) * 1000) / 1000 : null;
      const mae3Rate = entries.filter((r) => r.worstDrawdown != null).length > 0
        ? Math.round((mae3PctCount / entries.filter((r) => r.worstDrawdown != null).length) * 1000) / 1000
        : null;

      signalTypes.push({
        signalType,
        totalFired,
        tracked,
        hitRate: withData.length > 0 ? Math.round((hits / withData.length) * 1000) / 1000 : 0,
        avgMove: withData.length > 0 ? Math.round((totalMove / withData.length) * 100) / 100 : 0,
        avgPeakMove,
        avgGiveback,
        failRate: totalFired > 0 ? Math.round((failCount / totalFired) * 1000) / 1000 : 0,
        reversalRate: totalFired > 0 ? Math.round((reversalCount / totalFired) * 1000) / 1000 : 0,
        mfe3Rate,
        mae3Rate,
      });
    }

    signalTypes.sort((a, b) => b.totalFired - a.totalFired);

    res.json({
      signalTypes,
      dateRange: { from, to },
      hitThreshold,
      window,
    });
  } catch (err) {
    console.warn("[Workbench] hit-rates error:", String(err).slice(0, 150));
    res.status(500).json({ error: "Query failed" });
  }
});

// ── Workbench: GET /workbench/cards — individual cards with outcomes ──────────

router.get("/workbench/cards", async (req: Request, res: Response) => {
  if (!db) return res.status(503).json({ error: "Database not available" });

  const signalType = req.query.signal_type as string | undefined;
  const from = (req.query.from as string) || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
  const statusFilter = (req.query.status as string) || "all";
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "50"), 10));
  const offset = parseInt(String(req.query.offset ?? "0"), 10);

  try {
    const conditions = [
      gte(scannerDiscoveries.createdAt, new Date(from + "T00:00:00Z")),
      lte(scannerDiscoveries.createdAt, new Date(to + "T23:59:59Z")),
    ];
    if (signalType) conditions.push(eq(scannerDiscoveries.signalType, signalType));
    if (statusFilter && statusFilter !== "all") {
      conditions.push(eq(scannerDiscoveries.outcomeStatus, statusFilter));
    }

    let rows = await db
      .select()
      .from(scannerDiscoveries)
      .where(and(...conditions))
      .orderBy(desc(scannerDiscoveries.createdAt))
      .limit(limit + offset);

    rows = rows.slice(offset);

    const cards = rows.slice(0, limit).map((r) => ({
      id: r.id,
      pipelineId: r.pipelineId,
      pipelineName: r.pipelineName,
      signalType: r.signalType,
      subject: r.subject,
      subjectKind: r.subjectKind,
      direction: r.direction,
      magnitude: Number(r.magnitude),
      priority: r.priority,
      headline: r.headline,
      narrative: r.narrative,
      tickers: r.tickers ?? [],
      themeId: r.themeId ?? null,
      qualifyScore: Number(r.qualifyScore),
      context: (r.contextJson as Record<string, unknown>) ?? {},
      createdAt: r.createdAt.toISOString(),
      priceAtSignal: r.priceAtSignal,
      // 9 checkpoints
      price15m: r.price15m, move15m: r.move15m,
      price30m: r.price30m, move30m: r.move30m,
      price1hr: r.price1hr, move1hr: r.move1hr,
      price4hr: r.price4hr, move4hr: r.move4hr,
      priceD1Close: r.priceD1Close, moveD1Close: r.moveD1Close,
      priceD2Open: r.priceD2Open, moveD2Open: r.moveD2Open,
      priceD2Close: r.priceD2Close, moveD2Close: r.moveD2Close,
      price1w: r.price1w, move1w: r.move1w,
      price1mo: r.price1mo, move1mo: r.move1mo,
      // MFE/MAE
      peakMove: r.peakMove,
      peakPrice: r.peakPrice,
      peakAt: r.peakAt?.toISOString() ?? null,
      worstDrawdown: r.worstDrawdown,
      troughPrice: r.troughPrice,
      troughAt: r.troughAt?.toISOString() ?? null,
      givebackPct: r.givebackPct,
      // Status
      outcomeStatus: r.outcomeStatus,
      outcomeFailed: r.outcomeFailed,
      failedAt: r.failedAt?.toISOString() ?? null,
      // Metadata
      regimeAtSignal: r.regimeAtSignal,
      sessionAtSignal: r.sessionAtSignal,
      raiAtSignal: r.raiAtSignal,
      outcomeTrackedAt: r.outcomeTrackedAt?.toISOString() ?? null,
    }));

    res.json({ cards, total: cards.length });
  } catch (err) {
    console.warn("[Workbench] cards error:", String(err).slice(0, 150));
    res.status(500).json({ error: "Query failed" });
  }
});

// ── Workbench: POST /workbench/ai-analyze — AI-powered signal analysis ────────

const WORKBENCH_AI_MODEL = "gpt-4.1-mini";

const WORKBENCH_ANALYZE_SYSTEM_PROMPT = `You are a quantitative trading signal analyst. You're reviewing scanner signal performance data from a stock market scanning system. You have both aggregate statistics AND individual signal details (sample of recent signals with their checkpoint moves, MFE, MAE, and outcomes). Analyze the data and provide:

1. Which signal types are performing best and worst
2. What the hit rates, MFE, and MAE tell us about signal quality
3. How a trader following the best signals would have fared
4. Any patterns or concerns (e.g., high giveback, high fail rates, time-of-day effects)
5. Specific recommendations for which signals to trust vs ignore
6. Notable individual signals (outliers, best/worst performers, interesting patterns in the sample data)

Be direct, specific, and use the actual numbers. Reference individual signals when they illustrate a point. Think like a prop desk analyst.`;

const WORKBENCH_QUESTION_SYSTEM_PROMPT = `You are a quantitative trading signal analyst. You have access to scanner signal performance data from a stock market scanning system, including both aggregate stats and individual signal details (checkpoint moves, MFE/MAE, outcomes, time of day, regime). The user will ask you a specific question about this data. Answer using the actual numbers from the data provided. Reference individual signals when relevant. Be direct and specific. Think like a prop desk analyst.`;

function formatStatsForPrompt(stats: any[], window: string, hitThreshold: number, dateRange: { from: string; to: string }, cards?: any[]): string {
  let text = `Signal Performance Data\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `Date Range: ${dateRange.from} to ${dateRange.to}\n`;
  text += `Measurement Window: ${window}\n`;
  text += `Hit Threshold: ${hitThreshold}%\n\n`;

  if (!stats || stats.length === 0) {
    text += `No signal data available for this period.\n`;
    return text;
  }

  text += `AGGREGATE STATS:\n`;
  text += `Signal Type | Fired | Tracked | Hit% | Avg Move | Avg Peak (MFE) | Avg Giveback | Fail% | Reversal% | MFE≥3% | MAE≤-3%\n`;
  text += `${"─".repeat(120)}\n`;

  for (const s of stats) {
    const hitRate = s.hitRate != null ? `${Math.round(s.hitRate * 100)}%` : "—";
    const avgMove = s.avgMove != null ? `${s.avgMove >= 0 ? "+" : ""}${s.avgMove.toFixed(2)}%` : "—";
    const avgPeak = s.avgPeakMove != null ? `+${s.avgPeakMove.toFixed(2)}%` : "—";
    const avgGive = s.avgGiveback != null ? `${s.avgGiveback.toFixed(1)}%` : "—";
    const failRate = s.failRate != null ? `${Math.round(s.failRate * 100)}%` : "—";
    const revRate = s.reversalRate != null ? `${Math.round(s.reversalRate * 100)}%` : "—";
    const mfe3 = s.mfe3Rate != null ? `${Math.round(s.mfe3Rate * 100)}%` : "—";
    const mae3 = s.mae3Rate != null ? `${Math.round(s.mae3Rate * 100)}%` : "—";

    text += `${s.signalType} | ${s.totalFired} | ${s.tracked} | ${hitRate} | ${avgMove} | ${avgPeak} | ${avgGive} | ${failRate} | ${revRate} | ${mfe3} | ${mae3}\n`;
  }

  // Detailed individual signals section
  if (cards && cards.length > 0) {
    const sample = cards.slice(0, 50);
    text += `\n\nDETAILED SIGNALS (sample of ${sample.length}/${cards.length} signals):\n`;
    text += `${"─".repeat(120)}\n`;

    for (const c of sample) {
      const time = c.createdAt ? new Date(c.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "?";
      const dir = c.direction === "up" ? "LONG" : c.direction === "down" ? "SHORT" : "NEUT";
      const price = c.priceAtSignal != null ? `$${Number(c.priceAtSignal).toFixed(2)}` : "—";

      // Checkpoint moves (only filled ones)
      const moves: string[] = [];
      if (c.move15m != null) moves.push(`15m:${Number(c.move15m) >= 0 ? "+" : ""}${Number(c.move15m).toFixed(1)}%`);
      if (c.move30m != null) moves.push(`30m:${Number(c.move30m) >= 0 ? "+" : ""}${Number(c.move30m).toFixed(1)}%`);
      if (c.move1hr != null) moves.push(`1hr:${Number(c.move1hr) >= 0 ? "+" : ""}${Number(c.move1hr).toFixed(1)}%`);
      if (c.move4hr != null) moves.push(`4hr:${Number(c.move4hr) >= 0 ? "+" : ""}${Number(c.move4hr).toFixed(1)}%`);
      if (c.moveD1Close != null) moves.push(`D1C:${Number(c.moveD1Close) >= 0 ? "+" : ""}${Number(c.moveD1Close).toFixed(1)}%`);
      const movesStr = moves.length > 0 ? moves.join(" ") : "no checkpoints yet";

      const mfe = c.peakMove != null ? `MFE:+${Number(c.peakMove).toFixed(1)}%` : "";
      const mae = c.worstDrawdown != null ? `MAE:${Number(c.worstDrawdown).toFixed(1)}%` : "";
      const status = c.outcomeStatus ?? "pending";
      const regime = c.regimeAtSignal ?? "?";

      text += `[${c.signalType}] ${c.subject} ${dir} ${price} | ${time} | ${movesStr} | ${mfe} ${mae} | ${status} | regime:${regime}\n`;
      if (c.headline) text += `  "${c.headline}"\n`;
    }
  }

  return text;
}

router.post("/workbench/ai-analyze", async (req: Request, res: Response) => {
  const { mode, question, stats: clientStats, window: winParam, hitThreshold: htParam, dateRange, cards: clientCards } = req.body as {
    mode: "analyze" | "question";
    question?: string;
    stats: any[];
    cards?: any[];
    window: string;
    hitThreshold: number;
    dateRange: { from: string; to: string };
  };

  if (!mode || !["analyze", "question"].includes(mode)) {
    return res.status(400).json({ error: "Invalid mode. Use: analyze, question" });
  }
  if (mode === "question" && (!question || !question.trim())) {
    return res.status(400).json({ error: "Question is required for question mode" });
  }

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "OpenAI API key not configured" });
  }

  const openai = new OpenAI({ apiKey, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

  const dataContext = formatStatsForPrompt(
    clientStats ?? [],
    winParam ?? "1hr",
    htParam ?? 0.5,
    dateRange ?? { from: "unknown", to: "unknown" },
    clientCards
  );

  const systemPrompt = mode === "analyze" ? WORKBENCH_ANALYZE_SYSTEM_PROMPT : WORKBENCH_QUESTION_SYSTEM_PROMPT;
  let userPrompt: string;

  if (mode === "analyze") {
    userPrompt = `Here is the current signal performance data from our scanner workbench:\n\n${dataContext}\n\nPlease analyze this data comprehensively.`;
  } else {
    userPrompt = `Here is the current signal performance data from our scanner workbench:\n\n${dataContext}\n\nUser question: ${question}`;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: WORKBENCH_AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 3000,
    });

    const analysis = completion.choices[0]?.message?.content ?? "No response generated.";
    res.json({ analysis });
  } catch (err: any) {
    console.warn("[Workbench AI] Analysis failed:", String(err).slice(0, 200));
    res.status(500).json({ error: "AI analysis failed: " + (err?.message ?? "Unknown error") });
  }
});

// ── GET /upcoming-earnings — batch next-earnings dates for given symbols ─────

export interface UpcomingEarningsEntry {
  symbol: string;
  nextEarningsDate: string | null;
  nextEarningsDays: number;
  earningsTime: string | null;
}

const upcomingEarningsCache = new Map<string, { data: UpcomingEarningsEntry; ts: number }>();
const UPCOMING_EARNINGS_TTL = 24 * 60 * 60 * 1000;

router.get("/upcoming-earnings", async (req: Request, res: Response) => {
  const raw = String(req.query.symbols || "");
  if (!raw) return res.status(400).json({ error: "symbols query param required" });

  const symbols = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  if (symbols.length === 0) return res.status(400).json({ error: "No valid symbols provided" });

  const results: UpcomingEarningsEntry[] = [];

  await Promise.all(
    symbols.map(async (sym) => {
      const cached = upcomingEarningsCache.get(sym);
      if (cached && Date.now() - cached.ts < UPCOMING_EARNINGS_TTL) {
        // Recalculate days for cached entries (stored value is a snapshot)
        if (cached.data.nextEarningsDate && cached.data.nextEarningsDate !== "N/A") {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          cached.data.nextEarningsDays = Math.ceil(
            (new Date(cached.data.nextEarningsDate + "T00:00:00").getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );
        }
        results.push(cached.data);
        return;
      }

      const earningsData = await getCachedEarningsData(sym);
      const entry: UpcomingEarningsEntry = {
        symbol: sym,
        nextEarningsDate: earningsData?.nextEarningsDate ?? null,
        nextEarningsDays: earningsData?.nextEarningsDays ?? -1,
        earningsTime: earningsData?.earningsTime ?? null,
      };

      // Recalculate days if we have a date but days might be stale
      if (entry.nextEarningsDate && entry.nextEarningsDate !== "N/A") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const earningsDate = new Date(entry.nextEarningsDate);
        entry.nextEarningsDays = Math.ceil(
          (earningsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      upcomingEarningsCache.set(sym, { data: entry, ts: Date.now() });
      results.push(entry);
    })
  );

  results.sort((a, b) => {
    if (a.nextEarningsDays < 0 && b.nextEarningsDays < 0) return 0;
    if (a.nextEarningsDays < 0) return 1;
    if (b.nextEarningsDays < 0) return -1;
    return a.nextEarningsDays - b.nextEarningsDays;
  });

  res.json({ earnings: results });
});

export default router;
