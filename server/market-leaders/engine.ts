/**
 * Loads daily bars and theme ranks, runs the v1 book, and caches the result.
 * Reads existing bars and snapshots. Writes only the leaders cache and user marks.
 */

import { createHash } from "crypto";
import { getPool } from "../db";
import { getUniverseTickers } from "../bigidea/universes";
import { getLeadersUniverseTickers } from "./universe";
import { getClusterById, getTickerStaticCluster } from "../market-condition/universe";
import {
  MARKET_LEADERS_SPEC_VERSION,
  V1_SPEC,
  type LeaderPool,
  type MarketLeadersSpec,
} from "@shared/market-leaders/spec";
import {
  finalizeDay,
  scoreSymbol,
  walkBook,
  type LeaderBar,
  type LeaderRow,
  type SpanRow,
  type WalkResult,
} from "@shared/market-leaders/rank";

export interface LeadersPayload {
  pool: LeaderPool;
  spec: MarketLeadersSpec;
  specVersion: typeof MARKET_LEADERS_SPEC_VERSION;
  asOf: string;
  from: string | null;
  mode: "close" | "span";
  live: boolean;
  rows: LeaderRow[];
  left: LeaderRow[];
  span: SpanRow[] | null;
  counts: WalkResult["counts"];
}

const memory = new Map<string, LeadersPayload>();

export function specHash(spec: MarketLeadersSpec): string {
  const body = (Object.keys(V1_SPEC) as (keyof MarketLeadersSpec)[]).map((key) => spec[key]).join("|");
  return createHash("sha1").update(body).digest("hex").slice(0, 16);
}

function cacheKey(pool: LeaderPool, spec: MarketLeadersSpec, asOf: string, through: string | null): string {
  return `${pool}|${specHash(spec)}|${asOf}|${through ?? ""}`;
}

async function queryRows(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database is not connected");
  const result = await pool.query(sql, params);
  return result.rows as Record<string, unknown>[];
}

export async function latestBarDate(): Promise<string | null> {
  const rows = await queryRows(
    `SELECT MAX(bar_date)::text AS date FROM historical_bars WHERE symbol = 'SPY'`,
    [],
  );
  const date = rows[0]?.date;
  return typeof date === "string" ? date.slice(0, 10) : null;
}

async function loadBars(symbols: string[], asOf: string): Promise<Map<string, LeaderBar[]>> {
  const out = new Map<string, LeaderBar[]>();
  const cutoff = new Date(`${asOf}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 640);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (let i = 0; i < symbols.length; i += 40) {
    const slice = symbols.slice(i, i + 40);
    const rows = await queryRows(
      `SELECT symbol,
              bar_date::text AS date,
              open::float8 AS open,
              high::float8 AS high,
              low::float8 AS low,
              close::float8 AS close,
              volume::float8 AS volume
       FROM historical_bars
       WHERE symbol = ANY($1::text[])
         AND bar_date <= $2
         AND bar_date >= $3
       ORDER BY symbol, bar_date ASC`,
      [slice, asOf, cutoffStr],
    );
    for (const row of rows) {
      const symbol = String(row.symbol);
      const list = out.get(symbol) ?? [];
      list.push({
        date: String(row.date).slice(0, 10),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
      });
      out.set(symbol, list);
    }
  }
  return out;
}

async function loadThemeSnaps(asOf: string): Promise<{ date: string; ranks: Map<string, number> }[]> {
  const cutoff = new Date(`${asOf}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 500);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const rows = await queryRows(
    `SELECT market_date::text AS date, theme_id, rank
     FROM theme_snapshots
     WHERE snapshot_type = 'daily_close'
       AND market_date <= $1
       AND market_date >= $2
     ORDER BY market_date ASC`,
    [asOf, cutoffStr],
  );
  const byDate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const date = String(row.date).slice(0, 10);
    const ranks = byDate.get(date) ?? new Map<string, number>();
    ranks.set(String(row.theme_id), Number(row.rank));
    byDate.set(date, ranks);
  }
  return [...byDate.entries()].map(([date, ranks]) => ({ date, ranks }));
}

function themeOnDate(
  snaps: { date: string; ranks: Map<string, number> }[],
  date: string,
  symbol: string,
): { percentile: number | null; name: string | null } {
  const cluster = getTickerStaticCluster(symbol);
  const name = cluster ? getClusterById(cluster)?.name ?? cluster : null;
  let snap: { date: string; ranks: Map<string, number> } | null = null;
  for (const item of snaps) {
    if (item.date <= date) snap = item;
    else break;
  }
  if (!cluster || !snap) return { percentile: null, name };
  const rank = snap.ranks.get(cluster);
  if (rank == null || snap.ranks.size === 0) return { percentile: null, name };
  return { percentile: rank / snap.ranks.size, name };
}

function walkDates(spy: LeaderBar[], spec: MarketLeadersSpec, asOf: string, from: string | null): string[] {
  const dates = spy.map((bar) => bar.date).filter((date) => date <= asOf);
  const usable = dates.filter((_, index) => index >= spec.lookback);
  if (usable.length === 0) return [];
  if (!from || from >= asOf) {
    return usable.slice(-80);
  }
  const fromIdx = usable.findIndex((date) => date >= from);
  const start = Math.max(0, (fromIdx === -1 ? usable.length : fromIdx) - 40);
  return usable.slice(start).filter((date) => date <= asOf);
}

