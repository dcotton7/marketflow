import { and, eq } from "drizzle-orm";
import type {
  AlertDeliveryConfig,
  AlertIndicatorOperand,
  AlertReferenceOperand,
  AlertRuleCondition,
  AlertRuleGroup,
  AlertTargetScope,
  CreateAlertDefinitionInput,
} from "@shared/alerts";
import type { AlertSymbolState } from "@shared/schema";
import { alertDeliveries, alertEvents, alertSymbolStates, sentinelWatchlist, userAlerts } from "@shared/schema";
import { getDb } from "../db";
import { getDailyBars } from "../data-layer/daily-bars";
import { getIntradayBars } from "../data-layer/intraday-bars";
import { getMAs } from "../data-layer/moving-averages";
import { getQuote } from "../data-layer/quotes";
import type { DailyBar, IntradayBar, Quote } from "../data-layer/types";
import { sendMessage } from "../messages";
import { buildAlertSmsBody } from "../messages/templates/alert-sms";
import { fetchTwilioMessageStatus } from "../messages/providers/twilio";
import { getThemeMembersFromCache, getThemeMembersFromDB, isCacheInitialized } from "../market-condition/utils/theme-db-loader";
import { fetchAlpacaTradingCalendar } from "../alpaca";

type WatchlistReferenceMap = Record<string, { entry?: number | null; stop?: number | null; target?: number | null }>;

interface EvaluationContext {
  symbol: string;
  quote: Quote | null;
  watchlistRefs?: WatchlistReferenceMap[string];
}

interface SymbolEvaluationCaches {
  intraday: Record<string, IntradayBar[]>;
  daily: DailyBar[] | null | undefined;
  mas: Awaited<ReturnType<typeof getMAs>> | undefined;
}

interface SequenceStateRecord {
  id?: number;
  symbol: string;
  status: string;
  nextStageIndex: number;
  armedAt: Date | null;
  expiresAt: Date | null;
  lastMatchedAt: Date | null;
}

interface SequencePersistenceContext {
  userId: number;
  alertId: number;
  enabled: boolean;
  statesBySymbol: Record<string, SequenceStateRecord>;
}

const inMemorySequenceStates = new Map<string, SequenceStateRecord>();

function buildSequenceStateKey(userId: number, alertId: number, symbol: string): string {
  return `${userId}:${alertId}:${symbol.toUpperCase()}`;
}

