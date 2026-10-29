/**
 * NYSE / Nasdaq full-day closures and 1:00 PM ET early closes, by ET date (YYYY-MM-DD).
 * Source: the exchanges' published holiday calendars. Extend each year; isKnownYear() lets callers warn when a year
 * is missing instead of silently treating a holiday as a trading day.
 */
export const US_MARKET_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** Regular session ends 13:00 ET on these days. */
export const US_MARKET_EARLY_CLOSES: ReadonlySet<string> = new Set([
  "2026-11-27", "2026-12-24",
  "2027-11-26",
]);

const KNOWN_YEARS = new Set(["2026", "2027"]);

export function isMarketHoliday(etDate: string): boolean {
  return US_MARKET_HOLIDAYS.has(etDate);
}

/** Minute of the ET day the regular session closes (960 = 16:00, 780 = 13:00). */
export function regularCloseMinute(etDate: string): number {
  return US_MARKET_EARLY_CLOSES.has(etDate) ? 13 * 60 : 16 * 60;
}

export function isKnownHolidayYear(etDate: string): boolean {
  return KNOWN_YEARS.has(etDate.slice(0, 4));
}

/** ET calendar date (YYYY-MM-DD) for an instant. */
export function etDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}
