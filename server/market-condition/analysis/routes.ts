/**
 * MarketFlow AI Analysis API Routes
 * GET /api/marketflow/:symbol/cache-meta — cache metadata for Use Cached vs Re-run prompt
 * GET /api/marketflow/:symbol/cached — full cached analysis payload
 * POST /api/marketflow/:symbol — run analysis (query ?force=true to bypass cache)
 */

import { Router, Request, Response } from "express";
import { getCacheMeta, getCached, setCached, invalidate } from "./cacheService";
import { runAnalysis } from "./orchestrator";

const router = Router();

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
    return res.json(payload);
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

    // Store to cache
    await setCached(symbol, {
      moduleResponses: result.moduleResponses,
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
