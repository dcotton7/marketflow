// ---------------------------------------------------------------------------
// Outcome Tracker V3 — exact 5m checkpoints + bar-bounded MFE/MAE
//
// Runs every 3 minutes. V3 fills due clocks from the closest eligible 5-minute
// bar (not a later live print), derives MFE/MAE from bars inside the elapsed
// horizon, locks a proxy symbol at first touch, and separates intraday
// completion from longer-horizon scheduling.
//
// Existing V2 rows are never rewritten. New fills stamp outcome_contract_version=v3.
// ---------------------------------------------------------------------------

import { db } from "../db";
import { scannerDiscoveries } from "@shared/schema";
import { eq, and, isNull, sql, inArray, notInArray, lt, or } from "drizzle-orm";
import { currentFrame } from "./signal-producer";
import { getClusterById, type ClusterId } from "../market-condition/universe";
import { fetchAlpacaDailyBars, fetchAlpacaIntradayBars, fetchAlpacaQuote } from "../alpaca";
import {
  OUTCOME_CONTRACT_V3,
  computeHorizonExcursion,
  moveFrom,
  resolveExactCheckpointClose,
  type OutcomeBar,
} from "@shared/scanner-outcome-v3";

const INTERVAL_MS = 3 * 60_000;

const SKIP_SIGNAL_TYPES = new Set(["news_alert"]);

const MARKET_LEVEL_SIGNAL_TYPES = new Set([
  "regime_change", "rai_shift", "broad_weakness", "broad_strength",
]);

const BROAD_MARKET_PROXIES = ["SPY", "QQQ", "IWM"];
const MARKET_STRENGTH_PROXIES = ["QQQ", "SPY"];

function getEtParts(date: Date): { h: number; m: number; dayOfWeek: number; dateStr: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[weekday] ?? 1;
  const year = parts.find((p) => p.type === "year")?.value ?? "2024";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return { h, m, dayOfWeek, dateStr: `${year}-${month}-${day}` };
}

function addTradingDays(date: Date, n: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < n) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

function isAfterEtTime(now: Date, targetH: number, targetM: number): boolean {
  const { h, m } = getEtParts(now);
  return h * 60 + m >= targetH * 60 + targetM;
}

function getEtDate(date: Date): string {
  return getEtParts(date).dateStr;
}

let cycleCount = 0;

function shouldProcessRow(elapsedMs: number, now: Date): boolean {
  const elapsedHrs = elapsedMs / (60 * 60_000);
  const { h, m } = getEtParts(now);
  const etMins = h * 60 + m;
  if (elapsedHrs <= 4) return true;
  const elapsedDays = elapsedHrs / 24;
  if (elapsedDays <= 1) return cycleCount % 3 === 0;
  if (elapsedDays <= 7) {
    return (etMins >= 575 && etMins <= 580) || (etMins >= 975 && etMins <= 980);
  }
  return etMins >= 975 && etMins <= 980;
}

function isMarketActive(): boolean {
  const { h, m, dayOfWeek } = getEtParts(new Date());
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const etMins = h * 60 + m;
  return etMins >= 240 && etMins < 1200;
}

