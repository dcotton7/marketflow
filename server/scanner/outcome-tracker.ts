// ---------------------------------------------------------------------------
// Outcome Tracker V2 — 9 checkpoints + MFE/MAE behavior tracking
//
// Runs every 5 minutes, processes eligible ticker discoveries with tiered
// check frequency based on signal age. Tracks peak move (MFE), worst
// drawdown (MAE), giveback, and fills 9 time-based price checkpoints.
// ---------------------------------------------------------------------------

import { db } from "../db";
import { scannerDiscoveries } from "@shared/schema";
import { eq, and, isNull, sql, inArray, notInArray, lt } from "drizzle-orm";
import { currentFrame } from "./signal-producer";
import { getClusterById, type ClusterId } from "../market-condition/universe";
import { fetchAlpacaDailyBars, fetchAlpacaIntradayBars, fetchAlpacaQuote } from "../alpaca";

const INTERVAL_MS = 3 * 60_000; // 3 min

/** If a checkpoint was due this many minutes ago, fill from historical bars (not live print). */
const LATE_INTRADAY_GRACE_MIN = 90;

const SKIP_SIGNAL_TYPES = new Set(["news_alert"]);

const MARKET_LEVEL_SIGNAL_TYPES = new Set([
  "regime_change", "rai_shift", "broad_weakness", "broad_strength",
]);

// Market-level proxy mapping: broad signals track SPY+QQQ+IWM,
// strength/weakness signals track the best-performing of QQQ or SPY
const BROAD_MARKET_PROXIES = ["SPY", "QQQ", "IWM"];
const MARKET_STRENGTH_PROXIES = ["QQQ", "SPY"];

// ── Time helpers ─────────────────────────────────────────────────────────────

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
  const dateStr = `${year}-${month}-${day}`;

  return { h, m, dayOfWeek, dateStr };
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

// ── Tiered frequency check ───────────────────────────────────────────────────

let cycleCount = 0;

function shouldProcessRow(elapsedMs: number, now: Date): boolean {
  const elapsedHrs = elapsedMs / (60 * 60_000);
  const { h, m } = getEtParts(now);
  const etMins = h * 60 + m;

  if (elapsedHrs <= 4) {
    return true; // Every 5 min
  }

  const elapsedDays = elapsedHrs / 24;

  if (elapsedDays <= 1) {
    return cycleCount % 3 === 0; // Every 15 min
  }

  if (elapsedDays <= 7) {
    // Twice daily: ~9:35 AM and ~4:15 PM ET
    const isNearOpen = etMins >= 575 && etMins <= 580; // 9:35
    const isNearClose = etMins >= 975 && etMins <= 980; // 4:15
    return isNearOpen || isNearClose;
  }

  // 1 week to 1 month: once daily at ~4:15 PM ET
  const isCloseTime = etMins >= 975 && etMins <= 980;
  return isCloseTime;
}

// ── Main processing ──────────────────────────────────────────────────────────

function isMarketActive(): boolean {
  const { h, m, dayOfWeek } = getEtParts(new Date());
  if (dayOfWeek === 0 || dayOfWeek === 6) return false; // Weekend
  const etMins = h * 60 + m;
  // Active from 4:00 AM (pre-market) to 8:00 PM (after-hours) ET
  return etMins >= 240 && etMins < 1200;
}

// ── Checkpoint due helpers ───────────────────────────────────────────────────

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

// ── Historical price helpers (point-in-time backfill for starved rows) ────────

type BarClose = { t: number; c: number };
type DailyBar = BarClose & { o?: number };

function moveFrom(price: number, signalPrice: number): number {
  return ((price - signalPrice) / signalPrice) * 100;
}

function closestBarClose(bars: BarClose[], targetMs: number, maxSkewMs: number): number | null {
  let best: BarClose | null = null;
  let bestDiff = Infinity;
  for (const b of bars) {
    const d = Math.abs(b.t - targetMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = b;
    }
  }
  if (!best || bestDiff > maxSkewMs) return null;
  return best.c;
}

