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

export function classifyUsEthSession(utcSec: number): UsEthSession {
  const { weekday, totalMin } = getEtClockParts(utcSec);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  if (totalMin >= 4 * 60 && totalMin < 9 * 60 + 30) return "pre";
  if (totalMin >= 9 * 60 + 30 && totalMin < 16 * 60) return "rth";
  if (totalMin >= 16 * 60 && totalMin < 20 * 60) return "post";
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
