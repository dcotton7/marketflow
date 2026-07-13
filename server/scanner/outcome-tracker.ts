// ---------------------------------------------------------------------------
// Outcome Tracker V2 — 9 checkpoints + MFE/MAE behavior tracking
//
// Runs every 5 minutes, processes eligible ticker discoveries with tiered
// check frequency based on signal age. Tracks peak move (MFE), worst
// drawdown (MAE), giveback, and fills 9 time-based price checkpoints.
// ---------------------------------------------------------------------------

import { db } from "../db";
import { scannerDiscoveries } from "@shared/schema";
import { eq, and, isNull, sql, inArray, notInArray, gte, lt } from "drizzle-orm";
import { currentFrame } from "./signal-producer";
import { getClusterById, type ClusterId } from "../market-condition/universe";

const INTERVAL_MS = 3 * 60_000; // 3 min
const BATCH_SIZE = 150;

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
    const PER_TYPE_LIMIT = 25;

    const allPending = await db
      .select()
      .from(scannerDiscoveries)
      .where(
        and(
          isNull(scannerDiscoveries.outcomeTrackedAt),
          inArray(scannerDiscoveries.subjectKind, ["ticker", "theme", "market"]),
          notInArray(scannerDiscoveries.signalType, [...SKIP_SIGNAL_TYPES])
        )
      )
      .orderBy(sql`id DESC`)
      .limit(1000);

    // Group by signal type, take PER_TYPE_LIMIT from each, prioritizing never-processed
    const byType = new Map<string, typeof allPending>();
    for (const row of allPending) {
      const list = byType.get(row.signalType) ?? [];
      list.push(row);
      byType.set(row.signalType, list);
    }

    const pending: typeof allPending = [];
    for (const [, rows] of byType) {
      // Never-processed first, then already-have-peak
      const neverProcessed = rows.filter(r => r.peakMove == null && r.worstDrawdown == null);
      const alreadyStarted = rows.filter(r => r.peakMove != null || r.worstDrawdown != null);
      const selected = [...neverProcessed.slice(0, PER_TYPE_LIMIT), ...alreadyStarted.slice(0, Math.max(0, PER_TYPE_LIMIT - neverProcessed.length))].slice(0, PER_TYPE_LIMIT);
      pending.push(...selected);
    }

    console.log(`[Outcome Tracker] Fetched ${pending.length} across ${byType.size} signal types (${PER_TYPE_LIMIT}/type max)`);
    if (pending.length === 0) return;

    const frame = currentFrame();
    if (!frame) { if (cycleCount % 10 === 1) console.warn("[Outcome Tracker] No snapshot frame yet, skipping"); return; }

    const now = new Date();
    const nowMs = now.getTime();
    let updatedCount = 0;

    for (const row of pending) {
      if (row.outcomeFailed) continue;

      const elapsedMs = nowMs - row.createdAt.getTime();
      // Always process rows that have never been tracked (no peak data yet)
      const neverProcessed = row.peakMove == null && row.worstDrawdown == null;
      if (!neverProcessed && !shouldProcessRow(elapsedMs, now)) continue;

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
      if (!tickerData) {
        // For theme/market subjects where no proxy ticker is in frame, mark tracked
        // immediately so they don't clog the queue forever
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
        }
        continue;
      }

      const currentPrice = tickerData.price;

      // Backfill priceAtSignal for theme/market signals that lack one
      let signalPrice = row.priceAtSignal != null ? Number(row.priceAtSignal) : 0;
      if (signalPrice <= 0 && (row.subjectKind === "theme" || row.subjectKind === "market")) {
        // Set current ETF price as baseline on first encounter
        await db
          .update(scannerDiscoveries)
          .set({ priceAtSignal: currentPrice })
          .where(eq(scannerDiscoveries.id, row.id));
        signalPrice = currentPrice;
      }
      if (signalPrice <= 0) continue;

      const currentMove = ((currentPrice - signalPrice) / signalPrice) * 100;
      const direction = row.direction as "up" | "down" | "neutral";

      const updates: Record<string, unknown> = {};

      // ── MFE/MAE tracking ─────────────────────────────────────────────
      const existingPeak = row.peakMove != null ? Number(row.peakMove) : 0;
      const existingDrawdown = row.worstDrawdown != null ? Number(row.worstDrawdown) : 0;

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

      // ── Checkpoint filling ───────────────────────────────────────────
      const elapsedMin = elapsedMs / 60_000;
      const signalDate = row.createdAt;

      if (row.price15m == null && elapsedMin >= 15) {
        updates.price15m = currentPrice;
        updates.move15m = currentMove;
      }
      if (row.price30m == null && elapsedMin >= 30) {
        updates.price30m = currentPrice;
        updates.move30m = currentMove;
      }
      if (row.price1hr == null && elapsedMin >= 60) {
        updates.price1hr = currentPrice;
        updates.move1hr = currentMove;
      }
      if (row.price4hr == null && elapsedMin >= 240) {
        updates.price4hr = currentPrice;
        updates.move4hr = currentMove;
      }

      // D1 Close: after 4:15 PM ET on signal's calendar day
      if (row.priceD1Close == null) {
        const signalEtDate = getEtDate(signalDate);
        const nowEtDate = getEtDate(now);
        const pastD1Close =
          (signalEtDate === nowEtDate && isAfterEtTime(now, 16, 15)) ||
          signalEtDate < nowEtDate;
        if (pastD1Close) {
          updates.priceD1Close = currentPrice;
          updates.moveD1Close = currentMove;
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
          updates.priceD2Open = currentPrice;
          updates.moveD2Open = currentMove;
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
          updates.priceD2Close = currentPrice;
          updates.moveD2Close = currentMove;
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
          updates.price1w = currentPrice;
          updates.move1w = currentMove;
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
          updates.price1mo = currentPrice;
          updates.move1mo = currentMove;
        }
      }

      // ── Outcome status evaluation ───────────────────────────────────
      if (direction !== "neutral") {
        const favorableMove = direction === "up" ? Math.max(currentMove, 0) : Math.max(-currentMove, 0);
        const adverseMove = direction === "up" ? Math.max(-currentMove, 0) : Math.max(currentMove, 0);
        const peakMoveVal = updates.peakMove != null ? (updates.peakMove as number) : existingPeak;
        const netInWrongDirection = direction === "up" ? currentMove < 0 : currentMove > 0;

        if (favorableMove < 1 && adverseMove > 5) {
          updates.outcomeStatus = "failed";
          updates.outcomeFailed = true;
          updates.failedAt = now;
        } else if (peakMoveVal >= 3 && netInWrongDirection) {
          updates.outcomeStatus = "reversed";
        } else if (favorableMove >= 1) {
          updates.outcomeStatus = "profitable";
        } else if (Math.abs(currentMove) < 1) {
          updates.outcomeStatus = "flat";
        } else {
          updates.outcomeStatus = "tracking";
        }
      }

      // ── Completion check ─────────────────────────────────────────────
      const has15m = row.price15m != null || updates.price15m != null;
      const has30m = row.price30m != null || updates.price30m != null;
      const has1hr = row.price1hr != null || updates.price1hr != null;
      const has4hr = row.price4hr != null || updates.price4hr != null;
      const hasD1Close = row.priceD1Close != null || updates.priceD1Close != null;
      const hasD2Open = row.priceD2Open != null || updates.priceD2Open != null;
      const hasD2Close = row.priceD2Close != null || updates.priceD2Close != null;
      const has1w = row.price1w != null || updates.price1w != null;
      const has1mo = row.price1mo != null || updates.price1mo != null;

      // Mark as tracked once the intraday checkpoints are filled (15m-4hr + D1 close)
      // so the row leaves the hot processing queue. Weekly/monthly get filled via
      // a slower pass that queries rows WITH outcomeTrackedAt but missing 1w/1mo.
      const intradayDone = has15m && has30m && has1hr && has4hr && hasD1Close;
      const allCheckpointsFilled = intradayDone && hasD2Open && hasD2Close && has1w && has1mo;
      const isFailed = updates.outcomeFailed === true || row.outcomeFailed;

      if (intradayDone || allCheckpointsFilled || isFailed) {
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