function rowNeedsDueCheckpoint(
  row: {
    createdAt: Date;
    price15m: number | null;
    price30m: number | null;
    price1hr: number | null;
    price4hr: number | null;
    priceD1Close: number | null;
    priceD2Open: number | null;
    priceD2Close: number | null;
    price1w: number | null;
    price1mo: number | null;
  },
  now: Date = new Date()
): boolean {
  const elapsedMin = (now.getTime() - row.createdAt.getTime()) / 60_000;
  if (elapsedMin >= 15 && row.price15m == null) return true;
  if (elapsedMin >= 30 && row.price30m == null) return true;
  if (elapsedMin >= 60 && row.price1hr == null) return true;
  if (elapsedMin >= 240 && row.price4hr == null) return true;

  const signalDate = row.createdAt;
  const signalEtDate = getEtDate(signalDate);
  const nowEtDate = getEtDate(now);

  if (row.priceD1Close == null) {
    const pastD1Close =
      (signalEtDate === nowEtDate && isAfterEtTime(now, 16, 15)) ||
      signalEtDate < nowEtDate;
    if (pastD1Close) return true;
  }
  if (row.priceD2Open == null) {
    const d2EtDate = getEtDate(addTradingDays(signalDate, 1));
    if ((nowEtDate === d2EtDate && isAfterEtTime(now, 9, 35)) || nowEtDate > d2EtDate) return true;
  }
  if (row.priceD2Close == null) {
    const d2EtDate = getEtDate(addTradingDays(signalDate, 1));
    if ((nowEtDate === d2EtDate && isAfterEtTime(now, 16, 15)) || nowEtDate > d2EtDate) return true;
  }
  if (row.price1w == null) {
    const d5EtDate = getEtDate(addTradingDays(signalDate, 5));
    if ((nowEtDate === d5EtDate && isAfterEtTime(now, 16, 15)) || nowEtDate > d5EtDate) return true;
  }
  if (row.price1mo == null) {
    const d20EtDate = getEtDate(addTradingDays(signalDate, 20));
    if ((nowEtDate === d20EtDate && isAfterEtTime(now, 16, 15)) || nowEtDate > d20EtDate) return true;
  }
  return false;
}

type DailyBar = OutcomeBar & { o?: number };

async function loadIntradayBars(symbol: string, from: Date, to: Date): Promise<OutcomeBar[]> {
  const bars = await fetchAlpacaIntradayBars(symbol, from, to, "5Min", true).catch(() => []);
  return bars.map((b) => ({
    t: new Date(b.date).getTime(),
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
  }));
}

async function loadDailyCloses(symbol: string, from: Date, to: Date): Promise<DailyBar[]> {
  const bars = await fetchAlpacaDailyBars(symbol, from, to).catch(() => []);
  return bars.map((b) => ({ t: new Date(b.date).getTime(), c: b.close, o: b.open }));
}

function dailyBarOnEtDate(bars: DailyBar[], etDate: string): DailyBar | null {
  for (const b of bars) {
    if (getEtDate(new Date(b.t)) === etDate) return b;
  }
  return null;
}

function resolveProxySymbols(row: {
  signalType: string;
  subjectKind: string;
  subject: string;
  outcomeProxySymbol?: string | null;
}): string[] {
  if (row.outcomeProxySymbol) return [row.outcomeProxySymbol];
  if (row.signalType === "broad_weakness" || row.signalType === "broad_strength") {
    return BROAD_MARKET_PROXIES;
  }
  if (row.subjectKind === "market" || MARKET_LEVEL_SIGNAL_TYPES.has(row.signalType)) {
    return MARKET_STRENGTH_PROXIES;
  }
  if (row.subjectKind === "theme") {
    const cluster = getClusterById(row.subject as ClusterId);
    const directProxy = cluster?.etfProxies.find((p) => p.proxyType === "direct");
    return [directProxy?.symbol ?? cluster?.etfProxies[0]?.symbol ?? "SPY"];
  }
  return [row.subject];
}

function pickFixedProxy(
  candidates: string[],
  frame: NonNullable<ReturnType<typeof currentFrame>>
): string {
  if (candidates.length <= 1) return candidates[0]!;
  if (candidates.includes("SPY") && frame.tickers.get("SPY")?.price) return "SPY";
  for (const sym of candidates) {
    if (frame.tickers.get(sym)?.price) return sym;
  }
  return candidates[0]!;
}

