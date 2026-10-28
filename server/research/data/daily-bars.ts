import * as fs from "fs";
import * as path from "path";
import { fetchAlpacaMultiSymbolDailyBars } from "../../alpaca";
import { sessionDateKeyEt } from "@shared/chart-indicators";
import type { DailyBar } from "../types";
import { withQuietAlpaca } from "./alpaca-quiet";
import { cachePath, safeSymbolFile } from "./paths";

/**
 * Daily SIP bars (split-adjusted) from the app's Alpaca client, cached as one JSON file per symbol so reruns don't
 * refetch. A cache file covers [from, fetchedThrough]; later runs fetch only the missing tail.
 */

interface CacheFile {
  symbol: string;
  from: string;
  fetchedThrough: string;
  noData?: boolean;
  bars: [string, number, number, number, number, number][];
}

const BATCH = 100;

function dir() {
  return cachePath("daily");
}

function filePath(symbol: string) {
  return path.join(dir(), `${safeSymbolFile(symbol)}.json`);
}

function readCache(symbol: string): CacheFile | null {
  try {
    return JSON.parse(fs.readFileSync(filePath(symbol), "utf-8")) as CacheFile;
  } catch {
    return null;
  }
}

function writeCache(c: CacheFile) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(filePath(c.symbol), JSON.stringify(c));
}

export function todayEt(now = new Date()): string {
  return sessionDateKeyEt(now.toISOString());
}

/** The latest session whose daily bar is final: today only after 16:15 ET. */
export function lastCompletedSessionCutoff(now = new Date()): string {
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = Number(etParts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(etParts.find((p) => p.type === "minute")?.value ?? 0);
  const today = todayEt(now);
  if (h * 60 + m >= 16 * 60 + 15) return today;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface DailyLoadReport {
  requested: number;
  fromCache: number;
  fetched: number;
  noData: string[];
  failed: string[];
}

async function fetchBatch(symbols: string[], from: string, to: string): Promise<{ bars: Map<string, DailyBar[]>; ok: boolean }> {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(Math.min(Date.now() - 16 * 60_000, new Date(`${to}T23:59:00Z`).getTime()));
  for (let attempt = 0; attempt < 3; attempt++) {
    const { result, errors } = await withQuietAlpaca(() => fetchAlpacaMultiSymbolDailyBars(symbols, start, end));
    if (errors.length === 0) {
      const out = new Map<string, DailyBar[]>();
      for (const [sym, candles] of result) {
        const byDate = new Map<string, DailyBar>();
        for (const c of candles) {
          const date = sessionDateKeyEt(c.date);
          if (date < from || date > to) continue;
          byDate.set(date, { date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
        }
        out.set(sym, [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)));
      }
      return { bars: out, ok: true };
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return { bars: new Map(), ok: false };
}

/** Make sure every symbol has cached bars covering [from, to]. `to` must be a completed session. */
export async function ensureDailyBars(
  symbols: string[],
  from: string,
  to: string,
  onProgress?: (done: number, total: number) => void,
): Promise<DailyLoadReport> {
  const report: DailyLoadReport = { requested: symbols.length, fromCache: 0, fetched: 0, noData: [], failed: [] };
  const full: string[] = [];
  const tails = new Map<string, string[]>();
  for (const s of symbols) {
    const c = readCache(s);
    if (!c || c.from > from) full.push(s);
    else if (c.fetchedThrough >= to) {
      report.fromCache++;
      if (c.noData) report.noData.push(s);
    } else {
      const tailFrom = c.noData || c.bars.length === 0 ? c.from : c.bars[c.bars.length - 1][0];
      const list = tails.get(tailFrom) ?? [];
      list.push(s);
      tails.set(tailFrom, list);
    }
  }

  const jobs: { symbols: string[]; from: string; tail: boolean }[] = [];
  for (let i = 0; i < full.length; i += BATCH) jobs.push({ symbols: full.slice(i, i + BATCH), from, tail: false });
  for (const [tailFrom, list] of tails) {
    for (let i = 0; i < list.length; i += BATCH) jobs.push({ symbols: list.slice(i, i + BATCH), from: tailFrom, tail: true });
  }

  let done = report.fromCache;
  for (const job of jobs) {
    const { bars, ok } = await fetchBatch(job.symbols, job.from, to);
    for (const s of job.symbols) {
      if (!ok) {
        report.failed.push(s);
        continue;
      }
      const got = bars.get(s.toUpperCase()) ?? [];
      const prev = job.tail ? readCache(s) : null;
      const merged = new Map<string, CacheFile["bars"][number]>();
      for (const b of prev?.bars ?? []) merged.set(b[0], b);
      for (const b of got) merged.set(b.date, [b.date, b.open, b.high, b.low, b.close, b.volume]);
      const rows = [...merged.values()].sort((a, b) => a[0].localeCompare(b[0]));
      writeCache({ symbol: s, from: prev?.from ?? from, fetchedThrough: to, noData: rows.length === 0, bars: rows });
      if (rows.length === 0) report.noData.push(s);
      report.fetched++;
    }
    done += job.symbols.length;
    onProgress?.(done, symbols.length);
  }
  return report;
}

export function readDailyBars(symbol: string, from?: string, to?: string): DailyBar[] {
  const c = readCache(symbol);
  if (!c || c.noData) return [];
  const out: DailyBar[] = [];
  for (const [date, open, high, low, close, volume] of c.bars) {
    if (from && date < from) continue;
    if (to && date > to) continue;
    out.push({ date, open, high, low, close, volume });
  }
  return out;
}
