/** US equity extended-hours classification in America/New_York (Alpaca-style: pre 4:00–9:30, RTH 9:30–16:00, post 16:00–20:00). */

export type UsEthSession = "pre" | "rth" | "post" | "closed";

/** Reuse formatters — constructing Intl.DateTimeFormat per bar was freezing the UI on ETH (many bars × many repaints). */
const ET_WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
});

const ET_HOUR_MIN_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const RTH_OPEN_MIN = 9 * 60 + 30;
export const RTH_CLOSE_MIN = 16 * 60;

export function getEtClockParts(utcSec: number): { weekday: string; totalMin: number } {
  const d = new Date(utcSec * 1000);
  const weekday = ET_WEEKDAY_FMT.format(d);
  const parts = ET_HOUR_MIN_FMT.formatToParts(d);
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "hour") hour = parseInt(p.value, 10) % 24;
    if (p.type === "minute") minute = parseInt(p.value, 10);
  }
  return { weekday, totalMin: hour * 60 + minute };
}

function etDateKey(utcSec: number): string {
  return ET_DATE_FMT.format(new Date(utcSec * 1000));
}

export function classifyUsEthSession(utcSec: number): UsEthSession {
  const { weekday, totalMin } = getEtClockParts(utcSec);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  if (totalMin >= 4 * 60 && totalMin < RTH_OPEN_MIN) return "pre";
  if (totalMin >= RTH_OPEN_MIN && totalMin < RTH_CLOSE_MIN) return "rth";
  if (totalMin >= RTH_CLOSE_MIN && totalMin < 20 * 60) return "post";
  return "closed";
}

/** One pass for all bar timestamps (call only when candle set changes, not on every paint). */
export function classifyUsEthSessionsForCandles(timestamps: readonly number[]): UsEthSession[] {
  const n = timestamps.length;
  const out = new Array<UsEthSession>(n);
  for (let i = 0; i < n; i++) {
    out[i] = classifyUsEthSession(timestamps[i]);
  }
  return out;
}

type DayRthBounds = {
  firstRth: number | null;
  lastRth: number | null;
  firstAtOrAfterClose: number | null;
};

/**
 * Bar times for a thin vertical at regular-session open (9:30 ET) and close (16:00 ET).
 * Open = first RTH bar that day. Close = first bar at/after 16:00 (ETH) else last RTH bar.
 */
export function rthSessionBoundaryTimes(timestamps: readonly number[]): number[] {
  const days = new Map<string, DayRthBounds>();
  for (const ts of timestamps) {
    if (!Number.isFinite(ts)) continue;
    const { weekday, totalMin } = getEtClockParts(ts);
    if (weekday === "Sat" || weekday === "Sun") continue;
    const key = etDateKey(ts);
    let acc = days.get(key);
    if (!acc) {
      acc = { firstRth: null, lastRth: null, firstAtOrAfterClose: null };
      days.set(key, acc);
    }
    if (totalMin >= RTH_OPEN_MIN && totalMin < RTH_CLOSE_MIN) {
      if (acc.firstRth == null) acc.firstRth = ts;
      acc.lastRth = ts;
    }
    if (totalMin >= RTH_CLOSE_MIN && acc.firstAtOrAfterClose == null) {
      acc.firstAtOrAfterClose = ts;
    }
  }
  const out: number[] = [];
  for (const acc of days.values()) {
    if (acc.firstRth != null) out.push(acc.firstRth);
    const closeTs = acc.firstAtOrAfterClose ?? acc.lastRth;
    if (closeTs != null && closeTs !== acc.firstRth) out.push(closeTs);
  }
  out.sort((a, b) => a - b);
  return out;
}
