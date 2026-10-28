import * as fs from "fs";
import * as path from "path";
import { fetchAlpacaIntradayBars } from "../../alpaca";
import type { MinuteBar } from "../types";
import { withQuietAlpaca } from "./alpaca-quiet";
import { cachePath, safeSymbolFile } from "./paths";

/** Regular-session 1-minute SIP bars for one symbol and session, cached as a file per (symbol, date). */

function filePath(symbol: string, date: string) {
  return cachePath("minute", safeSymbolFile(symbol), `${date}.json`);
}

export function readMinuteBars(symbol: string, date: string): MinuteBar[] | null {
  try {
    return JSON.parse(fs.readFileSync(filePath(symbol, date), "utf-8")) as MinuteBar[];
  } catch {
    return null;
  }
}

export interface MinuteFetchStats {
  requested: number;
  fromCache: number;
  fetched: number;
  failed: number;
}

async function fetchOne(symbol: string, date: string): Promise<MinuteBar[] | null> {
  const start = new Date(`${date}T08:00:00Z`);
  const end = new Date(`${date}T23:59:00Z`);
  const { result, errors } = await withQuietAlpaca(() => fetchAlpacaIntradayBars(symbol, start, end, "1Min", false));
  if (errors.length > 0) return null;
  return result.map((b) => ({ t: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
}

/** Fetch (or read from cache) minute bars for each (symbol, date); returns a lookup keyed `SYM|date`. */
export async function loadMinuteBars(
  needs: { symbol: string; date: string }[],
  stats: MinuteFetchStats,
  concurrency = 6,
): Promise<Map<string, MinuteBar[]>> {
  const out = new Map<string, MinuteBar[]>();
  const queue = [...new Map(needs.map((n) => [`${n.symbol}|${n.date}`, n])).values()];
  stats.requested += queue.length;
  const worker = async () => {
    for (;;) {
      const n = queue.shift();
      if (!n) return;
      const key = `${n.symbol}|${n.date}`;
      const cached = readMinuteBars(n.symbol, n.date);
      if (cached) {
        stats.fromCache++;
        out.set(key, cached);
        continue;
      }
      const bars = await fetchOne(n.symbol, n.date);
      if (!bars) {
        stats.failed++;
        continue;
      }
      fs.mkdirSync(path.dirname(filePath(n.symbol, n.date)), { recursive: true });
      fs.writeFileSync(filePath(n.symbol, n.date), JSON.stringify(bars));
      stats.fetched++;
      out.set(key, bars);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