async function processOutcomes(): Promise<void> {
  if (!db) { console.warn("[Outcome Tracker] No DB, skipping"); return; }
  cycleCount++;

  if (!isMarketActive()) {
    if (cycleCount % 15 === 0) {
      console.log(`[Outcome Tracker] Market closed — skipping (cycle ${cycleCount})`);
    }
    return;
  }

  try {
    const { shouldRunHeavyBackgroundWork } = await import("../infra/memory-gate");
    if (!shouldRunHeavyBackgroundWork()) {
      if (cycleCount % 5 === 0) {
        console.warn(`[Outcome Tracker] Night mode or memory pressure — skipping (cycle ${cycleCount})`);
      }
      return;
    }
  } catch {
    // continue
  }

  console.log(`[Outcome Tracker] Cycle ${cycleCount} starting (V3)...`);

  try {
    await db
      .update(scannerDiscoveries)
      .set({ outcomeTrackedAt: new Date(), intradayCompleteAt: new Date() })
      .where(
        and(
          isNull(scannerDiscoveries.outcomeTrackedAt),
          inArray(scannerDiscoveries.signalType, [...SKIP_SIGNAL_TYPES])
        )
      )
      .catch(() => {});

    const PER_TYPE_LIMIT = 40;
    const nowForSelect = new Date();
    const overdueAgeCutoff = new Date(nowForSelect.getTime() - 20 * 60_000);

    const eligibleWhere = and(
      or(
        isNull(scannerDiscoveries.outcomeTrackedAt),
        isNull(scannerDiscoveries.intradayCompleteAt)
      ),
      inArray(scannerDiscoveries.subjectKind, ["ticker", "theme", "market"]),
      notInArray(scannerDiscoveries.signalType, [...SKIP_SIGNAL_TYPES])
    );

    const newestPending = await db
      .select()
      .from(scannerDiscoveries)
      .where(eligibleWhere)
      .orderBy(sql`id DESC`)
      .limit(2000);

    const OVERDUE_SIGNAL_TYPES = [
      "lod_bounce", "hod_fade", "gap", "ma_proximity", "failed_breakout",
      "volume_spike", "velocity_move", "ur_ma_reclaim", "prev_day_high_break",
      "prev_day_low_break", "five_day_high_break", "five_day_low_break",
      "earnings_reaction", "gap_down_continuation", "ipo_debut",
      "theme_acceleration", "breadth_shift", "adr_blowout", "regime_change",
      "rai_shift", "broad_strength", "broad_weakness", "theme_earnings_density",
    ];
    const PER_TYPE_PARTIAL = 40;
    const PER_TYPE_OLDEST = 20;
    const missingLaterSql = sql`(
      price_30m IS NULL OR price_1hr IS NULL OR price_4hr IS NULL OR
      price_d1_close IS NULL OR price_d2_open IS NULL OR
      price_d2_close IS NULL OR price_1w IS NULL OR price_1mo IS NULL
    )`;

    const partialOverdue: typeof newestPending = [];
    const oldestOverdue: typeof newestPending = [];
    for (const signalType of OVERDUE_SIGNAL_TYPES) {
      const partialRows = await db
        .select()
        .from(scannerDiscoveries)
        .where(
          and(
            eligibleWhere,
            eq(scannerDiscoveries.signalType, signalType),
            lt(scannerDiscoveries.createdAt, overdueAgeCutoff),
            sql`price_15m IS NOT NULL`,
            missingLaterSql
          )
        )
        .orderBy(sql`id ASC`)
        .limit(PER_TYPE_PARTIAL);
      partialOverdue.push(...partialRows);

      const oldestRows = await db
        .select()
        .from(scannerDiscoveries)
        .where(
          and(
            eligibleWhere,
            eq(scannerDiscoveries.signalType, signalType),
            lt(scannerDiscoveries.createdAt, overdueAgeCutoff),
            sql`(
              price_15m IS NULL OR price_30m IS NULL OR price_1hr IS NULL OR
              price_4hr IS NULL OR price_d1_close IS NULL OR price_d2_open IS NULL OR
              price_d2_close IS NULL OR price_1w IS NULL OR price_1mo IS NULL
            )`
          )
        )
        .orderBy(sql`id ASC`)
        .limit(PER_TYPE_OLDEST);
      oldestOverdue.push(...oldestRows);
    }

    const overduePending = [...partialOverdue];
    const partialIds = new Set(partialOverdue.map((r) => r.id));
    for (const r of oldestOverdue) {
      if (!partialIds.has(r.id)) overduePending.push(r);
    }

    const mergedById = new Map<number, (typeof newestPending)[number]>();
    for (const r of overduePending) mergedById.set(r.id, r);
    for (const r of newestPending) {
      if (!mergedById.has(r.id)) mergedById.set(r.id, r);
    }
    const allPending = Array.from(mergedById.values());

    const byType = new Map<string, typeof allPending>();
    for (const row of allPending) {
      const list = byType.get(row.signalType) ?? [];
      list.push(row);
      byType.set(row.signalType, list);
    }

    const pending: typeof allPending = [];
    for (const [, rows] of byType) {
      const due = rows.filter((r) => rowNeedsDueCheckpoint(r, nowForSelect));
      due.sort((a, b) => a.id - b.id);
      const neverProcessed = rows.filter(
        (r) => !due.includes(r) && r.peakMove == null && r.worstDrawdown == null
      );
      const alreadyStarted = rows.filter(
        (r) => !due.includes(r) && (r.peakMove != null || r.worstDrawdown != null)
      );
      let remaining = PER_TYPE_LIMIT;
      for (const bucket of [due, neverProcessed, alreadyStarted]) {
        if (remaining <= 0) break;
        const take = bucket.slice(0, remaining);
        pending.push(...take);
        remaining -= take.length;
      }
    }

    console.log(
      `[Outcome Tracker] Fetched ${pending.length} across ${byType.size} types ` +
        `(${PER_TYPE_LIMIT}/type; partialOverdue=${partialOverdue.length}, ` +
        `oldestOverdue=${oldestOverdue.length}, newest=${newestPending.length})`
    );
    if (pending.length === 0) return;

    const frame = currentFrame();
    if (!frame) {
      if (cycleCount % 10 === 1) console.warn("[Outcome Tracker] No snapshot frame yet, skipping");
      return;
    }

    const now = new Date();
    const nowMs = now.getTime();
    let updatedCount = 0;
    const intradayCache = new Map<string, OutcomeBar[]>();
    const dailyCache = new Map<string, DailyBar[]>();

    const ensureIntraday = async (symbol: string, signalAt: Date): Promise<OutcomeBar[]> => {
      const key = `${symbol}:${getEtDate(signalAt)}`;
      const hit = intradayCache.get(key);
      if (hit) return hit;
      const from = new Date(signalAt.getTime() - 15 * 60_000);
      const to = new Date(Math.min(nowMs, signalAt.getTime() + 8 * 60 * 60_000));
      const bars = await loadIntradayBars(symbol, from, to);
      intradayCache.set(key, bars);
      return bars;
    };

    const ensureDaily = async (symbol: string, signalAt: Date): Promise<DailyBar[]> => {
      const hit = dailyCache.get(symbol);
      if (hit) return hit;
      const from = new Date(signalAt.getTime() - 2 * 24 * 60_000);
      const to = new Date(nowMs + 24 * 60_000);
      const bars = await loadDailyCloses(symbol, from, to);
      dailyCache.set(symbol, bars);
      return bars;
    };

    for (const row of pending) {
      const elapsedMs = nowMs - row.createdAt.getTime();
      const neverProcessed = row.peakMove == null && row.worstDrawdown == null;
      const needsDue = rowNeedsDueCheckpoint(row, now);
      if (!neverProcessed && !needsDue && !shouldProcessRow(elapsedMs, now)) continue;

      const candidates = resolveProxySymbols(row);
      const lookupSymbol = pickFixedProxy(candidates, frame);

      const tickerData = frame.tickers.get(lookupSymbol);
      let currentPrice = tickerData?.price ?? null;
      if (currentPrice == null || currentPrice <= 0) {
        if (needsDue && row.subjectKind === "ticker") {
          const q = await fetchAlpacaQuote(lookupSymbol).catch(() => null);
          currentPrice = q?.lastPrice ?? null;
        }
        if ((currentPrice == null || currentPrice <= 0) && row.subjectKind === "ticker" && !needsDue) {
          continue;
        }
      }

      let signalPrice = row.priceAtSignal != null ? Number(row.priceAtSignal) : 0;
      const updates: Record<string, unknown> = {};

      if (!row.outcomeProxySymbol) {
        updates.outcomeProxySymbol = lookupSymbol;
      }

      if (signalPrice <= 0 && (row.subjectKind === "theme" || row.subjectKind === "market") && currentPrice != null) {
        updates.priceAtSignal = currentPrice;
        signalPrice = currentPrice;
      }
      if (signalPrice <= 0) {
        const bars0 = await ensureIntraday(lookupSymbol, row.createdAt);
        const first = bars0.find((b) => b.t >= row.createdAt.getTime()) ?? bars0[0];
        if (first) {
          updates.priceAtSignal = first.c;
          signalPrice = first.c;
        }
      }
      if (signalPrice <= 0) continue;

      const direction = row.direction as "up" | "down" | "neutral";
      const elapsedMin = elapsedMs / 60_000;
      const signalDate = row.createdAt;
      const bars = await ensureIntraday(lookupSymbol, signalDate);

      const excursionHorizon = Math.min(240, Math.max(15, elapsedMin));
      const excursion = computeHorizonExcursion(
        bars,
        signalDate.getTime(),
        signalPrice,
        direction,
        excursionHorizon,
        currentPrice
      );
      if (excursion) {
        const existingPeak = row.peakMove != null ? Number(row.peakMove) : 0;
        const existingDd = row.worstDrawdown != null ? Number(row.worstDrawdown) : 0;
        // Do not shrink legacy V2 peaks; only extend or write on fresh/V3 rows.
        if (row.outcomeContractVersion !== "v2" || neverProcessed) {
          if (excursion.mfe >= existingPeak) {
            updates.peakMove = excursion.mfe;
            if (excursion.peakPrice != null) updates.peakPrice = excursion.peakPrice;
            if (excursion.peakAtMs != null) updates.peakAt = new Date(excursion.peakAtMs);
          }
          if (excursion.mae <= existingDd) {
            updates.worstDrawdown = excursion.mae;
            if (excursion.troughPrice != null) updates.troughPrice = excursion.troughPrice;
            if (excursion.troughAtMs != null) updates.troughAt = new Date(excursion.troughAtMs);
          }
          updates.givebackPct = excursion.givebackPct;
        }
      }

      const fillIntraday = (offsetMin: number): number | null => {
        const resolved = resolveExactCheckpointClose(
          bars,
          signalDate.getTime() + offsetMin * 60_000,
          25 * 60_000
        );
        return resolved?.price ?? null;
      };

      if (row.price15m == null && elapsedMin >= 15) {
        const px = fillIntraday(15);
        if (px != null) {
          updates.price15m = px;
          updates.move15m = moveFrom(px, signalPrice);
        }
      }
      if (row.price30m == null && elapsedMin >= 30) {
        const px = fillIntraday(30);
        if (px != null) {
          updates.price30m = px;
          updates.move30m = moveFrom(px, signalPrice);
        }
      }
      if (row.price1hr == null && elapsedMin >= 60) {
        const px = fillIntraday(60);
        if (px != null) {
          updates.price1hr = px;
          updates.move1hr = moveFrom(px, signalPrice);
        }
      }
      if (row.price4hr == null && elapsedMin >= 240) {
        const px = fillIntraday(240);
        if (px != null) {
          updates.price4hr = px;
          updates.move4hr = moveFrom(px, signalPrice);
        }
      }

      if (row.priceD1Close == null) {
        const signalEtDate = getEtDate(signalDate);
        const nowEtDate = getEtDate(now);
        const pastD1Close =
          (signalEtDate === nowEtDate && isAfterEtTime(now, 16, 15)) ||
          signalEtDate < nowEtDate;
        if (pastD1Close) {
          const daily = await ensureDaily(lookupSymbol, signalDate);
          const px = dailyBarOnEtDate(daily, signalEtDate)?.c ?? null;
          if (px != null) {
            updates.priceD1Close = px;
            updates.moveD1Close = moveFrom(px, signalPrice);
          }
        }
      }

      if (row.priceD2Open == null) {
        const d2EtDate = getEtDate(addTradingDays(signalDate, 1));
        const nowEtDate = getEtDate(now);
        if ((nowEtDate === d2EtDate && isAfterEtTime(now, 9, 35)) || nowEtDate > d2EtDate) {
          const daily = await ensureDaily(lookupSymbol, signalDate);
          const px = dailyBarOnEtDate(daily, d2EtDate)?.o ?? null;
          if (px != null) {
            updates.priceD2Open = px;
            updates.moveD2Open = moveFrom(px, signalPrice);
          }
        }
      }

      if (row.priceD2Close == null) {
        const d2EtDate = getEtDate(addTradingDays(signalDate, 1));
        const nowEtDate = getEtDate(now);
        if ((nowEtDate === d2EtDate && isAfterEtTime(now, 16, 15)) || nowEtDate > d2EtDate) {
          const daily = await ensureDaily(lookupSymbol, signalDate);
          const px = dailyBarOnEtDate(daily, d2EtDate)?.c ?? null;
          if (px != null) {
            updates.priceD2Close = px;
            updates.moveD2Close = moveFrom(px, signalPrice);
          }
        }
      }

      if (row.price1w == null) {
        const d5EtDate = getEtDate(addTradingDays(signalDate, 5));
        const nowEtDate = getEtDate(now);
        if ((nowEtDate === d5EtDate && isAfterEtTime(now, 16, 15)) || nowEtDate > d5EtDate) {
          const daily = await ensureDaily(lookupSymbol, signalDate);
          const px = dailyBarOnEtDate(daily, d5EtDate)?.c ?? null;
          if (px != null) {
            updates.price1w = px;
            updates.move1w = moveFrom(px, signalPrice);
          }
        }
      }

      if (row.price1mo == null) {
        const d20EtDate = getEtDate(addTradingDays(signalDate, 20));
        const nowEtDate = getEtDate(now);
        if ((nowEtDate === d20EtDate && isAfterEtTime(now, 16, 15)) || nowEtDate > d20EtDate) {
          const daily = await ensureDaily(lookupSymbol, signalDate);
          const px = dailyBarOnEtDate(daily, d20EtDate)?.c ?? null;
          if (px != null) {
            updates.price1mo = px;
            updates.move1mo = moveFrom(px, signalPrice);
          }
        }
      }

      const statusMove =
        (updates.move1hr as number | undefined) ??
        row.move1hr ??
        (updates.move30m as number | undefined) ??
        row.move30m ??
        (updates.move15m as number | undefined) ??
        row.move15m ??
        (currentPrice != null && currentPrice > 0 ? moveFrom(currentPrice, signalPrice) : null);

      if (direction !== "neutral" && statusMove != null && Number.isFinite(statusMove)) {
        const favorableMove = direction === "up" ? Math.max(statusMove, 0) : Math.max(-statusMove, 0);
        const adverseMove = direction === "up" ? Math.max(-statusMove, 0) : Math.max(statusMove, 0);
        const peakMoveVal =
          updates.peakMove != null ? (updates.peakMove as number) : Number(row.peakMove ?? 0);
        const netInWrongDirection = direction === "up" ? statusMove < 0 : statusMove > 0;

        if (favorableMove < 1 && adverseMove > 5) {
          updates.outcomeStatus = "failed";
          updates.outcomeFailed = true;
          updates.failedAt = now;
        } else if (peakMoveVal >= 3 && netInWrongDirection) {
          updates.outcomeStatus = "reversed";
        } else if (favorableMove >= 1) {
          updates.outcomeStatus = "profitable";
        } else if (Math.abs(statusMove) < 1) {
          updates.outcomeStatus = "flat";
        } else {
          updates.outcomeStatus = "tracking";
        }
      }

      const has15m = row.price15m != null || updates.price15m != null;
      const has30m = row.price30m != null || updates.price30m != null;
      const has1hr = row.price1hr != null || updates.price1hr != null;
      const has4hr = row.price4hr != null || updates.price4hr != null;
      const hasD1Close = row.priceD1Close != null || updates.priceD1Close != null;
      const hasD2Open = row.priceD2Open != null || updates.priceD2Open != null;
      const hasD2Close = row.priceD2Close != null || updates.priceD2Close != null;
      const has1w = row.price1w != null || updates.price1w != null;
      const has1mo = row.price1mo != null || updates.price1mo != null;

      const projected = {
        ...row,
        price15m: has15m ? (row.price15m ?? 1) : null,
        price30m: has30m ? (row.price30m ?? 1) : null,
        price1hr: has1hr ? (row.price1hr ?? 1) : null,
        price4hr: has4hr ? (row.price4hr ?? 1) : null,
        priceD1Close: hasD1Close ? (row.priceD1Close ?? 1) : null,
        priceD2Open: hasD2Open ? (row.priceD2Open ?? 1) : null,
        priceD2Close: hasD2Close ? (row.priceD2Close ?? 1) : null,
        price1w: has1w ? (row.price1w ?? 1) : null,
        price1mo: has1mo ? (row.price1mo ?? 1) : null,
      };

      if (has15m && has30m && has1hr && row.intradayCompleteAt == null) {
        const d1Due =
          getEtDate(signalDate) < getEtDate(now) ||
          (getEtDate(signalDate) === getEtDate(now) && isAfterEtTime(now, 16, 15));
        if (!d1Due || hasD1Close) {
          updates.intradayCompleteAt = now;
        }
      }

      const stillDue = rowNeedsDueCheckpoint(projected, now);
      if (!stillDue && has15m && has30m && has1hr && has4hr && hasD1Close && hasD2Open && hasD2Close && has1w && has1mo) {
        updates.outcomeTrackedAt = now;
        if (row.intradayCompleteAt == null && updates.intradayCompleteAt == null) {
          updates.intradayCompleteAt = now;
        }
      }

      const wroteCheckpoint =
        updates.price15m != null ||
        updates.price30m != null ||
        updates.price1hr != null ||
        updates.price4hr != null ||
        updates.priceD1Close != null ||
        updates.peakMove != null;

      if (wroteCheckpoint && row.outcomeContractVersion !== "v2") {
        updates.outcomeContractVersion = OUTCOME_CONTRACT_V3;
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(scannerDiscoveries)
          .set(updates)
          .where(eq(scannerDiscoveries.id, row.id));
        updatedCount++;
      }
    }

    console.log(`[Outcome Tracker] Updated ${updatedCount}/${pending.length} discoveries (cycle ${cycleCount}, V3)`);
  } catch (err) {
    console.warn("[Outcome Tracker] Error:", String(err).slice(0, 200));
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startOutcomeTracker(): void {
  if (intervalId) return;
  intervalId = setInterval(processOutcomes, INTERVAL_MS);
  setTimeout(processOutcomes, 30_000);
  console.log("[Outcome Tracker] Started V3 (every 3 min, exact bars + bar MFE/MAE)");
}

export function stopOutcomeTracker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
