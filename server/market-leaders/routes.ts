import type { Express, Request, Response } from "express";
import { getPool } from "../db";
import { loadEntryGauges } from "../entry-gauge";
import { marketDateOrNull } from "@shared/market-leaders/dates";
import {
  clampSpec,
  SPEC_FIELDS,
  V1_SPEC,
  type LeaderPool,
  type MarketLeadersSpec,
} from "@shared/market-leaders/spec";
import { clearBookCache, loadBook, scoreSymbolsNow, specHash } from "./engine";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS market_leader_books (
    cache_key text PRIMARY KEY,
    pool text NOT NULL,
    spec_hash text NOT NULL,
    market_date date NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS market_leader_prefs (
    user_id integer PRIMARY KEY,
    pool text NOT NULL DEFAULT 'sp500',
    spec jsonb NOT NULL,
    updated_at timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS market_leader_marks (
    user_id integer NOT NULL,
    symbol varchar(20) NOT NULL,
    points integer NOT NULL DEFAULT 0,
    pinned boolean NOT NULL DEFAULT false,
    updated_at timestamp DEFAULT now(),
    PRIMARY KEY (user_id, symbol)
  )`,
];

type Authed = Request & { session?: { userId?: number } };

function userId(req: Authed): number | null {
  const id = req.session?.userId;
  return typeof id === "number" ? id : null;
}

function poolName(value: unknown): LeaderPool {
  if (value === "universe" || value === "russell2000" || value === "sp500") return value;
  return "universe";
}

async function ensureTables(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  for (const statement of TABLES) await pool.query(statement);
}

async function readPrefs(id: number): Promise<{ pool: LeaderPool; spec: MarketLeadersSpec }> {
  const pool = getPool();
  if (!pool) return { pool: "universe", spec: V1_SPEC };
  const result = await pool.query(`SELECT pool, spec FROM market_leader_prefs WHERE user_id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return { pool: "universe", spec: V1_SPEC };
  return { pool: poolName(row.pool), spec: clampSpec(row.spec).spec };
}

async function readMarks(id: number): Promise<{ symbol: string; points: number; pinned: boolean }[]> {
  const pool = getPool();
  if (!pool) return [];
  const result = await pool.query(
    `SELECT symbol, points, pinned FROM market_leader_marks WHERE user_id = $1 AND (points <> 0 OR pinned = true)`,
    [id],
  );
  return result.rows.map((row) => ({
    symbol: String(row.symbol),
    points: Number(row.points),
    pinned: Boolean(row.pinned),
  }));
}

export async function registerMarketLeaderRoutes(app: Express): Promise<void> {
  await ensureTables().catch((error) => console.warn("[MarketLeaders] table ensure failed:", error));

  app.get("/api/market-leaders/prefs", async (req: Authed, res: Response) => {
    const id = userId(req);
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    res.json(await readPrefs(id));
  });

  app.put("/api/market-leaders/prefs", async (req: Authed, res: Response) => {
    const id = userId(req);
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    const db = getPool();
    if (!db) return res.status(503).json({ error: "Database is not connected" });
    const spec = clampSpec(req.body?.spec).spec;
    const pool = poolName(req.body?.pool);
    await db.query(
      `INSERT INTO market_leader_prefs (user_id, pool, spec)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET pool = EXCLUDED.pool, spec = EXCLUDED.spec, updated_at = now()`,
      [id, pool, JSON.stringify(spec)],
    );
    res.json({ pool, spec });
  });

  app.post("/api/market-leaders/marks", async (req: Authed, res: Response) => {
    const id = userId(req);
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    const db = getPool();
    if (!db) return res.status(503).json({ error: "Database is not connected" });
    const symbol = String(req.body?.symbol ?? "").trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: "Symbol is required" });
    const points = Math.max(-10, Math.min(10, Math.round(Number(req.body?.points) || 0)));
    const pinned = Boolean(req.body?.pinned);
    if (points === 0 && !pinned) {
      await db.query(`DELETE FROM market_leader_marks WHERE user_id = $1 AND symbol = $2`, [id, symbol]);
    } else {
      await db.query(
        `INSERT INTO market_leader_marks (user_id, symbol, points, pinned)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, symbol) DO UPDATE SET points = EXCLUDED.points, pinned = EXCLUDED.pinned, updated_at = now()`,
        [id, symbol, points, pinned],
      );
    }
    res.json({ symbol, points, pinned });
  });

  app.post("/api/market-leaders/book", async (req: Authed, res: Response) => {
    const id = userId(req);
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    try {
      const saved = await readPrefs(id);
      const spec = clampSpec(req.body?.spec ?? saved.spec, saved.spec).spec;
      const pool = poolName(req.body?.pool ?? saved.pool);
      const asOf = marketDateOrNull(req.body?.asOf);
      const through = marketDateOrNull(req.body?.through);
      const payload = await loadBook({ pool, spec, asOf, through });
      const marks = await readMarks(id);
      const extras = await scoreSymbolsNow(payload, marks.map((mark) => mark.symbol));
      let gauges = new Map<string, { vwapPct: number | null; vwapTone: string | null; ema620Pct: number | null; ema620Cross: string | null; ema620Tone: string | null }>();
      if (payload.live) {
        const symbols = payload.rows.slice(0, 60).map((row) => row.symbol);
        const loaded = await loadEntryGauges(symbols);
        gauges = loaded;
      }
      const withGauge = (row: (typeof payload.rows)[number]) => {
        const gauge = gauges.get(row.symbol);
        return gauge
          ? {
              ...row,
              vwapPct: gauge.vwapPct,
              vwapTone: gauge.vwapTone,
              ema620Pct: gauge.ema620Pct,
              ema620Cross: gauge.ema620Cross,
              ema620Tone: gauge.ema620Tone,
            }
          : row;
      };
      res.json({
        ...payload,
        rows: payload.rows.map(withGauge),
        left: payload.left,
        tracked: extras,
        marks,
        specHash: specHash(spec),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not build the book";
      console.warn("[MarketLeaders] book failed:", message);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/market-leaders/interpret", async (req: Authed, res: Response) => {
    const id = userId(req);
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    const prompt = String(req.body?.prompt ?? "").trim();
    if (!prompt) return res.status(400).json({ error: "Tell it what to change" });
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "AI is not configured. Use the controls." });
    const current = clampSpec(req.body?.spec).spec;
    const fieldList = SPEC_FIELDS.map((field) => `${field.key} (${field.min}–${field.max})`).join(", ");
    try {
      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You adjust a stock-leader ranking spec. Reply with JSON only: {\"spec\":{only keys to change},\"note\":\"two sentences on who joins or leaves\"}. " +
              `Allowed keys and ranges: ${fieldList}. Do not invent indicators. Current spec: ${JSON.stringify(current)}`,
          },
          { role: "user", content: prompt },
        ],
      });
      const text = completion.choices[0]?.message?.content ?? "{}";
      const json = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/, "").trim()) as { spec?: unknown; note?: string };
      const clamped = clampSpec(json.spec ?? {}, current);
      res.json({ spec: clamped.spec, note: String(json.note ?? "").slice(0, 400), rejected: clamped.rejected });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed";
      res.status(500).json({ error: message });
    }
  });

  setTimeout(() => {
    void loadBook({ pool: "universe", spec: V1_SPEC, asOf: null, through: null }).catch((error) => {
      console.warn("[MarketLeaders] nightly book skipped:", error instanceof Error ? error.message : error);
    });
  }, 15_000);
}

export function resetMarketLeaderCache(): void {
  clearBookCache();
}
