/**
 * MarketFlow AI Analysis API Routes
 * GET /api/marketflow/:symbol/cache-meta — cache metadata for Use Cached vs Re-run prompt
 * GET /api/marketflow/:symbol/cached — full cached analysis payload
 * POST /api/marketflow/:symbol — run analysis (query ?force=true to bypass cache)
 */

import { Router, Request, Response } from "express";
import { getCacheMeta, getCached, setCached, invalidate } from "./cacheService";
import { runAnalysis, stripLiveOnlyData, attachLiveOptions } from "./orchestrator";
import type { ModuleResponse } from "./types";
import {
  getOptionsPulseBatch,
  getOptionsRegime,
  getOptionsBudgetStats,
  MAX_BATCH_SYMBOLS,
} from "../options/provider";

const router = Router();

/**
 * GET /api/marketflow/options/pulse?symbols=AAPL,MSFT
 * Options Pulse for up to MAX_BATCH_SYMBOLS underlyings (memberTable options columns). Memory-cached only.
 */
router.get("/options/pulse", async (req: Request, res: Response) => {
  try {
    const symbols = String(req.query.symbols || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (symbols.length === 0) return res.status(400).json({ error: "symbols required" });
    if (symbols.length > MAX_BATCH_SYMBOLS) {
      return res.status(400).json({ error: `At most ${MAX_BATCH_SYMBOLS} symbols per request` });
    }
    const result = await getOptionsPulseBatch(symbols);
    return res.json(result);
  } catch (error) {
    console.error("[MarketFlow] options pulse error:", (error as Error).message);
    return res.status(500).json({ error: "Options pulse failed" });
  }
});

/** GET /api/marketflow/options/regime — SPY/QQQ/IWM P/C + ATM IV (≥5 min server cache). */
router.get("/options/regime", async (_req: Request, res: Response) => {
  try {
    return res.json(await getOptionsRegime());
  } catch (error) {
    console.error("[MarketFlow] options regime error:", (error as Error).message);
    return res.status(500).json({ error: "Options regime failed" });
  }
});

/** GET /api/marketflow/options/budget — call budget usage and cache sizes. */
router.get("/options/budget", (_req: Request, res: Response) => {
  return res.json(getOptionsBudgetStats());
});

/**
 * GET /api/marketflow/:symbol/cache-meta
 * Returns { exists, generated_at, version, modules_present } for cache prompt.
 */
router.get("/:symbol/cache-meta", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || "").toUpperCase();
    if (!symbol) {
      return res.status(400).json({ error: "Symbol required" });
    }
    const meta = await getCacheMeta(symbol);
    return res.json(meta);
  } catch (error) {
    console.error("[MarketFlow] cache-meta error:", error);
    return res.status(500).json({ error: "Failed to get cache metadata" });
  }
});

/**
 * GET /api/marketflow/:symbol/cached
 * Returns full cached analysis payload if within TTL.
 */
router.get("/:symbol/cached", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || "").toUpperCase();
    if (!symbol) {
      return res.status(400).json({ error: "Symbol required" });
    }
    const payload = await getCached(symbol);
    if (!payload) {
      return res.status(404).json({ error: "No cached analysis or expired" });
    }
    const moduleResponses = await attachLiveOptions(symbol, payload.moduleResponses as ModuleResponse[]);
    return res.json({ ...payload, moduleResponses });
  } catch (error) {
    console.error("[MarketFlow] cached error:", error);
    return res.status(500).json({ error: "Failed to get cached analysis" });
  }
});

/**
 * POST /api/marketflow/:symbol
 * Run full analysis with orchestrator and AI synthesis.
 * Query ?force=true to bypass cache check. Query ?skipSynthesis=true to skip AI.
 */
router.post("/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || "").toUpperCase();
    const skipSynthesis = req.query.skipSynthesis === "true";
    if (!symbol) {
      return res.status(400).json({ error: "Symbol required" });
    }

    console.log(`[MarketFlow] Running analysis for ${symbol}${skipSynthesis ? " (no AI)" : ""}`);

    const result = await runAnalysis(symbol, { skipSynthesis });

    // Store to cache (options data is memory-only and never persisted)
    await setCached(symbol, {
      moduleResponses: stripLiveOnlyData(result.moduleResponses),
      synthesis: result.synthesis,
    });

    return res.json(result);
  } catch (error) {
    console.error("[MarketFlow] POST analysis error:", error);
    const message = error instanceof Error ? error.message : "Analysis failed";
    return res.status(500).json({ error: "Analysis failed", detail: message });
  }
});

/**
 * DELETE /api/marketflow/:symbol/cache
 * Invalidate cached analysis (admin).
 */
router.delete("/:symbol/cache", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || "").toUpperCase();
    if (!symbol) return res.status(400).json({ error: "Symbol required" });
    await invalidate(symbol);
    return res.json({ success: true });
  } catch (error) {
    console.error("[MarketFlow] invalidate error:", error);
    return res.status(500).json({ error: "Failed to invalidate cache" });
  }
});

export default router;
