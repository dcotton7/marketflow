/**
 * Theme Tracker Time Utilities
 * 
 * Single source of truth for date/time calculations across Market Condition features.
 * All features that load theme snapshots or interpret "how far back" use these shared helpers.
 * 
 * See docs/spec-next-build-theme-tracker-unified-dates.md for full spec.
 */
import { fetchAlpacaTradingCalendar } from "../../alpaca";

const ET_TIMEZONE = "America/New_York";
const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;
const TRADING_CALENDAR_CACHE_MS = 6 * 60 * 60 * 1000;

type TradingCalendarCacheEntry = {
  fetchedAt: number;
  marketDates: string[];
};

const tradingCalendarCache = new Map<string, TradingCalendarCacheEntry>();

export type RaceTerminalState = "LIVE" | "AFTER_HOURS" | "PRE_OPEN" | "CLOSED";

export interface RaceTimelineWindow {
  fromInstant: Date;
  fromDateStr: string;
  interpretation: "trading" | "calendar";
  terminalState: RaceTerminalState;
}

/**
 * Subtract N trading days from an anchor date.
 * Trading days = Mon-Fri (weekends excluded).
 * 
 * @param anchor - Starting date
 * @param tradingDays - Number of trading days to go back
 * @returns Date object set to 00:00:00.000 UTC for the target trading day
 * 
 * @example
 * // If anchor is Friday, Mar 28, 2026, and tradingDays = 1:
 * // Returns Thursday, Mar 27, 2026 at 00:00:00.000 UTC
 * 
 * // If anchor is Monday, Mar 31, 2026, and tradingDays = 1:
 * // Returns Friday, Mar 28, 2026 at 00:00:00.000 UTC (skips weekend)
 */
export function subtractTradingDays(anchor: Date, tradingDays: number): Date {
  const d = new Date(anchor);
  d.setUTCHours(0, 0, 0, 0);
  let remaining = tradingDays;
  
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (day !== 0 && day !== 6) {
      remaining--;
    }
  }
  
  return d;
}

/**
 * Range key to trading days mapping.
 * This defines how each range key maps to a lookback window.
 * 
 * Short ranges (1d-5d): Exact trading days
 * Week ranges (2w, 3w): 10 and 15 trading days (2×5, 3×5)
 * Month+ ranges: Approximate calendar days for simplicity
 */
const RANGE_TO_DAYS: Record<string, { days: number; useTradingDays: boolean }> = {
  "1d": { days: 1, useTradingDays: true },
  "2d": { days: 2, useTradingDays: true },
  "3d": { days: 3, useTradingDays: true },
  "4d": { days: 4, useTradingDays: true },
  "5d": { days: 5, useTradingDays: true },
  "2w": { days: 10, useTradingDays: true },  // 2 weeks = 10 trading days
  "3w": { days: 15, useTradingDays: true },  // 3 weeks = 15 trading days
  "1mo": { days: 30, useTradingDays: false }, // ~1 calendar month
  "3mo": { days: 90, useTradingDays: false }, // ~3 calendar months
  "6mo": { days: 180, useTradingDays: false }, // ~6 calendar months
  "1y": { days: 365, useTradingDays: false }, // ~1 calendar year
};

function getCachedCalendarKey(startDate: string, endDate: string): string {
  return `${startDate}:${endDate}`;
}

async function getTradingCalendarMarketDates(startDate: string, endDate: string): Promise<string[]> {
  const cacheKey = getCachedCalendarKey(startDate, endDate);
  const cached = tradingCalendarCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < TRADING_CALENDAR_CACHE_MS) {
    return cached.marketDates;
  }

  const calendar = await fetchAlpacaTradingCalendar(startDate, endDate);
  const marketDates = calendar
    .map((day) => day.date)
    .filter((date): date is string => typeof date === "string" && date.length === 10)
    .sort();

  tradingCalendarCache.set(cacheKey, {
    fetchedAt: Date.now(),
    marketDates,
  });

  return marketDates;
}

