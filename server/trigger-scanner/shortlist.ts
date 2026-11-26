/**
 * The fallback tier (TRIGGER_SCANNER_TIER=shortlist, or automatically after two failed bar fetches in a day): quote-
 * only checks universe-wide on the snapshot MarketFlow already refreshes every 60-90 s (price, day high/low, volume,
 * VWAP; theme-universe names only), and 5-minute bars only for the names they promote, at most shortlistMax.
 *
 * A name is promoted when its price is within promoteAdr ADR of a daily level or of its VWAP, or it has moved at
 * least 1 ADR from its open, or its volume so far runs at 1.5x the time-of-day norm. Names with a daily setup on
 * watch always come first. Ranked by the nearest level in ADR. A promotion is not a candidate: a candidate still
 * needs a closed 5-minute bar and the same triggers.
 */
import { dailyLevels } from "./levels";
import { VOLUME_PROFILE } from "./session";
import type { DailyContext } from "./types";

export interface QuoteRow { price: number; open: number; high: number; low: number; volume: number; vwap: number }

export function promoteShortlist(
  quotes: Map<string, QuoteRow>,
  contexts: Map<string, DailyContext>,
  opts: { max: number; slot: number; watched: Set<string>; promoteAdr?: number },
): string[] {
  const promoteAdr = opts.promoteAdr ?? 0.5;
  const cum = VOLUME_PROFILE.slice(0, Math.max(1, opts.slot + 1)).reduce((a, b) => a + b, 0);
  const ranked: { sym: string; score: number }[] = [];
  for (const [sym, q] of quotes) {
    const ctx = contexts.get(sym);
    if (!ctx || !(ctx.adr > 0) || !(q.price > 0)) continue;
    let nearest = Infinity;
    for (const l of dailyLevels(ctx)) nearest = Math.min(nearest, Math.abs(q.price - l.price) / ctx.adr);
    if (q.vwap > 0) nearest = Math.min(nearest, Math.abs(q.price - q.vwap) / ctx.adr);
    const moved = Math.abs(q.price - q.open) / ctx.adr >= 1;
    const pace = ctx.avgVol20 > 0 ? q.volume / (ctx.avgVol20 * cum) : 0;
    if (opts.watched.has(sym)) ranked.push({ sym, score: -1 });
    else if (nearest <= promoteAdr || moved || pace >= 1.5) ranked.push({ sym, score: nearest });
  }
  return ranked.sort((a, b) => a.score - b.score || (a.sym < b.sym ? -1 : 1)).slice(0, opts.max).map((r) => r.sym);
}
