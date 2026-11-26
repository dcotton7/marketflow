/**
 * 5-minute bars for many symbols at once, and the day's bar book in memory.
 *
 * Alpaca's multi-symbol endpoint GET /v2/stocks/bars?symbols=A,B,...&timeframe=5Min (the same endpoint and keys
 * server/alpaca.ts already uses for daily bars) returns every symbol's bars in one answer, paged at `limit` bars in
 * total. Each pass asks only for the bars since the last fetch, so a pass is ceil(N / batch) requests: 1,750 names
 * in batches of 200 = 9 requests every 5 minutes, about 700 a day. A restart mid-day fetches the day so far once
 * (1,750 x up to 78 bars = 137k bars, 10,000 a page: about 18 requests). Bars are kept only for the current day.
 */
import type { Bar } from "./types";
import { BAR_MS } from "./session";

const ALPACA_DATA_URL = "https://data.alpaca.markets";

export interface FetchResult {
  bars: Map<string, Bar[]>;
  requests: number;
}
export type BarsFetcher = (symbols: string[], start: Date, end: Date) => Promise<FetchResult>;

export function alpacaBarsFetcher(opts: { feed: "sip" | "iex"; batch: number; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv }): BarsFetcher {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { "APCA-API-KEY-ID": env.ALPACA_API_KEY || "", "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET || "" };
  return async (symbols, start, end) => {
    const bars = new Map<string, Bar[]>();
    let requests = 0;
    for (let i = 0; i < symbols.length; i += opts.batch) {
      const chunk = symbols.slice(i, i + opts.batch);
      const params = new URLSearchParams({
        symbols: chunk.join(","), timeframe: "5Min", start: start.toISOString(), end: end.toISOString(),
        feed: opts.feed, limit: "10000", adjustment: "raw", sort: "asc",
      });
      for (let page = 0; page < 30; page++) {
        requests++;
        let resp = await doFetch(`${ALPACA_DATA_URL}/v2/stocks/bars?${params}`, { headers });
        if (resp.status === 429) {
          await new Promise((r) => setTimeout(r, 1500));
          requests++;
          resp = await doFetch(`${ALPACA_DATA_URL}/v2/stocks/bars?${params}`, { headers });
        }
        if (!resp.ok) throw new Error(`Alpaca bars ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        const data: any = await resp.json();
        for (const [sym, list] of Object.entries((data?.bars ?? {}) as Record<string, any[]>)) {
          if (!Array.isArray(list)) continue;
          const arr = bars.get(sym.toUpperCase()) ?? [];
          for (const b of list) if (b && b.t && b.c > 0) arr.push({ t: new Date(b.t).toISOString(), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 });
          bars.set(sym.toUpperCase(), arr);
        }
        const next = data?.next_page_token;
        if (!next) break;
        params.set("page_token", next);
      }
    }
    return { bars, requests };
  };
}

/** Today's bars per symbol, merged by start time; only complete bars (closed by `throughMs`) are kept. */
export class BarBook {
  readonly bySymbol = new Map<string, Bar[]>();
  /** Bars are complete up to this instant (the end of the last successful fetch). */
  fetchedThroughMs: number | null = null;
  constructor(readonly date: string) {}

  add(fetched: Map<string, Bar[]>, throughMs: number): number {
    let n = 0;
    for (const [sym, list] of fetched) {
      const cur = this.bySymbol.get(sym) ?? [];
      const byT = new Map(cur.map((b) => [b.t, b]));
      for (const b of list) {
        if (Date.parse(b.t) + BAR_MS > throughMs) continue; // not closed yet
        if (!byT.has(b.t)) n++;
        byT.set(b.t, b);
      }
      this.bySymbol.set(sym, [...byT.values()].sort((a, b) => a.t.localeCompare(b.t)));
    }
    this.fetchedThroughMs = Math.max(this.fetchedThroughMs ?? 0, throughMs);
    return n;
  }

  newestClose(): string | null {
    let best: string | null = null;
    for (const list of this.bySymbol.values()) {
      const last = list[list.length - 1];
      if (last && (!best || last.t > best)) best = last.t;
    }
    return best ? new Date(Date.parse(best) + BAR_MS).toISOString() : null;
  }

  barCount(): number {
    let n = 0;
    for (const l of this.bySymbol.values()) n += l.length;
    return n;
  }
}
