import type { DailyBarLike } from "../ticker-review-types";
import type { SetupBar } from "./types";

export function normalizeSetupBars(raw: unknown[]): SetupBar[] {
  return raw
    .map((b: any) => ({
      open: Number(b.open ?? b.o),
      high: Number(b.high ?? b.h),
      low: Number(b.low ?? b.l),
      close: Number(b.close ?? b.c),
      volume: Number(b.volume ?? b.v ?? 0),
      timestamp: b.timestamp ?? b.t ?? b.date,
    }))
    .filter((b) => b.close > 0 && b.high >= b.low);
}

export function sortBarsChronological(bars: SetupBar[]): SetupBar[] {
  if (bars.length < 2) return bars;
  const withTs = bars.every((b) => b.timestamp != null);
  if (!withTs) return bars;
  return [...bars].sort(
    (a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime()
  );
}

export function latestBar(bars: SetupBar[]): SetupBar | null {
  if (!bars.length) return null;
  return bars[bars.length - 1]!;
}

export function priorBar(bars: SetupBar[]): SetupBar | null {
  if (bars.length < 2) return null;
  return bars[bars.length - 2]!;
}

export function avgVolume(bars: SetupBar[], count: number): number {
  const slice = bars.slice(-count);
  if (!slice.length) return 0;
  return slice.reduce((s, b) => s + b.volume, 0) / slice.length;
}

export function toDailyBarLike(bars: SetupBar[]): DailyBarLike[] {
  return bars.map(({ open, high, low, close, volume }) => ({ open, high, low, close, volume }));
}
