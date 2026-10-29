import { and, eq, gte } from "drizzle-orm";
import { positionAlerts, sentinelWatchlist, watchlists } from "@shared/schema";
import { getDb } from "../db";
import { getIntradayBars } from "../data-layer/intraday-bars";
import { getQuote } from "../data-layer/quotes";
import { fetchEarningsCalendar } from "../finnhub";
import { getMarketSession } from "../market-condition/universe";
import { dailyBarsOldestFirst } from "./chart-numbers";
import { buildSnapshot, materialChange, type IndexInput, type PositionSnapshot } from "./position-snapshot";
import { withLivePrice, type PositionSignal } from "./position-rules";
import { setupHits, setupParamsFor, todaysBars } from "./setup-rules";
import { getVix } from "./vix";
import { holdsWorkerLock } from "./worker-lock";
import { isMarketHoliday, regularCloseMinute } from "@shared/us-market-holidays";

/**
 * Builds a snapshot of every open position (items in isPortfolio lists with an entry price) each poll, and writes one
 * position_alerts row for a position when it has a rule signal not sent yet today or its situation materially
 * changed (materialChange). During market hours it also checks the starred (isDefault) list for entry setups
 * (setup-rules.ts) and writes one rule "setup" row per item for the setups not sent yet today. Anima reads the rows
 * through GET /api/alerts/feed; Quinn decides what to say.
 */
const MARKET_MS = 30_000;
const AFTER_MS = 2 * 60_000;
const CLOSED_MS = 5 * 60_000;
const SETUP_MS = 60_000;
const SNAPSHOT_FRESH_MS = 2 * 60_000;
const SIGNAL_ORDER = ["stop:breach", "stop:warn", "level_break", "trail", "wedge_drop", "trim"];

const latest = new Map<number, { at: number; byItem: Map<number, PositionSnapshot> }>();
const sent = { day: "", keys: new Set<string>() };
const earnings = new Map<string, { day: string; date: string | null }>();
let started = false;
let running = false;
let lastSetupRun = 0;

export function etClock(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekend: parts.weekday === "Sat" || parts.weekday === "Sun",
    holiday: isMarketHoliday(`${parts.year}-${parts.month}-${parts.day}`),
  };
}

export function sessionTiming(clock: ReturnType<typeof etClock>, lastBarDay: string | undefined, inSession: boolean) {
  const open = 9 * 60 + 30, close = regularCloseMinute(clock.day);
  return {
    sessionFraction: inSession ? Math.max(0, Math.min(1, (clock.minutes - open) / (close - open))) : 1,
    closeFinal: !inSession && !clock.weekend && !clock.holiday && clock.minutes >= close && lastBarDay === clock.day,
  };
}

/** Rule signals first, by urgency; otherwise "change". */
export function headline(newSignals: PositionSignal[]): { rule: string; level: string } {
  const rank = (s: PositionSignal) => {
    const i = SIGNAL_ORDER.indexOf(`${s.rule}:${s.level}`);
    return i >= 0 ? i : SIGNAL_ORDER.indexOf(s.rule) >= 0 ? SIGNAL_ORDER.indexOf(s.rule) : SIGNAL_ORDER.length;
  };
  const top = [...newSignals].sort((a, b) => rank(a) - rank(b))[0];
  return top ? { rule: top.rule, level: top.level } : { rule: "change", level: "material" };
}

async function openPositions(userId?: number) {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({ item: sentinelWatchlist })
    .from(sentinelWatchlist)
    .innerJoin(watchlists, eq(sentinelWatchlist.watchlistId, watchlists.id))
    .where(and(
      eq(watchlists.isPortfolio, true),
      eq(sentinelWatchlist.status, "watching"),
      ...(userId ? [eq(sentinelWatchlist.userId, userId)] : []),
    ));
  // Shorts are left out until the rules handle them (stop above, trims below); judging one as a long sent a
  // "max-loss" alert on a winning short and nothing on a losing one.
  return rows.map((r) => r.item).filter((i) => (i.targetEntry ?? 0) > 0 && i.direction !== "short");
}

async function nextEarnings(symbol: string, day: string): Promise<string | null> {
  const hit = earnings.get(symbol);
  if (hit && hit.day === day) return hit.date;
  let date: string | null = null;
  try {
    const to = new Date(Date.parse(`${day}T12:00:00Z`) + 60 * 86_400_000).toISOString().slice(0, 10);
    const cal = await fetchEarningsCalendar(day, to, symbol);
    date = cal.earningsCalendar.map((e) => e.date).filter((d) => d >= day).sort()[0] ?? null;
  } catch {
    date = null;
  }
  earnings.set(symbol, { day, date });
  return date;
}