async function readStored(key: string): Promise<LeadersPayload | null> {
  const rows = await queryRows(`SELECT payload FROM market_leader_books WHERE cache_key = $1`, [key]);
  const payload = rows[0]?.payload;
  if (!payload || typeof payload !== "object") return null;
  return payload as LeadersPayload;
}

async function writeStored(key: string, payload: LeadersPayload): Promise<void> {
  await queryRows(
    `INSERT INTO market_leader_books (cache_key, pool, spec_hash, market_date, payload)
     VALUES ($1, $2, $3, $4::date, $5::jsonb)
     ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()`,
    [key, payload.pool, specHash(payload.spec), payload.asOf, JSON.stringify(payload)],
  );
}

const inflight = new Map<string, Promise<LeadersPayload>>();

export async function loadBook(options: {
  pool: LeaderPool;
  spec: MarketLeadersSpec;
  asOf: string | null;
  through: string | null;
}): Promise<LeadersPayload> {
  const latest = await latestBarDate();
  if (!latest) throw new Error("No SPY daily bars are stored yet");
  const requested = options.asOf && options.asOf < latest ? options.asOf : latest;
  const through = options.through && options.through > requested ? (options.through < latest ? options.through : latest) : null;
  const asOf = through ?? requested;
  const from = through ? requested : null;
  const key = cacheKey(options.pool, options.spec, asOf, from);
  const hit = memory.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = (async () => {
    const stored = await readStored(key).catch(() => null);
    if (stored) {
      memory.set(key, stored);
      return stored;
    }
    const built = await computeBook(options.pool, options.spec, asOf, from, latest);
    memory.set(key, built);
    await writeStored(key, built).catch((error) => {
      console.warn("[MarketLeaders] cache write failed:", error);
    });
    return built;
  })();
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

async function computeBook(
  poolName: LeaderPool,
  spec: MarketLeadersSpec,
  asOf: string,
  from: string | null,
  latest: string,
): Promise<LeadersPayload> {
  const universe = (poolName === "universe" ? getLeadersUniverseTickers() : getUniverseTickers(poolName)).map((symbol) =>
    symbol.toUpperCase(),
  );
  if (universe.length === 0) throw new Error(`No constituents for ${poolName}`);
  const symbols = [...new Set([...universe, "SPY"])];
  const bars = await loadBars(symbols, asOf);
  const spy = bars.get("SPY") ?? [];
  const snaps = await loadThemeSnaps(asOf);
  const dates = walkDates(spy, spec, asOf, from);
  if (dates.length === 0) throw new Error("Not enough SPY history to rank this date");
  const spyClose = new Map(spy.map((bar) => [bar.date, bar.close]));
  const index = new Map<string, Map<string, number>>();
  for (const [symbol, list] of bars) {
    index.set(symbol, new Map(list.map((bar, i) => [bar.date, i])));
  }
  const poolSet = new Set(universe);
  const days = dates.map((date) => {
    const raw = [];
    for (const symbol of universe) {
      const end = index.get(symbol)?.get(date);
      const list = bars.get(symbol);
      if (end == null || !list) continue;
      const theme = themeOnDate(snaps, date, symbol);
      const scored = scoreSymbol(symbol, list, end, spyClose, theme.percentile, theme.name, spec);
      if (scored) raw.push(scored);
    }
    return { date, scores: finalizeDay(raw, poolSet, spec) };
  });
  const reportTo = dates[dates.length - 1];
  const walked = walkBook(days, spec, from, reportTo);
  const spanMode = from != null && from < reportTo;
  return {
    pool: poolName,
    spec,
    specVersion: MARKET_LEADERS_SPEC_VERSION,
    asOf: reportTo,
    from: spanMode ? from : null,
    mode: spanMode ? "span" : "close",
    live: reportTo === latest && !spanMode,
    rows: walked.rows,
    left: walked.left,
    span: spanMode ? walked.span : null,
    counts: walked.counts,
  };
}

export async function scoreSymbolsNow(
  payload: LeadersPayload,
  symbols: string[],
): Promise<LeaderRow[]> {
  const missing = symbols
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol) => !payload.rows.some((row) => row.symbol === symbol) && !payload.left.some((row) => row.symbol === symbol));
  if (missing.length === 0) return [];
  const bars = await loadBars([...missing, "SPY"], payload.asOf);
  const spy = bars.get("SPY") ?? [];
  const spyClose = new Map(spy.map((bar) => [bar.date, bar.close]));
  const snaps = await loadThemeSnaps(payload.asOf);
  const poolSet = new Set(
    (payload.pool === "universe" ? getLeadersUniverseTickers() : getUniverseTickers(payload.pool)).map((symbol) =>
      symbol.toUpperCase(),
    ),
  );
  const raw = [];
  for (const symbol of missing) {
    const list = bars.get(symbol);
    if (!list || list.length === 0) continue;
    const end = list.length - 1;
    const theme = themeOnDate(snaps, list[end].date, symbol);
    const scored = scoreSymbol(symbol, list, end, spyClose, theme.percentile, theme.name, payload.spec);
    if (scored) raw.push(scored);
  }
  return finalizeDay(raw, poolSet, payload.spec).map((score) => ({
    symbol: score.symbol,
    score: score.score,
    status: "left" as const,
    leaveReason: "Not on the book",
    joinedOn: null,
    leftOn: null,
    daysOnBook: 0,
    gates: score.gates,
    points: score.points,
    themeName: score.themeName,
    close: score.close,
  }));
}

export function clearBookCache(): void {
  memory.clear();
}
