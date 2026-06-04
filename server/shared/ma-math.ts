/**
 * Shared moving-average math used by Alerts and Big Idea Scanner.
 */

export function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((acc, value) => acc + value, 0);
  return sum / period;
}

export function calculateEMA(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(values.slice(0, period), period);
  if (ema == null) return null;
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }
  return ema;
}

export function calculateEMAAtOffset(values: number[], period: number, offsetFromEnd: number): number | null {
  if (offsetFromEnd < 0 || values.length - offsetFromEnd <= 0) return null;
  return calculateEMA(values.slice(0, values.length - offsetFromEnd), period);
}

export function calculateSMAAtOffset(values: number[], period: number, offsetFromEnd: number): number | null {
  if (offsetFromEnd < 0 || values.length - offsetFromEnd <= 0) return null;
  return calculateSMA(values.slice(0, values.length - offsetFromEnd), period);
}

export function calculateMaAtOffset(
  values: number[],
  period: number,
  offsetFromEnd: number,
  maType: "sma" | "ema"
): number | null {
  return maType === "ema"
    ? calculateEMAAtOffset(values, period, offsetFromEnd)
    : calculateSMAAtOffset(values, period, offsetFromEnd);
}

export function intradayIntervalToBarMinutes(timeframe: string | undefined): number {
  const value = (timeframe ?? "5min").toLowerCase();
  if (value === "5m" || value === "5min") return 5;
  if (value === "15m" || value === "15min") return 15;
  if (value === "30m" || value === "30min") return 30;
  if (value === "60m" || value === "60min" || value === "1h") return 60;
  return 5;
}

export function lookbackMinutesToBars(lookbackMinutes: number, barMinutes: number): number {
  return Math.max(1, Math.ceil(lookbackMinutes / barMinutes));
}
