/**
 * Days to the next earnings report (and since the last one) for FND-4 Earnings Proximity, from the app's stored
 * earnings data (fundamentals.getCachedEarningsData: the daily earnings calendar, else the tickers table; a "next"
 * date already past is never returned). Undefined means no data: FND-4 then says "no earnings date" and never passes,
 * inverted or not.
 */
export interface CachedEarnings {
  nextEarningsDate: string | null;
  nextEarningsDays: number;
  lastEarningsDate: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);

export function earningsDays(e: CachedEarnings | null | undefined, today: string): { daysToEarnings?: number; daysSinceEarnings?: number } {
  if (!e) return {};
  const out: { daysToEarnings?: number; daysSinceEarnings?: number } = {};
  if (e.nextEarningsDate && ISO_DAY.test(e.nextEarningsDate) && e.nextEarningsDate >= today) out.daysToEarnings = dayDiff(e.nextEarningsDate, today);
  if (e.lastEarningsDate && ISO_DAY.test(e.lastEarningsDate) && e.lastEarningsDate <= today) out.daysSinceEarnings = dayDiff(today, e.lastEarningsDate);
  return out;
}