async function indexInput(symbol: string, live: boolean, day: string): Promise<IndexInput | null> {
  const [bars, quote] = await Promise.all([dailyBarsOldestFirst(symbol, 60), live ? getQuote(symbol) : null]);
  if (!bars?.length) return null;
  const price = quote?.price ?? null;
  return { bars: withLivePrice(bars, price, { day, open: quote?.open, volume: quote?.volume }), price };
}

/** Current snapshots for the positions (all users, or one). Reads only. */
export async function computeSnapshots(userId?: number, now = new Date()) {
  const items = await openPositions(userId);
  if (!items.length) return [];
  const inSession = getMarketSession() === "MARKET_HOURS";
  const clock = etClock(now);
  const [spy, qqq, vix] = await Promise.all([
    indexInput("SPY", inSession, clock.day), indexInput("QQQ", inSession, clock.day), getVix(),
  ]);
  const out: Array<{ userId: number; snapshot: PositionSnapshot }> = [];
  for (const item of items) {
    try {
      const [bars, quote, earningsDate] = await Promise.all([
        dailyBarsOldestFirst(item.symbol),
        inSession ? getQuote(item.symbol) : null,
        nextEarnings(item.symbol.toUpperCase(), clock.day),
      ]);
      if (!bars?.length) continue;
      const timing = sessionTiming(clock, bars[bars.length - 1].date.slice(0, 10), inSession);
      const snapshot = buildSnapshot({
        pos: { itemId: item.id, symbol: item.symbol, entry: item.targetEntry!, stopPlan: item.stopPlan,
          shares: item.shares, entryDate: item.entryDate },
        bars,
        price: quote?.price ?? null,
        quote,
        spy, qqq, vix,
        earningsDate,
        day: clock.day,
        at: now.toISOString(),
        ...timing,
      });
      out.push({ userId: item.userId, snapshot });
    } catch (error) {
      console.warn(`[PositionAlerts] snapshot failed for ${item.symbol}:`, error);
    }
  }
  return out;
}

export async function snapshotsForUser(userId: number): Promise<PositionSnapshot[]> {
  const hit = latest.get(userId);
  if (hit && Date.now() - hit.at < SNAPSHOT_FRESH_MS) return [...hit.byItem.values()];
  return (await computeSnapshots(userId)).map((s) => s.snapshot);
}

async function loadSentToday(day: string) {
  if (sent.day === day) return;
  sent.day = day;
  sent.keys = new Set();
  const db = getDb();
  if (!db) return;
  const rows = await db
    .select({ key: positionAlerts.dedupeKey, payload: positionAlerts.payload })
    .from(positionAlerts)
    .where(gte(positionAlerts.createdAt, new Date(Date.now() - 24 * 3_600_000)));
  for (const r of rows) {
    sent.keys.add(r.key);
    const p = r.payload as { signalKeys?: string[]; changeKey?: string } | null;
    for (const k of (p?.signalKeys ?? [])) if (k.endsWith(day)) sent.keys.add(k);
    if (p?.changeKey?.includes(`:${day}:`)) sent.keys.add(p.changeKey);
  }
}

export async function runPositionAlertCycle(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const clock = etClock();
  await loadSentToday(clock.day);
  const snaps = await computeSnapshots();
  let written = 0;
  const seenUsers = new Set<number>();
  for (const { userId, snapshot } of snaps) {
    if (!seenUsers.has(userId)) {
      seenUsers.add(userId);
      latest.set(userId, { at: Date.now(), byItem: latest.get(userId)?.byItem ?? new Map() });
    }
    const byItem = latest.get(userId)!.byItem;
    const prev = byItem.get(snapshot.itemId) ?? null;
    byItem.set(snapshot.itemId, snapshot);
    const newSignals = snapshot.signals.filter((s) => !sent.keys.has(s.key));
    const change = materialChange(prev, snapshot);
    const changeKey = `chg:${snapshot.itemId}:${clock.day}:${change.fingerprint}`;
    const material = prev != null && change.material && !sent.keys.has(changeKey);
    if (!newSignals.length && !material) continue;
    const { rule, level } = headline(newSignals);
    const dedupeKey = newSignals.length ? newSignals.map((s) => s.key).sort().join("+") : changeKey;
    const inserted = await db
      .insert(positionAlerts)
      .values({
        userId,
        watchlistItemId: snapshot.itemId,
        symbol: snapshot.symbol,
        rule,
        level,
        message: newSignals.length ? newSignals.map((s) => s.message).join(" ") :
          `${snapshot.symbol}: ${change.reasons.join("; ")}.`,
        payload: {
          hard: rule === "stop" && level === "breach",
          signalKeys: newSignals.map((s) => s.key),
          changeKey,
          newSignals: newSignals.map(({ key: _k, ...s }) => s),
          change,
          snapshot,
        },
        dedupeKey,
      })
      .onConflictDoNothing()
      .returning({ id: positionAlerts.id });
    for (const s of newSignals) sent.keys.add(s.key);
    sent.keys.add(changeKey);
    sent.keys.add(dedupeKey);
    written += inserted.length;
  }
  for (const userId of [...latest.keys()]) if (!seenUsers.has(userId)) latest.delete(userId);
  return written;
}

