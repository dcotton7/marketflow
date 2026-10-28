import { atrxFrom50 } from "@shared/chart-indicators";
import { getDailyBars } from "../data-layer/daily-bars";
import { getQuote } from "../data-layer/quotes";
import type { DailyBar } from "../data-layer/types";

/** Daily bars oldest first, today's live bar included (what MiniChart's daily history shows). */
export async function dailyBarsOldestFirst(symbol: string, days = 260): Promise<DailyBar[] | null> {
  const bars = await getDailyBars(symbol, days);
  return bars ? [...bars].reverse() : null;
}

/** The chart's "ATRx from 50MA" for a symbol at its live price. */
export async function extensionAtrForSymbol(symbol: string): Promise<number | null> {
  const [bars, quote] = await Promise.all([dailyBarsOldestFirst(symbol), getQuote(symbol)]);
  if (!bars?.length) return null;
  const price = quote?.price && quote.price > 0 ? quote.price : bars[bars.length - 1].close;
  return atrxFrom50(price, bars);
}
