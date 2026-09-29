/**
 * Session VWAP + 5-minute 6/20 readings for a symbol list.
 * VWAP and ADR come from the market-condition snapshot already in memory.
 * 5-minute closes are fetched from Alpaca and cached for one bar.
 */

import {
  adrPctFromDollars,
  emptyEntryGauge,
  readEma620Gauge,
  readVwapGauge,
  type EntryGauge,
} from "@shared/entry-gauge";
import { getMaDataForScanner, getRawSnapshotsForScanner } from "./market-condition/engine/snapshot";

const ALPACA_DATA_URL = "https://data.alpaca.markets";
const CACHE_TTL_MS = 90_000;
const FETCH_DAYS = 5;
const CHUNK = 20;

interface CachedCloses {
  closes: number[];
  at: number;
}

const closesCache = new Map<string, CachedCloses>();
let pending: Promise<void> | null = null;

function alpacaHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY || "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET || "",
  };
}

function isRegularSessionBar(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function snapshotFor(symbol: string): { price: number; vwap: number } | null {
  const snaps = getRawSnapshotsForScanner();
  const snap = snaps.get(symbol) ?? snaps.get(symbol.toUpperCase());
  if (!snap || typeof snap.price !== "number" || typeof snap.vwap !== "number") return null;
  return { price: snap.price, vwap: snap.vwap };
}

function adrDollarsFor(symbol: string): number | null {
  const mas = getMaDataForScanner();
  const row = mas.get(symbol) ?? mas.get(symbol.toUpperCase());
  const adr = row?.adr20;
  return adr != null && Number.isFinite(adr) ? adr : null;
}

async function fetchCloses(symbols: string[]): Promise<void> {
  if (symbols.length === 0) return;
  if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) return;

  const end = new Date();
  const start = new Date(end.getTime() - FETCH_DAYS * 24 * 60 * 60 * 1000);
  const now = Date.now();

  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    const gathered = new Map<string, { t: number; c: number }[]>();
    let pageToken: string | null = null;

    for (let page = 0; page < 6; page++) {
      const params = new URLSearchParams({
        symbols: chunk.join(","),
        timeframe: "5Min",
        start: start.toISOString(),
        end: end.toISOString(),
        feed: "sip",
        sort: "asc",
        adjustment: "split",
        limit: "10000",
      });
      if (pageToken) params.set("page_token", pageToken);
      const resp = await fetch(`${ALPACA_DATA_URL}/v2/stocks/bars?${params}`, {
        headers: alpacaHeaders(),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Alpaca 5m bars ${resp.status}: ${text.slice(0, 180)}`);
      }
      const data = (await resp.json()) as {
        bars?: Record<string, Array<{ t: string; c: number }>>;
        next_page_token?: string | null;
      };
      for (const [sym, bars] of Object.entries(data.bars ?? {})) {
        const list = gathered.get(sym.toUpperCase()) ?? [];
        for (const bar of bars) {
          if (!isRegularSessionBar(bar.t) || !Number.isFinite(bar.c)) continue;
          list.push({ t: new Date(bar.t).getTime(), c: bar.c });
        }
        gathered.set(sym.toUpperCase(), list);
      }
      pageToken = data.next_page_token ?? null;
      if (!pageToken) break;
    }

    for (const sym of chunk) {
      const rows = gathered.get(sym) ?? [];
      rows.sort((a, b) => a.t - b.t);
      const closes = rows.slice(-120).map((row) => row.c);
      closesCache.set(sym, { closes, at: now });
    }
  }
}

async function ensureCloses(symbols: string[]): Promise<void> {
  const stale = () =>
    symbols.filter((sym) => {
      const hit = closesCache.get(sym);
      return !hit || Date.now() - hit.at > CACHE_TTL_MS;
    });

  while (stale().length > 0) {
    if (pending) {
      await pending;
      continue;
    }
    const missing = stale();
    const job = fetchCloses(missing).finally(() => {
      if (pending === job) pending = null;
    });
    pending = job;
    await job;
    return;
  }
}

export async function loadEntryGauges(
  symbols: string[],
  quoteOverride?: Map<string, { price: number; vwap: number }>
): Promise<Map<string, EntryGauge>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  const out = new Map<string, EntryGauge>();
  if (unique.length === 0) return out;

  try {
    await ensureCloses(unique);
  } catch (err) {
    console.warn("[EntryGauge] 5-minute bars unavailable:", err);
  }

  for (const sym of unique) {
    const quote = quoteOverride?.get(sym);
    const snap = snapshotFor(sym);
    const price = quote?.price || snap?.price || 0;
    const vwap = quote?.vwap || snap?.vwap || 0;
    const adrPct = adrPctFromDollars(price, adrDollarsFor(sym));
    const vwapGauge = readVwapGauge(price, vwap, adrPct);
    const ema = readEma620Gauge(closesCache.get(sym)?.closes ?? [], adrPct);
    out.set(sym, {
      vwapPct: vwapGauge.pct,
      vwapTone: vwapGauge.tone,
      ema620Pct: ema.pct,
      ema620Cross: ema.cross,
      ema620Tone: ema.tone,
    });
  }
  return out;
}

export function gaugeOrEmpty(map: Map<string, EntryGauge>, symbol: string): EntryGauge {
  return map.get(symbol.toUpperCase()) ?? emptyEntryGauge();
}