async function starredItems() {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({ item: sentinelWatchlist })
    .from(sentinelWatchlist)
    .innerJoin(watchlists, eq(sentinelWatchlist.watchlistId, watchlists.id))
    .where(and(eq(watchlists.isDefault, true), eq(sentinelWatchlist.status, "watching")));
  return rows.map((r) => r.item);
}

/** Entry setups on the starred list; positions are left to the position rules. */
export async function runSetupAlertCycle(now = new Date()): Promise<number> {
  const db = getDb();
  if (!db || getMarketSession() !== "MARKET_HOURS") return 0;
  const clock = etClock(now);
  await loadSentToday(clock.day);
  const held = new Set((await openPositions()).map((i) => `${i.userId}:${i.symbol.toUpperCase()}`));
  const items = (await starredItems()).filter((i) => !held.has(`${i.userId}:${i.symbol.toUpperCase()}`));
  let written = 0;
  for (const item of items) {
    try {
      const symbol = item.symbol.toUpperCase();
      const [daily, quote, intraday] = await Promise.all([
        dailyBarsOldestFirst(symbol),
        getQuote(symbol),
        getIntradayBars(symbol, "5Min", new Date(now.getTime() - 86_400_000), now),
      ]);
      const price = quote?.price ?? 0;
      if (!daily?.length || !(price > 0)) continue;
      const { sessionFraction } = sessionTiming(clock, daily[daily.length - 1].date.slice(0, 10), true);
      const hits = setupHits({
        symbol, daily: withLivePrice(daily, price, { day: clock.day, open: quote?.open, volume: quote?.volume }),
        bars: todaysBars(intraday, clock.day), price, confirmed: false,
        sessionFraction,
      }).filter((h) => !sent.keys.has(`setup:${item.id}:${h.name}:${clock.day}`));
      if (!hits.length) continue;
      const keys = hits.map((h) => `setup:${item.id}:${h.name}:${clock.day}`);
      const inserted = await db
        .insert(positionAlerts)
        .values({
          userId: item.userId,
          watchlistItemId: item.id,
          symbol,
          rule: "setup",
          level: hits[0].name,
          message: hits.map((h) => h.message).join(" "),
          payload: {
            hard: false,
            list: "starred",
            signalKeys: keys,
            newSignals: hits.map((h) => ({ rule: "setup", level: h.name, message: h.message, detail: h.detail })),
            setups: hits.map((h) => ({ ...h, params: setupParamsFor(h.name) })),
            price,
            day: clock.day,
            at: now.toISOString(),
          },
          dedupeKey: keys.join("+"),
        })
        .onConflictDoNothing()
        .returning({ id: positionAlerts.id });
      for (const k of keys) sent.keys.add(k);
      written += inserted.length;
    } catch (error) {
      console.warn(`[SetupAlerts] check failed for ${item.symbol}:`, error);
    }
  }
  return written;
}

function nextDelay(): number {
  const s = getMarketSession();
  return s === "MARKET_HOURS" ? MARKET_MS : s === "AFTER_HOURS" ? AFTER_MS : CLOSED_MS;
}

export function startPositionAlertWorker(): void {
  if (started || process.env.POSITION_ALERTS_DISABLED === "true") return;
  started = true;
  const tick = async () => {
    if (!running && (await holdsWorkerLock())) {
      running = true;
      const t0 = Date.now();
      try {
        const n = await runPositionAlertCycle();
        if (n) console.log(`[PositionAlerts] ${n} alert(s) written in ${Date.now() - t0}ms`);
        if (Date.now() - lastSetupRun >= SETUP_MS) {
          lastSetupRun = Date.now();
          const s = await runSetupAlertCycle();
          if (s) console.log(`[SetupAlerts] ${s} setup alert(s) written`);
        }
      } catch (error) {
        console.error("[PositionAlerts] cycle failed:", error);
      } finally {
        running = false;
      }
    }
    setTimeout(tick, nextDelay());
  };
  console.log("[PositionAlerts] starting position snapshot worker");
  setTimeout(tick, 20_000);
}