function getEtParts(anchor: Date): { date: string; hour: number; minute: number } {
  const etString = anchor.toLocaleString("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const [datePart, timePart] = etString.split(", ");
  const [month, day, year] = datePart.split("/");
  const [hourStr, minuteStr] = timePart.split(":");

  return {
    date: `${year}-${month}-${day}`,
    hour: parseInt(hourStr, 10),
    minute: parseInt(minuteStr, 10),
  };
}

function zonedDateTimeToUtc(marketDate: string, hour: number, minute: number): Date {
  const [yearStr, monthStr, dayStr] = marketDate.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  for (let i = 0; i < 3; i++) {
    const parts = getEtParts(guess);
    const actualMinutes = Date.UTC(
      parseInt(parts.date.slice(0, 4), 10),
      parseInt(parts.date.slice(5, 7), 10) - 1,
      parseInt(parts.date.slice(8, 10), 10),
      parts.hour,
      parts.minute,
      0,
      0
    ) / 60000;
    const targetMinutes = Date.UTC(year, month - 1, day, hour, minute, 0, 0) / 60000;
    const diffMinutes = targetMinutes - actualMinutes;
    if (diffMinutes === 0) break;
    guess = new Date(guess.getTime() + diffMinutes * 60000);
  }
  return guess;
}

function addCalendarDays(anchor: Date, daysBack: number): Date {
  const d = new Date(anchor);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d;
}

function getRaceTerminalState(anchor: Date, hasTodaySession: boolean): RaceTerminalState {
  if (!hasTodaySession) return "CLOSED";
  const { hour, minute } = getEtParts(anchor);
  const currentMinutes = hour * 60 + minute;
  if (currentMinutes < MARKET_OPEN_MINUTES) return "PRE_OPEN";
  if (currentMinutes < MARKET_CLOSE_MINUTES) return "LIVE";
  return "AFTER_HOURS";
}

function getFallbackTerminalState(anchor: Date): RaceTerminalState {
  const etNow = new Date(anchor.toLocaleString("en-US", { timeZone: ET_TIMEZONE }));
  const day = etNow.getDay();
  if (day === 0 || day === 6) return "CLOSED";

  const currentMinutes = etNow.getHours() * 60 + etNow.getMinutes();
  if (currentMinutes < MARKET_OPEN_MINUTES) return "PRE_OPEN";
  if (currentMinutes < MARKET_CLOSE_MINUTES) return "LIVE";
  return "AFTER_HOURS";
}

export function deriveTradingRangeWindow(
  rangeKey: string,
  marketDates: string[],
  anchor: Date = new Date()
): { fromDateStr: string; terminalState: RaceTerminalState } | null {
  const config = RANGE_TO_DAYS[rangeKey];
  if (!config || !config.useTradingDays || marketDates.length === 0) return null;

  const { date: todayEt } = getEtParts(anchor);
  const todayIndex = marketDates.lastIndexOf(todayEt);
  const hasTodaySession = todayIndex !== -1;
  const terminalState = getRaceTerminalState(anchor, hasTodaySession);

  const anchorIndex = hasTodaySession ? todayIndex : marketDates.length - 1;
  if (anchorIndex < 0) return null;

  const startIndex = Math.max(0, anchorIndex - config.days);
  return {
    fromDateStr: marketDates[startIndex],
    terminalState,
  };
}

/**
 * Calculate the lookback boundary for a race timeline range.
 * 
 * For day-based ranges (1d-5d, 2w, 3w): Uses trading-day semantics
 * For month+ ranges: Uses calendar days from current UTC time
 * 
 * @param rangeKey - Range identifier (e.g., "1d", "3d", "2w", "1mo")
 * @param resolution - Whether this is for intraday or daily snapshots
 * @returns Object with fromInstant (Date for intraday queries) and fromDateStr (YYYY-MM-DD for daily queries)
 * 
 * @example
 * // For "3d" range on Friday, Mar 28, 2026:
 * // Returns Tuesday, Mar 25, 2026 (skipping weekend)
 * 
 * // For "1mo" range on Mar 28, 2026:
 * // Returns ~Feb 26, 2026 (30 calendar days back)
 */
export function raceLookbackStart(
  rangeKey: string,
  resolution: "intraday" | "daily"
): { fromInstant: Date; fromDateStr: string; interpretation: "trading" | "calendar" } {
  const config = RANGE_TO_DAYS[rangeKey];
  
  if (!config) {
    // Fallback for unknown range keys: 3 calendar days
    console.warn(`[theme-tracker-time] Unknown range key "${rangeKey}", defaulting to 3 calendar days`);
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() - 3);
    fallback.setUTCHours(0, 0, 0, 0);
    return {
      fromInstant: fallback,
      fromDateStr: fallback.toISOString().slice(0, 10),
      interpretation: "calendar",
    };
  }
  
  const now = new Date();
  let fromInstant: Date;
  
  if (config.useTradingDays) {
    // Use trading-day arithmetic (skip weekends)
    fromInstant = subtractTradingDays(now, config.days);
  } else {
    // Use calendar days
    fromInstant = new Date(now);
    fromInstant.setUTCDate(fromInstant.getUTCDate() - config.days);
    fromInstant.setUTCHours(0, 0, 0, 0);
  }
  
  const fromDateStr = fromInstant.toISOString().slice(0, 10);
  
  return {
    fromInstant,
    fromDateStr,
    interpretation: config.useTradingDays ? "trading" : "calendar",
  };
}