async function loadIntradayCloses(symbol: string, from: Date, to: Date): Promise<BarClose[]> {
  const bars = await fetchAlpacaIntradayBars(symbol, from, to, "5Min", true).catch(() => []);
  return bars.map((b) => ({ t: new Date(b.date).getTime(), c: b.close }));
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

async function processOutcomes(): Promise<void> {
  if (!db) { console.warn("[Outcome Tracker] No DB, skipping"); return; }
  cycleCount++;

  if (!isMarketActive()) {
    if (cycleCount % 15 === 0) {
      console.log(`[Outcome Tracker] Market closed — skipping (cycle ${cycleCount})`);
    }
    return;
  }

  console.log(`[Outcome Tracker] Cycle ${cycleCount} starting...`);

  try {
    // Mark skipped signal types as tracked so they don't permanently clog the batch
    await db
      .update(scannerDiscoveries)
      .set({ outcomeTrackedAt: new Date() })
      .where(
        and(
          isNull(scannerDiscoveries.outcomeTrackedAt),
          inArray(scannerDiscoveries.signalType, [...SKIP_SIGNAL_TYPES])
        )
      )
      .catch(() => {});

    // Round-robin fetch: get up to PER_TYPE_LIMIT from each signal type
    // so no single type (e.g., ma_proximity with 6000+) starves others
    const PER_TYPE_LIMIT = 40;
    const OVERDUE_BACKLOG = 500;
    const nowForSelect = new Date();
    const overdueAgeCutoff = new Date(nowForSelect.getTime() - 20 * 60_000);

    const eligibleWhere = and(
      isNull(scannerDiscoveries.outcomeTrackedAt),
      inArray(scannerDiscoveries.subjectKind, ["ticker", "theme", "market"]),
      notInArray(scannerDiscoveries.signalType, [...SKIP_SIGNAL_TYPES])
    );

    // Newest hot queue (live tracking)
    const newestPending = await db
      .select()
      .from(scannerDiscoveries)
      .where(eligibleWhere)
      .orderBy(sql`id DESC`)
      .limit(2000);

    // Oldest overdue backlog — Jul 13 LITE-style rows fall off the newest-2k window
    // when ma_proximity / gap / hod_fade floods untracked ids.
    const overduePending = await db
      .select()
      .from(scannerDiscoveries)
      .where(
        and(
          eligibleWhere,
          lt(scannerDiscoveries.createdAt, overdueAgeCutoff),
          sql`(
            price_15m IS NULL OR price_30m IS NULL OR price_1hr IS NULL OR
            price_4hr IS NULL OR price_d1_close IS NULL OR price_d2_open IS NULL OR
            price_d2_close IS NULL OR price_1w IS NULL OR price_1mo IS NULL
          )`
        )
      )
      .orderBy(sql`id ASC`)
      .limit(OVERDUE_BACKLOG);

    const mergedById = new Map<number, (typeof newestPending)[number]>();
    for (const r of overduePending) mergedById.set(r.id, r);
    for (const r of newestPending) {
      if (!mergedById.has(r.id)) mergedById.set(r.id, r);
    }
    const allPending = Array.from(mergedById.values());

    // Group by signal type; prioritize rows with OVERDUE checkpoints so mid-session
    // partial rows (e.g. status set before 15m) are not starved by a flood of new fires.
    const byType = new Map<string, typeof allPending>();
    for (const row of allPending) {
      const list = byType.get(row.signalType) ?? [];
      list.push(row);
      byType.set(row.signalType, list);
    }

    const pending: typeof allPending = [];
    for (const [, rows] of byType) {
      const due = rows.filter((r) => rowNeedsDueCheckpoint(r, nowForSelect));
      // Within due bucket, oldest first so backlog heals before brand-new dues
      due.sort((a, b) => a.id - b.id);
      const neverProcessed = rows.filter(
        (r) => !due.includes(r) && r.peakMove == null && r.worstDrawdown == null
      );
      const alreadyStarted = rows.filter(
        (r) => !due.includes(r) && (r.peakMove != null || r.worstDrawdown != null)
      );
      let remaining = PER_TYPE_LIMIT;
      const selected: typeof allPending = [];
      for (const bucket of [due, neverProcessed, alreadyStarted]) {
        if (remaining <= 0) break;
        const take = bucket.slice(0, remaining);
        selected.push(...take);
        remaining -= take.length;
      }
      pending.push(...selected);
    }

    console.log(
      `[Outcome Tracker] Fetched ${pending.length} across ${byType.size} types ` +
        `(${PER_TYPE_LIMIT}/type; overdueBacklog=${overduePending.length}, newest=${newestPending.length})`
    );
    if (pending.length === 0) return;

    const frame = currentFrame();
    if (!frame) { if (cycleCount % 10 === 1) console.warn("[Outcome Tracker] No snapshot frame yet, skipping"); return; }

    const now = new Date();
    const nowMs = now.getTime();
    let updatedCount = 0;
    const intradayCache = new Map<string, BarClose[]>();
    const dailyCache = new Map<string, DailyBar[]>();

    const ensureIntraday = async (symbol: string, signalAt: Date): Promise<BarClose[]> => {
      const key = `${symbol}:${getEtDate(signalAt)}`;
      const hit = intradayCache.get(key);
      if (hit) return hit;
      const from = new Date(signalAt.getTime() - 15 * 60_000);
      const to = new Date(Math.min(nowMs, signalAt.getTime() + 6 * 60 * 60_000));
      const bars = await loadIntradayCloses(symbol, from, to);
      intradayCache.set(key, bars);
      return bars;
    };

    const ensureDaily = async (symbol: string, signalAt: Date): Promise<DailyBar[]> => {
      const key = symbol;
      const hit = dailyCache.get(key);
      if (hit) return hit;
      const from = new Date(signalAt.getTime() - 2 * 24 * 60_000);
      const to = new Date(nowMs + 24 * 60_000);
      const bars = await loadDailyCloses(symbol, from, to);
      dailyCache.set(key, bars);
      return bars;
    };

    const resolveIntradayCheckpoint = async (
      symbol: string,
      signalAt: Date,
      offsetMin: number,
      elapsedMin: number,
      livePrice: number | null
    ): Promise<number | null> => {
      const late = elapsedMin > offsetMin + LATE_INTRADAY_GRACE_MIN;
      if (!late && livePrice != null && livePrice > 0) return livePrice;
      const bars = await ensureIntraday(symbol, signalAt);
      const targetMs = signalAt.getTime() + offsetMin * 60_000;
      const hist = closestBarClose(bars, targetMs, 25 * 60_000);
      if (hist != null) return hist;
      return livePrice != null && livePrice > 0 ? livePrice : null;
    };

    for (const row of pending) {
      // Still fill time checkpoints for failed setups — Lab hit-rates need the clocks
      const elapsedMs = nowMs - row.createdAt.getTime();
      const neverProcessed = row.peakMove == null && row.worstDrawdown == null;
      const needsDue = rowNeedsDueCheckpoint(row, now);
      if (!neverProcessed && !needsDue && !shouldProcessRow(elapsedMs, now)) continue;

      // Determine the price lookup symbol(s) based on subjectKind
      let lookupSymbols: string[];
      if (row.signalType === "broad_weakness" || row.signalType === "broad_strength") {
        // Broad market: track SPY, QQQ, IWM — use the one moving most in signal direction
        lookupSymbols = BROAD_MARKET_PROXIES;
      } else if (row.subjectKind === "market" || MARKET_LEVEL_SIGNAL_TYPES.has(row.signalType)) {
        // Regime/RAI: QQQ or SPY — whichever is pushing harder
        lookupSymbols = MARKET_STRENGTH_PROXIES;
      } else if (row.subjectKind === "theme") {
        const cluster = getClusterById(row.subject as ClusterId);
        const directProxy = cluster?.etfProxies.find(p => p.proxyType === "direct");
        lookupSymbols = [directProxy?.symbol ?? cluster?.etfProxies[0]?.symbol ?? "SPY"];
      } else {
        lookupSymbols = [row.subject];
      }

      // For multi-proxy signals, pick the proxy with the largest move in signal direction
      let lookupSymbol = lookupSymbols[0]!;
      if (lookupSymbols.length > 1) {
        let bestMove = -Infinity;
        const isUp = row.direction === "up";
        for (const sym of lookupSymbols) {
          const td = frame.tickers.get(sym);
          if (!td) continue;
          const move = isUp ? (td.changePct ?? 0) : -(td.changePct ?? 0);
          if (move > bestMove) { bestMove = move; lookupSymbol = sym; }
        }
      }

      const tickerData = frame.tickers.get(lookupSymbol);
      let currentPrice = tickerData?.price ?? null;
      if (currentPrice == null || currentPrice <= 0) {
        // Overdue ticker rows may sit outside the current scanner frame — quote fallback
        if (needsDue && row.subjectKind === "ticker") {
          const q = await fetchAlpacaQuote(lookupSymbol).catch(() => null);
          currentPrice = q?.lastPrice ?? null;
        }
        if (currentPrice == null || currentPrice <= 0) {
          if (row.subjectKind === "theme" || row.subjectKind === "market") {
            await db
              .update(scannerDiscoveries)
              .set({
                outcomeTrackedAt: now,
                outcomeStatus: "flat",
                peakMove: 0,
                worstDrawdown: 0,
              })
              .where(eq(scannerDiscoveries.id, row.id));
            updatedCount++;
            continue;
          }
          // Ticker overdue with no frame/quote: still fill from historical bars below
          if (!needsDue) continue;
        }
      }

      // Backfill priceAtSignal for theme/market signals that lack one
      let signalPrice = row.priceAtSignal != null ? Number(row.priceAtSignal) : 0;
      if (signalPrice <= 0 && (row.subjectKind === "theme" || row.subjectKind === "market") && currentPrice != null) {
        // Set current ETF price as baseline on first encounter
        await db
          .update(scannerDiscoveries)
          .set({ priceAtSignal: currentPrice })
          .where(eq(scannerDiscoveries.id, row.id));
        signalPrice = currentPrice;
      }
      if (signalPrice <= 0) continue;

      const liveMove =
        currentPrice != null && currentPrice > 0
          ? moveFrom(currentPrice, signalPrice)
          : null;
      const direction = row.direction as "up" | "down" | "neutral";

      const updates: Record<string, unknown> = {};

      // ── MFE/MAE tracking (live print only) ───────────────────────────
      const existingPeak = row.peakMove != null ? Number(row.peakMove) : 0;
      const existingDrawdown = row.worstDrawdown != null ? Number(row.worstDrawdown) : 0;

      if (liveMove != null && currentPrice != null) {
        const currentMove = liveMove;
        if (direction === "up") {
          if (currentMove > existingPeak) {
            updates.peakMove = currentMove;
            updates.peakPrice = currentPrice;
            updates.peakAt = now;
          }
          if (currentMove < existingDrawdown) {
            updates.worstDrawdown = currentMove;
            updates.troughPrice = currentPrice;
            updates.troughAt = now;
          }
          const favorableMove = Math.max(currentMove, 0);
          const peakForGiveback = updates.peakMove != null ? (updates.peakMove as number) : existingPeak;
          updates.givebackPct = Math.max(0, peakForGiveback - favorableMove);
        } else if (direction === "down") {
          const favorableForShort = -currentMove; // positive when price drops
          if (favorableForShort > existingPeak) {
            updates.peakMove = favorableForShort;
            updates.peakPrice = currentPrice;
            updates.peakAt = now;
          }
          if (currentMove > 0 && currentMove > -existingDrawdown) {
            updates.worstDrawdown = -currentMove; // stored as negative
            updates.troughPrice = currentPrice;
            updates.troughAt = now;
          }
          const peakForGiveback = updates.peakMove != null ? (updates.peakMove as number) : existingPeak;
          updates.givebackPct = Math.max(0, peakForGiveback - Math.max(favorableForShort, 0));
        } else {
          // Neutral: track max absolute move
          const absMove = Math.abs(currentMove);
          if (absMove > existingPeak) {
            updates.peakMove = absMove;
            updates.peakPrice = currentPrice;
            updates.peakAt = now;
          }
          if (currentMove < existingDrawdown) {
            updates.worstDrawdown = currentMove;
            updates.troughPrice = currentPrice;
            updates.troughAt = now;
          }
        }
      }

      // ── Checkpoint filling ───────────────────────────────────────────
      const elapsedMin = elapsedMs / 60_000;
      const signalDate = row.createdAt;

      if (row.price15m == null && elapsedMin >= 15) {
        const px = await resolveIntradayCheckpoint(lookupSymbol, signalDate, 15, elapsedMin, currentPrice);
        if (px != null) {
          updates.price15m = px;
          updates.move15m = moveFrom(px, signalPrice);
        }
      }
      if (row.price30m == null && elapsedMin >= 30) {
        const px = await resolveIntradayCheckpoint(lookupSymbol, signalDate, 30, elapsedMin, currentPrice);
        if (px != null) {
          updates.price30m = px;
          updates.move30m = moveFrom(px, signalPrice);
        }
      }
      if (row.price1hr == null && elapsedMin >= 60) {
        const px = await resolveIntradayCheckpoint(lookupSymbol, signalDate, 60, elapsedMin, currentPrice);
        if (px != null) {
          updates.price1hr = px;
          updates.move1hr = moveFrom(px, signalPrice);
        }
      }
      if (row.price4hr == null && elapsedMin >= 240) {
        const px = await resolveIntradayCheckpoint(lookupSymbol, signalDate, 240, elapsedMin, currentPrice);
        if (px != null) {
          updates.price4hr = px;
          updates.move4hr = moveFrom(px, signalPrice);
        }
      }

      // D1 Close: after 4:15 PM ET on signal's calendar day
      if (row.priceD1Close == null) {
        const signalEtDate = getEtDate(signalDate);
        const nowEtDate = getEtDate(now);
        const pastD1Close =
          (signalEtDate === nowEtDate && isAfterEtTime(now, 16, 15)) ||
          signalEtDate < nowEtDate;
        if (pastD1Close) {
          let px: number | null = null;
          if (signalEtDate < nowEtDate) {
            const daily = await ensureDaily(lookupSymbol, signalDate);
            px = dailyBarOnEtDate(daily, signalEtDate)?.c ?? null;
          }
          if (px == null) px = currentPrice;
          if (px != null) {
            updates.priceD1Close = px;
            updates.moveD1Close = moveFrom(px, signalPrice);
          }
        }
      }

      // D2 Open: after 9:35 AM ET on next trading day
      if (row.priceD2Open == null) {
        const d2Date = addTradingDays(signalDate, 1);
        const d2EtDate = getEtDate(d2Date);
        const nowEtDate = getEtDate(now);
        const pastD2Open =
          (nowEtDate === d2EtDate && isAfterEtTime(now, 9, 35)) ||
          nowEtDate > d2EtDate;
        if (pastD2Open) {
          let px: number | null = null;
          if (nowEtDate > d2EtDate || (nowEtDate === d2EtDate && isAfterEtTime(now, 16, 0))) {
            const daily = await ensureDaily(lookupSymbol, signalDate);
            px = dailyBarOnEtDate(daily, d2EtDate)?.o ?? null;
          }
          if (px == null) px = currentPrice;
          if (px != null) {
            updates.priceD2Open = px;
            updates.moveD2Open = moveFrom(px, signalPrice);
          }
        }
      }

      // D2 Close: after 4:15 PM ET on next trading day
      if (row.priceD2Close == null) {
        const d2Date = addTradingDays(signalDate, 1);
        const d2EtDate = getEtDate(d2Date);
        const nowEtDate = getEtDate(now);
        const pastD2Close =
          (nowEtDate === d2EtDate && isAfterEtTime(now, 16, 15)) ||
          nowEtDate > d2EtDate;
        if (pastD2Close) {
          let px: number | null = null;
          if (nowEtDate > d2EtDate || (nowEtDate === d2EtDate && isAfterEtTime(now, 16, 15))) {
            const daily = await ensureDaily(lookupSymbol, signalDate);
            px = dailyBarOnEtDate(daily, d2EtDate)?.c ?? null;
          }
          if (px == null) px = currentPrice;
          if (px != null) {
            updates.priceD2Close = px;
            updates.moveD2Close = moveFrom(px, signalPrice);
          }
        }
      }

      // 1W: after 4:15 PM ET, 5 trading days after signal
      if (row.price1w == null) {
        const d5Date = addTradingDays(signalDate, 5);
        const d5EtDate = getEtDate(d5Date);
        const nowEtDate = getEtDate(now);
        const past1w =
          (nowEtDate === d5EtDate && isAfterEtTime(now, 16, 15)) ||
          nowEtDate > d5EtDate;
        if (past1w) {
          let px: number | null = null;
          if (nowEtDate > d5EtDate) {
            const daily = await ensureDaily(lookupSymbol, signalDate);
            px = dailyBarOnEtDate(daily, d5EtDate)?.c ?? null;
          }
          if (px == null) px = currentPrice;
          if (px != null) {
            updates.price1w = px;
            updates.move1w = moveFrom(px, signalPrice);
          }
        }
      }

      // 1Mo: after 4:15 PM ET, 20 trading days after signal
      if (row.price1mo == null) {
        const d20Date = addTradingDays(signalDate, 20);
        const d20EtDate = getEtDate(d20Date);
        const nowEtDate = getEtDate(now);
        const past1mo =
          (nowEtDate === d20EtDate && isAfterEtTime(now, 16, 15)) ||
          nowEtDate > d20EtDate;
        if (past1mo) {
          let px: number | null = null;
          if (nowEtDate > d20EtDate) {
            const daily = await ensureDaily(lookupSymbol, signalDate);
            px = dailyBarOnEtDate(daily, d20EtDate)?.c ?? null;
          }
          if (px == null) px = currentPrice;
          if (px != null) {
            updates.price1mo = px;
            updates.move1mo = moveFrom(px, signalPrice);
          }
        }
      }

      // ── Outcome status evaluation ───────────────────────────────────
      if (direction !== "neutral" && liveMove != null) {
        const favorableMove = direction === "up" ? Math.max(liveMove, 0) : Math.max(-liveMove, 0);
        const adverseMove = direction === "up" ? Math.max(-liveMove, 0) : Math.max(liveMove, 0);
        const peakMoveVal = updates.peakMove != null ? (updates.peakMove as number) : existingPeak;
        const netInWrongDirection = direction === "up" ? liveMove < 0 : liveMove > 0;

        if (favorableMove < 1 && adverseMove > 5) {
          updates.outcomeStatus = "failed";
          updates.outcomeFailed = true;
          updates.failedAt = now;
        } else if (peakMoveVal >= 3 && netInWrongDirection) {
          updates.outcomeStatus = "reversed";
        } else if (favorableMove >= 1) {
          updates.outcomeStatus = "profitable";
        } else if (Math.abs(liveMove) < 1) {
          updates.outcomeStatus = "flat";
        } else {
          updates.outcomeStatus = "tracking";
        }
      }

      // Mark as tracked only when every intraday clock that is DUE is filled.
      // Do NOT leave the queue on early fail — that stranded LITE-style cards at
      // "flat" with only a status and no 15m/30m/1hr snapshots for the Lab.
      const has15m = row.price15m != null || updates.price15m != null;
      const has30m = row.price30m != null || updates.price30m != null;
      const has1hr = row.price1hr != null || updates.price1hr != null;
      const has4hr = row.price4hr != null || updates.price4hr != null;
      const hasD1Close = row.priceD1Close != null || updates.priceD1Close != null;
      const hasD2Open = row.priceD2Open != null || updates.priceD2Open != null;
      const hasD2Close = row.priceD2Close != null || updates.priceD2Close != null;
      const has1w = row.price1w != null || updates.price1w != null;
      const has1mo = row.price1mo != null || updates.price1mo != null;

      const intradayDone = has15m && has30m && has1hr && has4hr && hasD1Close;
      const allCheckpointsFilled = intradayDone && hasD2Open && hasD2Close && has1w && has1mo;

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
      const stillDue = rowNeedsDueCheckpoint(projected, now);

      if ((intradayDone || allCheckpointsFilled) && !stillDue) {
        updates.outcomeTrackedAt = now;
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(scannerDiscoveries)
          .set(updates)
          .where(eq(scannerDiscoveries.id, row.id));
        updatedCount++;
      }
    }

    console.log(`[Outcome Tracker] Updated ${updatedCount}/${pending.length} discoveries (cycle ${cycleCount})`);
  } catch (err) {
    console.warn("[Outcome Tracker] Error:", String(err).slice(0, 200));
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startOutcomeTracker(): void {
  if (intervalId) return;
  intervalId = setInterval(processOutcomes, INTERVAL_MS);
  setTimeout(processOutcomes, 30_000);
  console.log("[Outcome Tracker] Started V2 (every 2 min, 60/type, 9 checkpoints + MFE/MAE)");
}

export function stopOutcomeTracker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
