/**
 * The signed-in user's stored BigIdea scans (docs/gateway-reads.md, item 4), read only. Nothing here runs a scan.
 *
 * POST /api/bigidea/scan (server/bigidea/routes.ts) computes on demand and, at the end, writes one scan_sessions row
 * per scan: user_id, idea_id, scan_config ({ nodes, edges, universe }), result_count, result_symbols (the matched
 * tickers, in result order), funnel_data (totalTickers, fetchFails, tooFewCandles, perThought and perIndicator counts),
 * created_at. Nothing in the app deletes or prunes those rows. Not stored: each match's price, name and passed paths.
 * The BigIdea page sends the saved idea's id (none for an unsaved canvas) and the route keeps it only when the idea is
 * the caller's own; Validation Mode scans an extracted idea, not a saved one, so its rows have no idea_id. Rows saved
 * before 26 Nov have none either. The thoughts' names are in funnel_data.perThought.
 *
 *   GET /api/bigidea/scan-results[?ideaId=N][&limit=N (1-50, default 20)][&symbols=N (per scan, 1-500, default 200)]
 *       the user's newest scans first, with the idea's name, the universe, the time, the counts and the matches.
 */
import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

export const MAX_SCANS = 50;
export const MAX_SYMBOLS = 500;

export interface ScanRow {
  id: number; ideaId: number | null; ideaName: string | null; universe: string | null; createdAt: string | null;
  resultCount: number; symbols: string[]; symbolsTruncated: boolean;
  funnel: { totalTickers: number | null; fetchFails: number | null; tooFewCandles: number | null; perThought: { name: string; passed: number; failed: number; evaluated: number; skipped: number }[] } | null;
}
export interface ScanSource { recent(userId: number, opts: { ideaId: number | null; limit: number }): Promise<any[]> }

const int = (x: unknown) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : Math.trunc(Number(x)));
const clamp = (raw: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= lo ? Math.min(n, hi) : dflt;
};

/** One stored row to what leaves: counts and names only (no criteria, no per-ticker failure lists). */
export function toScanRow(r: any, maxSymbols: number): ScanRow {
  const syms: string[] = Array.isArray(r.result_symbols) ? r.result_symbols.map(String) : [];
  const f = r.funnel && typeof r.funnel === "object" ? r.funnel : null;
  const perThought = f?.perThought && typeof f.perThought === "object"
    ? Object.values(f.perThought as Record<string, any>).map((t) => ({ name: String(t?.name ?? "Unnamed"), passed: int(t?.passed) ?? 0, failed: int(t?.failed) ?? 0, evaluated: int(t?.evaluated) ?? 0, skipped: int(t?.skipped) ?? 0 }))
    : [];
  return {
    id: Number(r.id), ideaId: int(r.idea_id), ideaName: r.idea_name ?? null, universe: r.universe ?? null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    resultCount: int(r.result_count) ?? syms.length, symbols: syms.slice(0, maxSymbols), symbolsTruncated: syms.length > maxSymbols,
    funnel: f ? { totalTickers: int(f.totalTickers), fetchFails: int(f.fetchFails), tooFewCandles: int(f.tooFewCandles), perThought } : null,
  };
}

type Exec = { execute: (q: any) => Promise<any> };
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
export function pgScanSource(db: Exec): ScanSource {
  return {
    async recent(userId, { ideaId, limit }) {
      // the idea's name only from the same user's idea; funnel without perIndicator (diagnostic samples) and without
      // perThought's failedTickers lists
      return rowsOf(await db.execute(sql`
        SELECT s.id, s.idea_id, i.name AS idea_name, s.scan_config->>'universe' AS universe, s.created_at, s.result_count, s.result_symbols,
          CASE WHEN s.funnel_data IS NULL THEN NULL ELSE jsonb_build_object(
            'totalTickers', s.funnel_data->'totalTickers', 'fetchFails', s.funnel_data->'fetchFails', 'tooFewCandles', s.funnel_data->'tooFewCandles',
            'perThought', s.funnel_data->'perThought') END AS funnel
        FROM scan_sessions s LEFT JOIN scanner_ideas i ON i.id = s.idea_id AND i.user_id = s.user_id
        WHERE s.user_id = ${userId} ${ideaId !== null ? sql`AND s.idea_id = ${ideaId}` : sql``}
        ORDER BY s.created_at DESC NULLS LAST, s.id DESC LIMIT ${limit}`));
    },
  };
}

export function scanResultsRoutes(deps: { source?: () => ScanSource | null } = {}): Router {
  const router = Router();
  const source = deps.source ?? (() => { const db = getDb(); return db ? pgScanSource(db) : null; });
  router.get("/scan-results", async (req: Request, res: Response) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Login required" });
    const src = source();
    if (!src) return res.status(503).json({ error: "database unavailable" });
    const ideaId = req.query.ideaId === undefined ? null : int(req.query.ideaId);
    if (req.query.ideaId !== undefined && (ideaId === null || ideaId < 1)) return res.status(400).json({ error: "ideaId must be a positive whole number" });
    const limit = clamp(req.query.limit, 1, MAX_SCANS, 20);
    const maxSymbols = clamp(req.query.symbols, 1, MAX_SYMBOLS, 200);
    try {
      const rows = (await src.recent(Number(userId), { ideaId, limit })).map((r) => toScanRow(r, maxSymbols));
      res.json({
        scans: rows,
        notes: [
          "One row per run of a BigIdea scan (POST /api/bigidea/scan), newest first; symbols are the matched tickers in result order.",
          "Stored per scan: idea, universe, time, result count, matched symbols, per-thought pass/fail counts. Not stored: each match's price and which paths it passed.",
          "ideaId / ideaName are the saved idea the scan was run from; null for an unsaved canvas, a Validation Mode scan, or a scan saved before 26 Nov 2026. The thoughts' names are in funnel.perThought.",
          "A scan of a watchlist is sent as a ticker list: its universe is null and the list itself is not stored.",
        ],
      });
    } catch (err) {
      console.warn("[GatewayReads] scan results read failed:", String(err).slice(0, 200));
      res.status(500).json({ error: "scan results read failed" });
    }
  });
  return router;
}
