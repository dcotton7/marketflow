import type { Quote } from "../data-layer/types";
import { freshTick, type SchwabTick } from "./quote-cache";

/**
 * The alert engine's price: a Schwab stream tick under 15 s old when Schwab is streaming, otherwise the current
 * source (getQuote: snapshot cache, then Alpaca). Ticks exist only while the stream runs, so a dropped or signed-out
 * stream falls back by itself within 15 s.
 */
export type QuoteSource = (symbol: string) => Promise<Quote | null>;

const defaultFallback: QuoteSource = async (symbol) => (await import("../data-layer/quotes")).getQuote(symbol);

export function tickToQuote(t: SchwabTick): Quote & { source: "schwab" } {
  const prevClose = t.prevClose ?? (t.netChange !== null ? t.last - t.netChange : t.last);
  const change = t.last - prevClose;
  return {
    symbol: t.symbol, price: t.last, prevClose, open: t.open ?? t.last, high: t.high ?? t.last, low: t.low ?? t.last,
    change, changePct: prevClose > 0 ? (change / prevClose) * 100 : 0, volume: t.volume ?? 0, vwap: t.last,
    timestamp: new Date(t.tradeTime ?? t.receivedAt), source: "schwab",
  };
}

export async function getAlertQuote(symbol: string, fallback: QuoteSource = defaultFallback, now = Date.now()): Promise<Quote | null> {
  const tick = freshTick(symbol, now);
  return tick ? tickToQuote(tick) : fallback(symbol);
}

/** The position worker tells the stream which symbols it watches each cycle (set by the Schwab service). */
let watchHook: ((owner: string, symbols: string[]) => void) | null = null;
export function setAlertWatchHook(fn: ((owner: string, symbols: string[]) => void) | null): void {
  watchHook = fn;
}
export function watchAlertSymbols(owner: string, symbols: string[]): void {
  watchHook?.(owner, symbols);
}
