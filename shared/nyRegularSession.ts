/**
 * US equity regular session in America/New_York (9:30–16:00 ET, Mon–Fri).
 * Used for RTH-only MA / VWAP math while candles may include extended hours.
 * Does not consult exchange holiday calendars (same simplification as other chart paths).
 */

const ET = "America/New_York";
const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60;

// Built once: a new Intl.DateTimeFormat per call allocates ICU objects (~KBs each, outside the JS heap and freed
// only when GC gets to them); the outcome tracker's per-row calls grew RSS by 200+ MB in one second (27 Nov repro).
const ET_WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short" });
const ET_HM_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `timestampSec` = UNIX seconds (chart candle time). */
export function isUsEquityRegularSessionEt(timestampSec: number): boolean {
  const ms = timestampSec * 1000;
  const d = new Date(ms);
  const wd = ET_WEEKDAY_FMT.format(d);
  if (wd === "Sat" || wd === "Sun") return false;

  const parts = ET_HM_FMT.formatToParts(d);

  let h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  if (h === 24) h = 0;
  const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  const mins = h * 60 + m;
  return mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN;
}
