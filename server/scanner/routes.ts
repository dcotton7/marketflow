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
import type { DiscoveryCard, ScannerMode, ScannerStatus } from "@shared/scanner-types";
import { DEFAULT_SCANNER_CONFIG } from "@shared/scanner-config";
import { getScannerState, setScannerMode } from "./index";
import { getScannerConfig, setScannerConfig } from "./signal-producer";
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
import { getHeatScores } from "./reactions/score-update";

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

// ── In-memory discovery buffer (last 200, flushed to DB periodically) ───────

const DISCOVERY_BUFFER_MAX = 200;
const discoveryBuffer: DiscoveryCard[] = [];

export function pushDiscoveries(cards: DiscoveryCard[]): void {
  discoveryBuffer.push(...cards);
  if (discoveryBuffer.length > DISCOVERY_BUFFER_MAX) {
    discoveryBuffer.splice(0, discoveryBuffer.length - DISCOVERY_BUFFER_MAX);
  }
}

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

// ── GET /history — recent discoveries ───────────────────────────────────────

router.get("/history", (_req: Request, res: Response) => {
  const limit = Math.min(100, parseInt(String(_req.query.limit) || "50", 10));
  const recent = discoveryBuffer.slice(-limit).reverse();
  res.json({ discoveries: recent, total: discoveryBuffer.length });
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

// ── GET /heat-scores — per-ticker accumulated heat with decay ────────────────

router.get("/heat-scores", (_req: Request, res: Response) => {
  const limit = Math.min(100, parseInt(String(_req.query.limit) || "50", 10));
  const scores = getHeatScores(limit);
  res.json({ scores, total: scores.length });
});

export default router;