export async function getRaceTimelineWindow(
  rangeKey: string,
  anchor: Date = new Date()
): Promise<RaceTimelineWindow> {
  const config = RANGE_TO_DAYS[rangeKey];
  if (!config) {
    const fallback = raceLookbackStart(rangeKey, "intraday");
    return {
      ...fallback,
      terminalState: getFallbackTerminalState(anchor),
    };
  }

  if (!config.useTradingDays) {
    const fromInstant = addCalendarDays(anchor, config.days);
    fromInstant.setUTCHours(0, 0, 0, 0);

    const calendarStart = formatMarketDateET(addCalendarDays(anchor, 10));
    const calendarEnd = formatMarketDateET(anchor);
    const marketDates = await getTradingCalendarMarketDates(calendarStart, calendarEnd);
    const { date: todayEt } = getEtParts(anchor);
    const terminalState = getRaceTerminalState(anchor, marketDates.includes(todayEt));

    return {
      fromInstant,
      fromDateStr: formatMarketDateET(fromInstant),
      interpretation: "calendar",
      terminalState,
    };
  }

  const lookbackCalendarDays = Math.max(45, config.days * 5);
  const calendarStart = formatMarketDateET(addCalendarDays(anchor, lookbackCalendarDays));
  const calendarEnd = formatMarketDateET(anchor);
  const marketDates = await getTradingCalendarMarketDates(calendarStart, calendarEnd);
  const derived = deriveTradingRangeWindow(rangeKey, marketDates, anchor);

  if (!derived) {
    const fallback = raceLookbackStart(rangeKey, "intraday");
    return {
      ...fallback,
      terminalState: getFallbackTerminalState(anchor),
    };
  }

  return {
    fromInstant: zonedDateTimeToUtc(derived.fromDateStr, 9, 30),
    fromDateStr: derived.fromDateStr,
    interpretation: "trading",
    terminalState: derived.terminalState,
  };
}

/**
 * Format a Date object as YYYY-MM-DD in Eastern Time.
 * 
 * @param d - Date to format
 * @returns Date string in YYYY-MM-DD format (ET timezone)
 * 
 * @example
 * // For a Date representing 2026-03-28 01:00:00 UTC (which is 2026-03-27 21:00:00 ET):
 * // Returns "2026-03-27"
 */
export function formatMarketDateET(d: Date): string {
  const etString = d.toLocaleString("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  
  // Parse: "03/27/2026" format
  const [month, day, year] = etString.split(/[/, ]/);
  return `${year}-${month}-${day}`;
}

/**
 * Get current market date and time in Eastern Time.
 * 
 * @returns Object with date (YYYY-MM-DD), hour (0-23), minute (0-59), and slot (0, 15, 30, or 45)
 */
export function getMarketDateTime(anchor: Date = new Date()): { date: string; hour: number; minute: number; slot: number } {
  const { date, hour, minute } = getEtParts(anchor);
  
  // Calculate 15-minute slot (0, 15, 30, 45)
  const slot = Math.floor(minute / 15) * 15;
  
  return {
    date,
    hour,
    minute,
    slot,
  };
}
