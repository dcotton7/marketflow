/**
 * Dated theme watchlists for Ticker Review starring — `{ThemeName}_{MMDDYYYY}` in ET.
 */

export type MarketSessionKind = "MARKET_HOURS" | "AFTER_HOURS" | "CLOSED";

const ET = "America/New_York";

export function getEtNowParts(): { year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const weekdayStr = get("weekday");
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    weekday: weekdayMap[weekdayStr] ?? 0,
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
  };
}

/** Client/server mirror of server/market-condition getMarketSession. */
export function getMarketSessionEt(): MarketSessionKind {
  const { weekday, hour, minute } = getEtNowParts();
  if (weekday === 0 || weekday === 6) return "CLOSED";
  const currentMinutes = hour * 60 + minute;
  const openMinutes = 9 * 60 + 30;
  const closeMinutes = 16 * 60;
  const afterHoursEnd = 20 * 60;
  if (currentMinutes >= openMinutes && currentMinutes < closeMinutes) return "MARKET_HOURS";
  if (currentMinutes >= closeMinutes && currentMinutes < afterHoursEnd) return "AFTER_HOURS";
  return "CLOSED";
}

function addCalendarDays(year: number, month: number, day: number, delta: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function nextWeekday(year: number, month: number, day: number): { year: number; month: number; day: number } {
  let y = year;
  let m = month;
  let d = day;
  for (let i = 0; i < 7; i++) {
    const candidate = addCalendarDays(y, m, d, 1);
    const wd = new Date(Date.UTC(candidate.year, candidate.month - 1, candidate.day)).getUTCDay();
    if (wd !== 0 && wd !== 6) return candidate;
    y = candidate.year;
    m = candidate.month;
    d = candidate.day;
  }
  return addCalendarDays(year, month, day, 1);
}

function formatTradingDayKey(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${mm}${dd}${year}`;
}

/** Trading day key for starring target: MMDDYYYY in ET. */
export function resolveTradingDayKey(session: MarketSessionKind = getMarketSessionEt()): string {
  const { year, month, day, weekday, hour, minute } = getEtNowParts();

  if (session === "MARKET_HOURS") {
    return formatTradingDayKey(year, month, day);
  }

  if (session === "AFTER_HOURS") {
    const next = nextWeekday(year, month, day);
    return formatTradingDayKey(next.year, next.month, next.day);
  }

  // CLOSED — weekend or outside 9:30–20:00 ET
  if (weekday === 0 || weekday === 6) {
    const next = nextWeekday(year, month, day);
    return formatTradingDayKey(next.year, next.month, next.day);
  }

  const currentMinutes = hour * 60 + minute;
  const openMinutes = 9 * 60 + 30;
  if (currentMinutes < openMinutes) {
    return formatTradingDayKey(year, month, day);
  }

  const next = nextWeekday(year, month, day);
  return formatTradingDayKey(next.year, next.month, next.day);
}

export function sanitizeThemeNameForWatchlist(themeName: string): string {
  const cleaned = themeName
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 40);
  return cleaned || "Theme";
}

export function buildDailyWatchlistName(themeName: string, tradingDayKey?: string): string {
  const key = tradingDayKey ?? resolveTradingDayKey();
  return `${sanitizeThemeNameForWatchlist(themeName)}_${key}`;
}

/** Names like GamingCasinos_06062026 */
export function isDailyThemeWatchlistName(name: string): boolean {
  return /^[A-Za-z0-9]+_\d{8}$/.test(name.trim());
}

export const THEME_REVIEW_SNAPSHOT_PREFIX = "__themeReview__:";

export function encodeThemeReviewThesis(snapshot: unknown): string {
  return `${THEME_REVIEW_SNAPSHOT_PREFIX}${JSON.stringify(snapshot)}`;
}

export function decodeThemeReviewThesis(thesis: string | null | undefined): unknown | null {
  if (!thesis?.startsWith(THEME_REVIEW_SNAPSHOT_PREFIX)) return null;
  try {
    return JSON.parse(thesis.slice(THEME_REVIEW_SNAPSHOT_PREFIX.length));
  } catch {
    return null;
  }
}
