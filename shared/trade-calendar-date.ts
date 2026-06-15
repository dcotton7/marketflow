/**
 * Broker Activity trade dates are calendar days (YYYY-MM-DD) with no timezone.
 * Never use `new Date(ymd)` — that parses as UTC midnight and shifts the day in US Eastern.
 */

/** Store a broker calendar date as noon UTC (stable across US timezones). */
export function brokerTradeDateToTimestamp(ymd: string): Date {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(ymd);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`);
}

/**
 * Calendar day key (YYYY-MM-DD) for journal grouping and display.
 * - Legacy UTC-midnight timestamps: use the UTC date (original broker intent).
 * - Noon UTC broker dates: use the UTC date.
 * - Timed executions: US Eastern session calendar day.
 */
export function brokerCalendarDayKey(isoOrDate: string | Date | null | undefined): string | null {
  if (!isoOrDate) return null;
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  if (/T00:00:00\.000Z$/.test(iso) || /T12:00:00\.000Z$/.test(iso)) {
    return iso.slice(0, 10);
  }
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Trading days strictly after entry through exit (inclusive of exit). */
export function countMarketDaysHeld(entryYmd: string, exitYmd: string): number {
  const start = brokerTradeDateToTimestamp(entryYmd);
  const end = brokerTradeDateToTimestamp(exitYmd);
  if (end.getTime() <= start.getTime()) return 0;
  let count = 0;
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getTime() <= end.getTime()) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}
