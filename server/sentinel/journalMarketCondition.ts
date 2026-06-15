import { getDailyBars } from "../data-layer/daily-bars";

function calculateEma(closesOldestFirst: number[], period: number): number {
  if (closesOldestFirst.length < period) return closesOldestFirst[closesOldestFirst.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = closesOldestFirst.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closesOldestFirst.length; i++) {
    ema = closesOldestFirst[i]! * k + ema * (1 - k);
  }
  return ema;
}

function mmTrendLabel(price: number, ema21: number, slope: "rising" | "falling" | "flat"): string {
  if (price > ema21 && slope === "rising") return "Tailwind";
  if (price > ema21 && slope === "flat") return "Falling Tailwind";
  if (price < ema21 && slope === "falling") return "Headwind";
  return "Slack";
}

function dailyBasketLabel(price: number, sma21: number): string {
  if (price > sma21 * 1.002) return "RISK-ON";
  if (price < sma21 * 0.998) return "RISK-OFF";
  return "MIXED";
}

/** SPY-based regime label for a historical session date (YYYY-MM-DD). */
export async function buildMarketConditionLabelsForDates(
  dates: string[]
): Promise<Record<string, string>> {
  const unique = [...new Set(dates.filter(Boolean))].sort();
  if (unique.length === 0) return {};

  const bars = await getDailyBars("SPY", 400);
  if (!bars?.length) return {};

  const asc = [...bars].sort((a, b) => a.date.localeCompare(b.date));

  const out: Record<string, string> = {};
  for (const ymd of unique) {
    const idx = asc.findIndex((b) => b.date === ymd);
    if (idx < 21) continue;
    const window = asc.slice(0, idx + 1);
    const closes = window.map((b) => b.close);
    const price = closes[closes.length - 1]!;
    const ema21 = calculateEma(closes, 21);
    const ema21Prior =
      idx >= 26 ? calculateEma(asc.slice(0, idx - 4).map((b) => b.close), 21) : ema21;
    const slope =
      ema21Prior > 0 && (ema21 - ema21Prior) / ema21Prior > 0.003
        ? "rising"
        : ema21Prior > 0 && (ema21 - ema21Prior) / ema21Prior < -0.003
          ? "falling"
          : "flat";
    const sma21 = closes.slice(-21).reduce((a, b) => a + b, 0) / 21;
    const mm = mmTrendLabel(price, ema21, slope);
    const daily = dailyBasketLabel(price, sma21);
    out[ymd] = `${mm} · ${daily}`;
  }

  // Fallback: if exact date missing (holiday), walk back to nearest prior bar
  for (const ymd of unique) {
    if (out[ymd]) continue;
    const prior = asc.filter((b) => b.date < ymd).pop();
    if (prior && out[prior.date]) out[ymd] = out[prior.date]!;
  }

  return out;
}
