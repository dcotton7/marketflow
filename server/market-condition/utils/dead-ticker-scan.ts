/**
 * Weekly dead-ticker scan — lightest reliable check:
 * multi-symbol Alpaca 1Day bars over ~10 calendar days.
 * Symbols with no bar on/after SPY's latest session (usually Friday) are
 * treated as dead/renamed (ZI→GTM class).
 *
 * Schedule: Sunday 7:00 PM America/New_York.
 */

import { fetchAlpacaMultiSymbolDailyBars } from "../../alpaca";
import { getAllUniverseTickers } from "../universe";
import {
  getDelistedSymbols,
  isDelistedSymbol,
  removeTickerFromUniverse,
} from "./delisted-ticker-registry";

const BATCH_SIZE = 100;
const LOOKBACK_CALENDAR_DAYS = 10;
const CHECK_INTERVAL_MS = 60_000;

export type DeadTickerScanStatus = {
  schedule: "Sunday 7:00 PM ET";
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastUniverseSize: number;
  lastCutoffDate: string | null;
  lastMissingFriday: string[];
  lastRemoved: string[];
  lastError: string | null;
  inProgress: boolean;
  nextRunHint: string;
  delistedCount: number;
};

let lastRunAt: Date | null = null;
let lastDurationMs: number | null = null;
let lastUniverseSize = 0;
let lastCutoffDate: string | null = null;
let lastMissingFriday: string[] = [];
let lastRemoved: string[] = [];
let lastError: string | null = null;
let inProgress = false;
let lastFiredSundayKey: string | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

function getEtParts(date: Date): { y: number; mo: number; d: number; h: number; m: number; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: parseInt(get("year"), 10),
    mo: parseInt(get("month"), 10),
    d: parseInt(get("day"), 10),
    h: parseInt(get("hour"), 10) % 24,
    m: parseInt(get("minute"), 10),
    dow: dayMap[get("weekday")] ?? 0,
  };
}

function etDateKey(date: Date): string {
  const { y, mo, d } = getEtParts(date);
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function barEtDateStr(barDate: string): string {
  return etDateKey(new Date(barDate));
}

function lastWeekdayEtDateStr(from: Date = new Date()): string {
  const cursor = new Date(from);
  for (let i = 0; i < 10; i++) {
    const { dow, y, mo, d } = getEtParts(cursor);
    if (dow >= 1 && dow <= 5) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return etDateKey(from);
}

/**
 * Scan universe: any symbol with no daily bar on/after the latest SPY session
 * (typically Friday when run Sunday) is dead or renamed.
 */
export async function runDeadTickerScan(opts?: {
  autoRemove?: boolean;
}): Promise<DeadTickerScanStatus> {
  if (inProgress) {
    return getDeadTickerScanStatus();
  }

  const autoRemove = opts?.autoRemove !== false;
  inProgress = true;
  lastError = null;
  const started = Date.now();

  try {
    const universe = getAllUniverseTickers()
      .map((s) => s.toUpperCase())
      .filter((s) => !isDelistedSymbol(s));
    lastUniverseSize = universe.length;

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - LOOKBACK_CALENDAR_DAYS);

    // Anchor cutoff to SPY's latest bar so holiday Fridays don't false-positive the whole universe
    const spyMap = await fetchAlpacaMultiSymbolDailyBars(["SPY"], start, end);
    const spyDates = (spyMap.get("SPY") ?? []).map((b) => barEtDateStr(b.date)).sort();
    const cutoff = spyDates[spyDates.length - 1] ?? lastWeekdayEtDateStr(end);
    lastCutoffDate = cutoff;

    const missing: string[] = [];

    for (let i = 0; i < universe.length; i += BATCH_SIZE) {
      const batch = universe.slice(i, i + BATCH_SIZE);
      const barsBySym = await fetchAlpacaMultiSymbolDailyBars(batch, start, end);
      for (const sym of batch) {
        const bars = barsBySym.get(sym) ?? [];
        const hasRecentSession = bars.some((b) => barEtDateStr(b.date) >= cutoff);
        if (!hasRecentSession) missing.push(sym);
      }
      if (i + BATCH_SIZE < universe.length) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    lastMissingFriday = missing.sort();
    const removed: string[] = [];

    if (autoRemove) {
      for (const sym of missing) {
        try {
          const result = await removeTickerFromUniverse(
            sym,
            `dead-ticker-scan: no daily bar on/after ${cutoff}`
          );
          if (result.removed) removed.push(sym);
        } catch (err) {
          console.warn(`[DeadTickerScan] Failed to remove ${sym}:`, err);
        }
      }
    }

    lastRemoved = removed;
    lastRunAt = new Date();
    lastDurationMs = Date.now() - started;

    console.log(
      `[DeadTickerScan] Done in ${lastDurationMs}ms — universe=${universe.length}, ` +
        `cutoff=${cutoff}, missing=${missing.length}, removed=${removed.length}` +
        (missing.length ? `: ${missing.join(",")}` : "")
    );
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    lastDurationMs = Date.now() - started;
    console.warn(`[DeadTickerScan] Failed:`, lastError);
  } finally {
    inProgress = false;
  }

  return getDeadTickerScanStatus();
}

export function getDeadTickerScanStatus(): DeadTickerScanStatus {
  const now = new Date();
  const et = getEtParts(now);
  const nextHint =
    et.dow === 0 && et.h < 19
      ? "today 7:00 PM ET"
      : et.dow === 0 && et.h === 19 && et.m < 5
        ? "now (window)"
        : "next Sunday 7:00 PM ET";

  return {
    schedule: "Sunday 7:00 PM ET",
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastDurationMs,
    lastUniverseSize,
    lastCutoffDate,
    lastMissingFriday,
    lastRemoved,
    lastError,
    inProgress,
    nextRunHint: nextHint,
    delistedCount: getDelistedSymbols().length,
  };
}

function maybeFireSundayJob(): void {
  const now = new Date();
  const et = getEtParts(now);
  if (et.dow !== 0 || et.h !== 19 || et.m > 4) return;
  const key = etDateKey(now);
  if (lastFiredSundayKey === key) return;
  lastFiredSundayKey = key;
  console.log(`[DeadTickerScan] Sunday 7pm ET window — starting weekly scan`);
  void runDeadTickerScan({ autoRemove: true });
}

export function startDeadTickerScanScheduler(): void {
  if (intervalId) return;
  intervalId = setInterval(maybeFireSundayJob, CHECK_INTERVAL_MS);
  setTimeout(maybeFireSundayJob, 45_000);
  console.log("[DeadTickerScan] Scheduler started (Sunday 7:00 PM ET, Fri-bar check)");
}

export function stopDeadTickerScanScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
