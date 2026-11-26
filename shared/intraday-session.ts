/**
 * Regular-session intraday levels, in America/New_York time: which bars belong to the regular session (9:30 to the
 * close, 13:00 on the exchanges' early-close days, weekdays, not holidays), the opening range, session VWAP, high and
 * low of day, and the prior session's high, low and close. Each bar's `date` is the ISO timestamp of its start.
 * DST-safe: every clock reading goes through Intl with the New York zone, never a fixed UTC offset.
 *
 * Shared by the alerts (server/alerts/setup-rules.ts) and BigIdea's session indicators (ITD-4..ITD-7), so both
 * measure the same thing. Session VWAP is calculateSessionVwap in ./chart-indicators (what the chart shows).
 */
import { calculateSessionVwap } from "./chart-indicators";
import { isMarketHoliday, regularCloseMinute } from "./us-market-holidays";

export type SessionBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

export const RTH_OPEN_MINUTE = 9 * 60 + 30;

const CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

/** ET date (YYYY-MM-DD), minute of the ET day and weekday of an instant. */
export function etClock(iso: string): { day: string; minute: number; weekday: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts: Record<string, string> = {};
  for (const p of CLOCK.formatToParts(d)) parts[p.type] = p.value;
  let h = parseInt(parts.hour || "0", 10);
  if (h === 24) h = 0;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: h * 60 + parseInt(parts.minute || "0", 10), weekday: parts.weekday || "" };
}

function inSession(c: { day: string; minute: number; weekday: string } | null): boolean {
  if (!c || c.weekday === "Sat" || c.weekday === "Sun" || isMarketHoliday(c.day)) return false;
  return c.minute >= RTH_OPEN_MINUTE && c.minute < regularCloseMinute(c.day);
}

/** A bar starting inside the regular session of a trading day (early closes end at 13:00 ET). */
export function isRegularSessionBar(iso: string): boolean {
  return inSession(etClock(iso));
}

/** Regular-session bars only, grouped by ET day, days and bars oldest first. */
export function regularSessionDays<T extends SessionBar>(barsOldestFirst: T[]): { day: string; bars: T[] }[] {
  const out: { day: string; bars: T[] }[] = [];
  for (const b of barsOldestFirst) {
    const c = etClock(b.date);
    if (!inSession(c)) continue;
    if (!out.length || out[out.length - 1].day !== c!.day) out.push({ day: c!.day, bars: [] });
    out[out.length - 1].bars.push(b);
  }
  return out;
}

export interface SessionWindow<T extends SessionBar> {
  /** the regular-session bar being judged: the newest one, or `skip` session bars before it */
  bar: T;
  day: string;
  /** that day's session bars up to and including `bar`, oldest first */
  today: T[];
  /** the previous trading session's bars in the data, oldest first (empty when the data starts that day) */
  prior: T[];
}

/**
 * The session around one bar, read from newest-first bars (BigIdea's order). Pre-market, after-hours, weekend and
 * holiday bars are ignored, so after the close the last regular bar is judged. Stops reading once the prior session
 * is complete, so it costs a couple of days of bars however long the series is.
 */
export function sessionWindow<T extends SessionBar>(barsNewestFirst: T[], skip = 0): SessionWindow<T> | null {
  let seen = 0;
  let target: { bar: T; day: string } | null = null;
  const today: T[] = [];
  const prior: T[] = [];
  let priorDay: string | null = null;
  for (const b of barsNewestFirst) {
    const c = etClock(b.date);
    if (!inSession(c)) continue;
    if (!target) {
      if (seen++ < skip) continue;
      target = { bar: b, day: c!.day };
      today.push(b);
      continue;
    }
    if (c!.day === target.day) { today.push(b); continue; }
    if (priorDay === null) priorDay = c!.day;
    if (c!.day !== priorDay) break;
    prior.push(b);
  }
  if (!target) return null;
  return { bar: target.bar, day: target.day, today: today.reverse(), prior: prior.reverse() };
}

/**
 * High and low of the bars that start in the first `minutes` of the session. `complete` once a bar starting at or
 * after 9:30 + minutes exists (the range can no longer change). Null when no bar of the window is present.
 */
export function openingRange(sessionBars: SessionBar[], minutes: number): { high: number; low: number; bars: number; complete: boolean } | null {
  const end = RTH_OPEN_MINUTE + minutes;
  let high = -Infinity, low = Infinity, n = 0, complete = false;
  for (const b of sessionBars) {
    const m = etClock(b.date)?.minute ?? -1;
    if (m >= end) complete = true;
    else if (m >= RTH_OPEN_MINUTE) { high = Math.max(high, b.high); low = Math.min(low, b.low); n++; }
  }
  return n ? { high, low, bars: n, complete } : null;
}

/** Session VWAP after each bar (one session's bars, oldest first). */
export function sessionVwap(sessionBars: SessionBar[]): (number | null)[] {
  return calculateSessionVwap(sessionBars);
}

export function highLowOfDay(sessionBars: SessionBar[]): { high: number; low: number } | null {
  if (!sessionBars.length) return null;
  return { high: Math.max(...sessionBars.map((b) => b.high)), low: Math.min(...sessionBars.map((b) => b.low)) };
}

/** The prior session's regular-hours high, low and close. */
export function priorDayLevels(prior: SessionBar[]): { high: number; low: number; close: number } | null {
  const hl = highLowOfDay(prior);
  return hl ? { ...hl, close: prior[prior.length - 1].close } : null;
}