function getAlertsPublicBaseUrl(): string | null {
  const value = process.env.ALERTS_PUBLIC_BASE_URL?.trim() || process.env.PUBLIC_APP_URL?.trim() || null;
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

function buildTwilioStatusCallbackUrl(deliveryId: number): string | null {
  const baseUrl = getAlertsPublicBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl}/api/alerts/deliveries/twilio-status?deliveryId=${deliveryId}`;
}

export interface AlertMatchDetail {
  symbol: string;
  summary: string;
  lastPrice: number | null;
  triggerPrice: number | null;
  triggeredClauses: string[];
}

export interface AlertEvaluationResult {
  evaluatedAt: string;
  sourceLabel: string;
  symbolCount: number;
  matchedCount: number;
  matchedSymbols: string[];
  matches: AlertMatchDetail[];
}

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map((symbol) => symbol.toUpperCase()).filter(Boolean)));
}

function timeframeToIntradayInterval(timeframe: string | undefined): string {
  const value = (timeframe ?? "5m").toLowerCase();
  if (value === "5m" || value === "5min") return "5m";
  if (value === "15m" || value === "15min") return "15m";
  if (value === "30m" || value === "30min") return "30m";
  if (value === "60m" || value === "60min" || value === "1h") return "60m";
  return "5m";
}

function isDailyTimeframe(timeframe: string | undefined): boolean {
  return (timeframe ?? "").toLowerCase() === "1d";
}

const ET_TIMEZONE = "America/New_York";
const tradingCalendarCache = new Map<string, string[]>();

function getCalendarCacheKey(startDate: string, endDate: string): string {
  return `${startDate}:${endDate}`;
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
    hour: Number(hourStr),
    minute: Number(minuteStr),
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

async function getTradingCalendarDates(startDate: string, endDate: string): Promise<string[]> {
  const cacheKey = getCalendarCacheKey(startDate, endDate);
  const cached = tradingCalendarCache.get(cacheKey);
  if (cached) return cached;
  const calendar = await fetchAlpacaTradingCalendar(startDate, endDate);
  const dates = calendar
    .map((day) => day.date)
    .filter((date): date is string => typeof date === "string" && date.length === 10)
    .sort();
  tradingCalendarCache.set(cacheKey, dates);
  return dates;
}

async function addMarketHours(anchor: Date, hours: number): Promise<Date> {
  let current = new Date(anchor);
  let remainingMinutes = Math.max(0, Math.round(hours * 60));

  while (remainingMinutes > 0) {
    const currentEt = getEtParts(current);
    const future = new Date(current);
    future.setUTCDate(future.getUTCDate() + 30);
    const futureEt = getEtParts(future);
    const marketDates = await getTradingCalendarDates(currentEt.date, futureEt.date);
    if (marketDates.length === 0) break;

    const currentIndex = marketDates.findIndex((date) => date >= currentEt.date);
    const dateIndex = currentIndex === -1 ? marketDates.length - 1 : currentIndex;
    const activeDate = marketDates[dateIndex];
    const marketOpen = zonedDateTimeToUtc(activeDate, 9, 30);
    const marketClose = zonedDateTimeToUtc(activeDate, 16, 0);

    if (current < marketOpen) {
      current = marketOpen;
    } else if (current >= marketClose) {
      const nextDate = marketDates[dateIndex + 1];
      if (!nextDate) break;
      current = zonedDateTimeToUtc(nextDate, 9, 30);
      continue;
    }

    const availableMinutes = Math.max(0, Math.floor((marketClose.getTime() - current.getTime()) / 60000));
    const consumedMinutes = Math.min(remainingMinutes, availableMinutes);
    current = new Date(current.getTime() + consumedMinutes * 60000);
    remainingMinutes -= consumedMinutes;

    if (remainingMinutes > 0) {
      const nextDate = marketDates[dateIndex + 1];
      if (!nextDate) break;
      current = zonedDateTimeToUtc(nextDate, 9, 30);
    }
  }

  return current;
}

async function addMarketDays(anchor: Date, days: number): Promise<Date> {
  const currentEt = getEtParts(anchor);
  const future = new Date(anchor);
  future.setUTCDate(future.getUTCDate() + Math.max(14, days * 3));
  const futureEt = getEtParts(future);
  const marketDates = await getTradingCalendarDates(currentEt.date, futureEt.date);
  if (marketDates.length === 0) return anchor;

  const anchorIndex = marketDates.findIndex((date) => date >= currentEt.date);
  const startIndex = anchorIndex === -1 ? marketDates.length - 1 : anchorIndex;
  const expirationIndex = Math.min(marketDates.length - 1, startIndex + Math.max(0, days - 1));
  return zonedDateTimeToUtc(marketDates[expirationIndex], 16, 0);
}

async function resolveSequenceExpiration(
  anchor: Date,
  sequenceWindow: AlertRuleGroup["sequenceWindow"]
): Promise<Date | null> {
  if (!sequenceWindow?.value) return null;
  return sequenceWindow.unit === "market_days"
    ? addMarketDays(anchor, sequenceWindow.value)
    : addMarketHours(anchor, sequenceWindow.value);
}

function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((acc, value) => acc + value, 0);
  return sum / period;
}

function calculateEMA(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(values.slice(0, period), period);
  if (ema == null) return null;
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateEMAAtOffset(values: number[], period: number, offsetFromEnd: number): number | null {
  if (offsetFromEnd < 0 || values.length - offsetFromEnd <= 0) return null;
  return calculateEMA(values.slice(0, values.length - offsetFromEnd), period);
}

function calculateSMAAtOffset(values: number[], period: number, offsetFromEnd: number): number | null {
  if (offsetFromEnd < 0 || values.length - offsetFromEnd <= 0) return null;
  return calculateSMA(values.slice(0, values.length - offsetFromEnd), period);
}

async function getBarsForTimeframe(
  symbol: string,
  timeframe: string,
  caches: SymbolEvaluationCaches
): Promise<Array<DailyBar | IntradayBar>> {
  if (isDailyTimeframe(timeframe)) {
    if (caches.daily === undefined) {
      caches.daily = await getDailyBars(symbol, 260);
    }
    return caches.daily ?? [];
  }

  const interval = timeframeToIntradayInterval(timeframe);
  if (!caches.intraday[interval]) {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 10);
    caches.intraday[interval] = await getIntradayBars(symbol, interval, startDate, endDate, false);
  }
  return caches.intraday[interval] ?? [];
}

function getCloseSeries(bars: Array<DailyBar | IntradayBar>): number[] {
  return bars.map((bar) => bar.close).filter((value) => Number.isFinite(value));
}

async function resolveIndicatorValue(
  symbol: string,
  operand: AlertIndicatorOperand,
  caches: SymbolEvaluationCaches,
  offsetFromEnd: number = 0
): Promise<number | null> {
  if (isDailyTimeframe(operand.timeframe) && offsetFromEnd === 0 && (operand.length === 10 || operand.length === 20 || operand.length === 50 || operand.length === 200)) {
    if (caches.mas === undefined) {
      caches.mas = await getMAs(symbol);
    }
    if (caches.mas) {
      if (operand.kind === "EMA" && operand.length === 10) return caches.mas.ema10d;
      if (operand.kind === "EMA" && operand.length === 20) return caches.mas.ema20d;
      if (operand.kind === "SMA" && operand.length === 50) return caches.mas.sma50d;
      if (operand.kind === "SMA" && operand.length === 200) return caches.mas.sma200d;
    }
  }

  const bars = await getBarsForTimeframe(symbol, operand.timeframe, caches);
  const closes = getCloseSeries(bars);
  return operand.kind === "EMA"
    ? calculateEMAAtOffset(closes, operand.length, offsetFromEnd)
    : calculateSMAAtOffset(closes, operand.length, offsetFromEnd);
}

async function resolveReferenceValue(
  symbol: string,
  reference: AlertReferenceOperand,
  context: EvaluationContext,
  caches: SymbolEvaluationCaches
): Promise<number | null> {
  switch (reference.kind) {
    case "daily_vwap":
    case "session_vwap":
      return context.quote?.vwap ?? null;
    case "constant":
    case "horizontal_line":
      return reference.value ?? null;
    case "trade_entry":
      return context.watchlistRefs?.entry ?? null;
    case "trade_stop":
      return context.watchlistRefs?.stop ?? null;
    case "trade_target":
      return context.watchlistRefs?.target ?? null;
    case "sma":
    case "ema":
      if (!reference.indicatorKind || !reference.length || !reference.timeframe) return null;
      return resolveIndicatorValue(symbol, {
        kind: reference.indicatorKind,
        length: reference.length,
        timeframe: reference.timeframe,
      }, caches);
    default:
      return null;
  }
}

async function resolvePreviousPrice(symbol: string, timeframe: string | undefined, caches: SymbolEvaluationCaches): Promise<number | null> {
  if (isDailyTimeframe(timeframe)) {
    const bars = await getBarsForTimeframe(symbol, "1D", caches);
    const dailyBars = bars as DailyBar[];
    return dailyBars.length >= 2 ? dailyBars[1].close : null;
  }

  const bars = await getBarsForTimeframe(symbol, timeframeToIntradayInterval(timeframe), caches);
  const intradayBars = bars as IntradayBar[];
  return intradayBars.length >= 2 ? intradayBars[intradayBars.length - 2].close : null;
}

async function evaluateCondition(
  symbol: string,
  condition: AlertRuleCondition,
  context: EvaluationContext,
  caches: SymbolEvaluationCaches
): Promise<{ pass: boolean; clauses: string[]; triggerPrice: number | null }> {
  const currentPrice = context.quote?.price ?? null;
  const clauses: string[] = [];

  if (condition.rowType === "price_reference") {
    const referenceValue = await resolveReferenceValue(symbol, condition.reference, context, caches);
    if (currentPrice == null || referenceValue == null) return { pass: false, clauses, triggerPrice: null };

    const previousPrice = await resolvePreviousPrice(symbol, condition.reference.timeframe, caches);
    const pass =
      condition.comparator === "is_above" ? currentPrice > referenceValue :
      condition.comparator === "is_below" ? currentPrice < referenceValue :
      condition.comparator === "crosses_above" ? previousPrice != null && previousPrice <= referenceValue && currentPrice > referenceValue :
      previousPrice != null && previousPrice >= referenceValue && currentPrice < referenceValue;

    if (pass) clauses.push(`price ${condition.comparator.replaceAll("_", " ")} ${condition.reference.kind.replaceAll("_", " ")}`);
    return { pass, clauses, triggerPrice: pass ? referenceValue : null };
  }

  if (condition.rowType === "price_distance") {
    const referenceValue = await resolveReferenceValue(symbol, condition.reference, context, caches);
    if (currentPrice == null || referenceValue == null || referenceValue === 0) return { pass: false, clauses, triggerPrice: null };

    const pctDistance = Math.abs(((currentPrice - referenceValue) / referenceValue) * 100);
    const pass = condition.comparator === "within_percent_of"
      ? pctDistance <= condition.percent
      : pctDistance > condition.percent;

    if (pass) clauses.push(`price ${condition.comparator === "within_percent_of" ? "within" : "outside"} ${condition.percent}% of ${condition.reference.kind.replaceAll("_", " ")}`);
    return { pass, clauses, triggerPrice: pass ? referenceValue : null };
  }

  if (condition.rowType === "indicator_cross") {
    const leftCurrent = await resolveIndicatorValue(symbol, condition.left, caches, 0);
    const leftPrevious = await resolveIndicatorValue(symbol, condition.left, caches, 1);
    const rightCurrent = await resolveIndicatorValue(symbol, condition.right, caches, 0);
    const rightPrevious = await resolveIndicatorValue(symbol, condition.right, caches, 1);
    if ([leftCurrent, leftPrevious, rightCurrent, rightPrevious].some((value) => value == null)) {
      return { pass: false, clauses, triggerPrice: null };
    }

    const pass = condition.comparator === "crosses_above"
      ? leftPrevious! <= rightPrevious! && leftCurrent! > rightCurrent!
      : leftPrevious! >= rightPrevious! && leftCurrent! < rightCurrent!;

    if (pass) clauses.push(`${condition.left.kind} ${condition.left.length} ${condition.comparator.replaceAll("_", " ")} ${condition.right.kind} ${condition.right.length} on ${condition.left.timeframe}`);
    return { pass, clauses, triggerPrice: pass ? currentPrice : null };
  }

  if (condition.rowType === "indicator_reference") {
    const indicatorCurrent = await resolveIndicatorValue(symbol, condition.indicator, caches, 0);
    const indicatorPrevious = await resolveIndicatorValue(symbol, condition.indicator, caches, 1);
    const referenceCurrent = await resolveReferenceValue(symbol, condition.reference, context, caches);
    if (indicatorCurrent == null || referenceCurrent == null) return { pass: false, clauses, triggerPrice: null };

    const pass =
      condition.comparator === "is_above" ? indicatorCurrent > referenceCurrent :
      condition.comparator === "is_below" ? indicatorCurrent < referenceCurrent :
      condition.comparator === "crosses_above" ? indicatorPrevious != null && indicatorPrevious <= referenceCurrent && indicatorCurrent > referenceCurrent :
      indicatorPrevious != null && indicatorPrevious >= referenceCurrent && indicatorCurrent < referenceCurrent;

    if (pass) clauses.push(`${condition.indicator.kind} ${condition.indicator.length} ${condition.comparator.replaceAll("_", " ")} ${condition.reference.kind.replaceAll("_", " ")}`);
    return { pass, clauses, triggerPrice: pass ? referenceCurrent : null };
  }

  if (condition.rowType === "volume_confirmation") {
    const bars = await getBarsForTimeframe(symbol, condition.timeframe, caches);
    const volumes = bars.map((bar) => bar.volume).filter((value) => Number.isFinite(value));
    if (volumes.length < 21) return { pass: false, clauses, triggerPrice: null };

    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = volumes.slice(Math.max(0, volumes.length - 21), volumes.length - 1).reduce((sum, value) => sum + value, 0) / 20;
    const pass = avgVolume > 0 && currentVolume >= avgVolume * condition.multiplier;
    if (pass) clauses.push(`volume above ${condition.multiplier}x average on ${condition.timeframe}`);
    return { pass, clauses, triggerPrice: pass ? currentPrice : null };
  }

  if (condition.rowType === "trade_plan_reference") {
    if (currentPrice == null) return { pass: false, clauses, triggerPrice: null };
    const referenceValue =
      condition.tradePlanField === "entry" ? context.watchlistRefs?.entry :
      condition.tradePlanField === "stop" ? context.watchlistRefs?.stop :
      context.watchlistRefs?.target;
    if (referenceValue == null) return { pass: false, clauses, triggerPrice: null };

    const previousPrice = await resolvePreviousPrice(symbol, "5m", caches);
    const pass =
      condition.comparator === "within_percent_of"
        ? Math.abs(((currentPrice - referenceValue) / referenceValue) * 100) <= (condition.percent ?? 0)
        : condition.comparator === "crosses_above"
          ? previousPrice != null && previousPrice <= referenceValue && currentPrice > referenceValue
          : previousPrice != null && previousPrice >= referenceValue && currentPrice < referenceValue;

    if (pass) clauses.push(`price ${condition.comparator === "within_percent_of" ? `within ${condition.percent ?? 0}% of` : condition.comparator.replaceAll("_", " ")} ${condition.tradePlanField}`);
    return { pass, clauses, triggerPrice: pass ? referenceValue : null };
  }

  return { pass: false, clauses, triggerPrice: null };
}

async function evaluateSequenceGroup(
  symbol: string,
  group: AlertRuleGroup,
  context: EvaluationContext,
  caches: SymbolEvaluationCaches,
  persistence?: SequencePersistenceContext
): Promise<{ pass: boolean; clauses: string[]; triggerPrice: number | null }> {
  const now = new Date();
  const existingState = persistence?.statesBySymbol[symbol.toUpperCase()];
  let nextStageIndex = existingState?.nextStageIndex ?? 0;
  let armedAt = existingState?.armedAt ?? null;
  let expiresAt = existingState?.expiresAt ?? null;
  const clauses: string[] = [];
  let triggerPrice: number | null = null;

  if (expiresAt && now > expiresAt) {
    nextStageIndex = 0;
    armedAt = null;
    expiresAt = null;
  }

  while (nextStageIndex < group.children.length) {
    const stage = group.children[nextStageIndex];
    const stageResult = "nodeType" in stage
      ? await evaluateGroup(symbol, stage, context, caches, persistence)
      : await evaluateCondition(symbol, stage, context, caches);
    if (!stageResult.pass) break;

    clauses.push(...stageResult.clauses.map((clause) => `stage ${nextStageIndex + 1}: ${clause}`));
    triggerPrice = stageResult.triggerPrice ?? triggerPrice;
    nextStageIndex += 1;

    if (nextStageIndex === 1) {
      armedAt = now;
      expiresAt = await resolveSequenceExpiration(now, group.sequenceWindow);
    }
  }

  if (nextStageIndex >= group.children.length) {
    if (persistence) {
      await upsertSequenceState(persistence, symbol, null);
    }
    return { pass: true, clauses, triggerPrice };
  }

  if (persistence) {
    await upsertSequenceState(persistence, symbol, nextStageIndex > 0 ? {
      symbol,
      status: "armed",
      nextStageIndex,
      armedAt,
      expiresAt,
      lastMatchedAt: nextStageIndex > 0 ? now : null,
    } : null);
  }

  return { pass: false, clauses, triggerPrice: null };
}

async function evaluateGroup(
  symbol: string,
  group: AlertRuleGroup,
  context: EvaluationContext,
  caches: SymbolEvaluationCaches,
  persistence?: SequencePersistenceContext
): Promise<{ pass: boolean; clauses: string[]; triggerPrice: number | null }> {
  if (group.operator === "THEN") {
    return evaluateSequenceGroup(symbol, group, context, caches, persistence);
  }

  const childResults = await Promise.all(
    group.children.map((child) =>
      "nodeType" in child
        ? evaluateGroup(symbol, child, context, caches, persistence)
        : evaluateCondition(symbol, child, context, caches)
    )
  );

  const pass = group.operator === "AND"
    ? childResults.every((result) => result.pass)
    : childResults.some((result) => result.pass);

  const clauses = childResults.flatMap((result) => result.clauses);
  const triggerPrice = pass
    ? childResults.reduce<number | null>((selected, result) => result.triggerPrice ?? selected, null)
    : null;
  return { pass, clauses, triggerPrice };
}

async function loadWatchlistReferenceMap(userId: number, watchlistId: number | undefined): Promise<WatchlistReferenceMap> {
  const db = getDb();
  if (!db) return {};

  const query = db
    .select({
      symbol: sentinelWatchlist.symbol,
      entry: sentinelWatchlist.targetEntry,
      stop: sentinelWatchlist.stopPlan,
      target: sentinelWatchlist.targetPlan,
    })
    .from(sentinelWatchlist);

  const rows = watchlistId
    ? await query.where(and(eq(sentinelWatchlist.userId, userId), eq(sentinelWatchlist.watchlistId, watchlistId)))
    : await query.where(eq(sentinelWatchlist.userId, userId));

  return rows.reduce<WatchlistReferenceMap>((acc, row) => {
    acc[row.symbol.toUpperCase()] = {
      entry: row.entry,
      stop: row.stop,
      target: row.target,
    };
    return acc;
  }, {});
}

async function loadSequenceStates(userId: number, alertId: number): Promise<Record<string, SequenceStateRecord>> {
  const db = getDb();
  const fallbackState = Array.from(inMemorySequenceStates.entries()).reduce<Record<string, SequenceStateRecord>>((acc, [key, value]) => {
    if (key.startsWith(`${userId}:${alertId}:`)) {
      acc[value.symbol.toUpperCase()] = value;
    }
    return acc;
  }, {});
  if (!db) return fallbackState;
  let rows: AlertSymbolState[] = [];
  try {
    rows = await db
      .select()
      .from(alertSymbolStates)
      .where(and(eq(alertSymbolStates.userId, userId), eq(alertSymbolStates.alertId, alertId)));
  } catch (error) {
    console.warn("[Alerts] sequence state table unavailable; using in-memory staged alert state until db:push is applied.", error);
    return fallbackState;
  }

  return rows.reduce<Record<string, SequenceStateRecord>>((acc, row) => {
    acc[row.symbol.toUpperCase()] = {
      id: row.id,
      symbol: row.symbol.toUpperCase(),
      status: row.status,
      nextStageIndex: row.nextStageIndex,
      armedAt: row.armedAt ?? null,
      expiresAt: row.expiresAt ?? null,
      lastMatchedAt: row.lastMatchedAt ?? null,
    };
    return acc;
  }, {});
}

async function upsertSequenceState(
  persistence: SequencePersistenceContext,
  symbol: string,
  state: SequenceStateRecord | null
): Promise<void> {
  const db = getDb();
  if (!persistence.enabled) return;
  const normalizedSymbol = symbol.toUpperCase();
  const memoryKey = buildSequenceStateKey(persistence.userId, persistence.alertId, normalizedSymbol);
  const existing = persistence.statesBySymbol[normalizedSymbol];

  if (!state) {
    inMemorySequenceStates.delete(memoryKey);
    if (existing?.id) {
      if (db) {
        try {
          await db.delete(alertSymbolStates).where(eq(alertSymbolStates.id, existing.id));
        } catch (error) {
          console.warn("[Alerts] failed clearing sequence state", error);
        }
      }
      delete persistence.statesBySymbol[normalizedSymbol];
    }
    return;
  }

  inMemorySequenceStates.set(memoryKey, { ...state, symbol: normalizedSymbol });

  const nextState = {
    status: state.status,
    nextStageIndex: state.nextStageIndex,
    armedAt: state.armedAt,
    expiresAt: state.expiresAt,
    lastMatchedAt: state.lastMatchedAt,
    lastEvaluatedAt: new Date(),
    statePayload: null,
    updatedAt: new Date(),
  };

  if (!db) {
    persistence.statesBySymbol[normalizedSymbol] = { ...state, symbol: normalizedSymbol };
    return;
  }

  if (existing?.id) {
    try {
      await db
        .update(alertSymbolStates)
        .set(nextState)
        .where(eq(alertSymbolStates.id, existing.id));
    } catch (error) {
      console.warn("[Alerts] failed updating sequence state", error);
      return;
    }
    persistence.statesBySymbol[normalizedSymbol] = { ...state, id: existing.id, symbol: normalizedSymbol };
    return;
  }

  let inserted;
  try {
    inserted = await db
      .insert(alertSymbolStates)
      .values({
        alertId: persistence.alertId,
        userId: persistence.userId,
        symbol: normalizedSymbol,
        ...nextState,
      })
      .returning();
  } catch (error) {
    console.warn("[Alerts] failed inserting sequence state", error);
    return;
  }

  persistence.statesBySymbol[normalizedSymbol] = {
    ...state,
    id: inserted[0]?.id,
    symbol: normalizedSymbol,
  };
}

export function clearAlertSequenceState(userId: number, alertId: number): void {
  const prefix = `${userId}:${alertId}:`;
  for (const key of Array.from(inMemorySequenceStates.keys())) {
    if (key.startsWith(prefix)) {
      inMemorySequenceStates.delete(key);
    }
  }
}

export async function resolveTargetSymbolsForAlert(userId: number, targetScope: AlertTargetScope): Promise<{ symbols: string[]; watchlistRefs: WatchlistReferenceMap }> {
  if (targetScope.mode === "single_symbol" && targetScope.symbol) {
    const symbol = targetScope.symbol.toUpperCase();
    const watchlistRefs = await loadWatchlistReferenceMap(userId, targetScope.watchlistId);
    if (watchlistRefs[symbol]) {
      return { symbols: [symbol], watchlistRefs };
    }

    const fallbackRefs = await loadWatchlistReferenceMap(userId, undefined);
    return { symbols: [symbol], watchlistRefs: fallbackRefs[symbol] ? { [symbol]: fallbackRefs[symbol] } : {} };
  }

  if (targetScope.targetType === "watchlist") {
    const watchlistRefs = await loadWatchlistReferenceMap(userId, targetScope.watchlistId);
    const symbols = targetScope.symbols?.length
      ? normalizeSymbols(targetScope.symbols)
      : Object.keys(watchlistRefs);
    return { symbols, watchlistRefs };
  }

  if (targetScope.targetType === "theme" && targetScope.themeId) {
    const members = isCacheInitialized()
      ? getThemeMembersFromCache(targetScope.themeId as never)
      : await getThemeMembersFromDB(targetScope.themeId as never);
    const symbols = members.length > 0
      ? normalizeSymbols(members.map((member) => member.symbol))
      : normalizeSymbols(targetScope.symbols ?? []);
    return { symbols, watchlistRefs: {} };
  }

  return { symbols: normalizeSymbols(targetScope.symbols ?? []), watchlistRefs: {} };
}

export async function evaluateAlertDefinition(
  userId: number,
  definition: Pick<CreateAlertDefinitionInput, "targetScope" | "ruleTree" | "evaluationConfig" | "deliveryConfig"> & { name?: string },
  options?: {
    sequencePersistence?: SequencePersistenceContext;
  }
): Promise<AlertEvaluationResult> {
  const { symbols, watchlistRefs } = await resolveTargetSymbolsForAlert(userId, definition.targetScope);
  const matches: AlertMatchDetail[] = [];

  for (const symbol of symbols) {
    const quote = await getQuote(symbol);
    const caches: SymbolEvaluationCaches = { intraday: {}, daily: undefined, mas: undefined };
    const result = await evaluateGroup(symbol, definition.ruleTree, {
      symbol,
      quote,
      watchlistRefs: watchlistRefs[symbol],
    }, caches, options?.sequencePersistence);

    if (result.pass) {
      matches.push({
        symbol,
        summary: `${symbol} matched ${definition.name ?? definition.targetScope.label}`,
        lastPrice: quote?.price ?? null,
        triggerPrice: result.triggerPrice ?? quote?.price ?? null,
        triggeredClauses: result.clauses,
      });
    }
  }

  return {
    evaluatedAt: new Date().toISOString(),
    sourceLabel: definition.targetScope.label,
    symbolCount: symbols.length,
    matchedCount: matches.length,
    matchedSymbols: matches.map((match) => match.symbol),
    matches,
  };
}

export async function evaluateStoredAlertById(userId: number, alertId: number, persistEvent: boolean = true): Promise<AlertEvaluationResult | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(userAlerts)
    .where(and(eq(userAlerts.id, alertId), eq(userAlerts.userId, userId)))
    .limit(1);
  const alert = rows[0];
  if (!alert) return null;

  const sequencePersistence: SequencePersistenceContext = {
    userId,
    alertId: alert.id,
    enabled: persistEvent,
    statesBySymbol: await loadSequenceStates(userId, alert.id),
  };

  const result = await evaluateAlertDefinition(userId, {
    name: alert.name,
    targetScope: alert.targetScope,
    ruleTree: alert.ruleTree,
    evaluationConfig: alert.evaluationConfig,
    deliveryConfig: alert.deliveryConfig,
  }, { sequencePersistence });

  if (persistEvent && result.matchedCount > 0) {
    const insertedEvents = await db
      .insert(alertEvents)
      .values({
        alertId: alert.id,
        userId,
        matchedSymbols: result.matchedSymbols,
        matchedCount: result.matchedCount,
        summary: result.matches[0]?.summary ?? `${alert.name} triggered`,
        triggerReason: result.matches[0]?.triggeredClauses.join("; "),
        sourceGroupLabel: alert.targetScope.label,
        deliveryMode: alert.deliveryConfig.deliveryMode,
        deliveryChannels: alert.deliveryConfig.channels,
      })
      .returning();

    const event = insertedEvents[0];
    if (event) {
      const channels = (alert.deliveryConfig as AlertDeliveryConfig).channels ?? [];
      if (channels.length > 0) {
        const deliveryRows: Array<typeof alertDeliveries.$inferInsert> = [];
        for (const channel of channels) {
          if (channel === "sms") {
            for (const match of result.matches) {
              deliveryRows.push({
                alertId: alert.id,
                alertEventId: event.id,
                channel,
                status: "pending",
                batchKey: `${alert.id}:${event.id}:${match.symbol}`,
                errorMessage: null,
              });
            }
            continue;
          }

          deliveryRows.push({
            alertId: alert.id,
            alertEventId: event.id,
            channel,
            status: "pending",
            batchKey: alert.deliveryConfig.deliveryMode === "batched"
              ? `${alert.id}:${new Date().toISOString().slice(0, 16)}`
              : null,
            errorMessage: null,
          });
        }

        const insertedDeliveries = deliveryRows.length > 0
          ? await db.insert(alertDeliveries).values(deliveryRows).returning()
          : [];

        const deliveryConfig = alert.deliveryConfig as AlertDeliveryConfig;
        const smsPhoneNumber = deliveryConfig.phoneNumber?.trim() || process.env.MY_ALERT_SMS_NUMBER?.trim();
        if (channels.includes("sms")) {
          const smsDeliveries = insertedDeliveries.filter((delivery) => delivery.channel === "sms");
          for (let index = 0; index < result.matches.length; index += 1) {
            const match = result.matches[index];
            const delivery = smsDeliveries[index];
            if (!delivery) continue;

            if (!smsPhoneNumber) {
              await db
                .update(alertDeliveries)
                .set({
                  status: "failed",
                  errorMessage: "SMS destination is missing",
                  attemptedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(alertDeliveries.id, delivery.id));
              continue;
            }

            try {
              const smsResult = await sendMessage({
                channel: "sms",
                to: smsPhoneNumber,
                body: buildAlertSmsBody(match.symbol, match.triggerPrice),
                statusCallbackUrl: buildTwilioStatusCallbackUrl(delivery.id),
              });

              let finalSmsResult = smsResult;
              if (smsResult.success && smsResult.providerMessageId) {
                try {
                  const refreshedStatus = await fetchTwilioMessageStatus(smsResult.providerMessageId);
                  if (refreshedStatus.providerStatus && refreshedStatus.providerStatus !== "queued") {
                    finalSmsResult = refreshedStatus;
                  }
                } catch (error) {
                  console.warn("[Alerts] failed fetching immediate Twilio status", error);
                }
              }

              await db
                .update(alertDeliveries)
                .set({
                  status:
                    finalSmsResult.providerStatus === "delivered" ? "delivered" :
                    finalSmsResult.success ? "provider_accepted" : "failed",
                  providerMessageId: finalSmsResult.providerMessageId ?? null,
                  providerStatus: finalSmsResult.providerStatus ?? (finalSmsResult.success ? "accepted" : "failed"),
                  providerErrorCode: finalSmsResult.providerErrorCode ?? null,
                  providerPayload: finalSmsResult.providerPayload ?? null,
                  errorMessage: finalSmsResult.success ? null : (finalSmsResult.errorMessage ?? "SMS send failed"),
                  attemptedAt: new Date(),
                  deliveredAt: finalSmsResult.providerStatus === "delivered" ? new Date() : null,
                  providerStatusAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(alertDeliveries.id, delivery.id));
            } catch (error) {
              await db
                .update(alertDeliveries)
                .set({
                  status: "failed",
                  errorMessage: error instanceof Error ? error.message : "SMS send failed",
                  attemptedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(alertDeliveries.id, delivery.id));
            }
          }
        }
      }
    }

    await db
      .update(userAlerts)
      .set({ lastTriggeredAt: new Date(), updatedAt: new Date() })
      .where(eq(userAlerts.id, alert.id));
  }

  return result;
}
