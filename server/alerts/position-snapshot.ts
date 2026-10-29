import { atrxFrom50, calculateAtr, calculateEMA, calculateSMA } from "@shared/chart-indicators";
import { kellSetups, kellStage, type KellHit, type KellStage } from "./kell";
import { assessStop, supportLevels } from "./levels";
import {
  evaluatePosition,
  POSITION_RULES,
  stopFor,
  trailPeriod,
  vixTrimPct,
  withLivePrice,
  type DayBar,
  type PositionInput,
  type PositionSignal,
} from "./position-rules";

/**
 * Everything about one position at one poll, for Quinn to judge (Anima anima/market_alerts.py). Velocity is in ATR14
 * units so a fast move means the same for a $20 and a $900 stock. Signals are inputs; materialChange() decides when a
 * snapshot is worth sending to Anima at all.
 */
export interface IndexInput {
  bars: DayBar[];
  price: number | null;
}

export interface SnapshotInput {
  pos: PositionInput & { entryDate?: string | null };
  bars: DayBar[];
  price: number | null;
  quote?: { open?: number; high?: number; low?: number; vwap?: number; volume?: number; prevClose?: number } | null;
  spy?: IndexInput | null;
  qqq?: IndexInput | null;
  vix?: { level: number; change: number | null } | null;
  earningsDate?: string | null;
  closeFinal: boolean;
  /** Share of the regular session gone by (0..1); 1 outside it. */
  sessionFraction: number;
  day: string;
  at?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : r2(n));

function rocAtr(closes: number[], atr: number, k: number, offset = 0): number | null {
  const i = closes.length - 1 - offset;
  return i - k >= 0 && atr > 0 ? (closes[i] - closes[i - k]) / atr : null;
}

function zScore(value: number, history: number[]): { z: number | null; pctile: number | null } {
  if (history.length < 30) return { z: null, pctile: null };
  const mean = history.reduce((s, v) => s + v, 0) / history.length;
  const sd = Math.sqrt(history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length);
  const below = history.filter((v) => v < value).length;
  return { z: sd > 0 ? (value - mean) / sd : null, pctile: Math.round((below / history.length) * 100) };
}

function indexState(idx: IndexInput | null | undefined) {
  if (!idx?.bars.length) return null;
  const bars = idx.bars;
  const price = idx.price && idx.price > 0 ? idx.price : bars[bars.length - 1].close;
  const n = bars.length;
  const s20 = calculateSMA(bars, 20)[n - 1], s50 = calculateSMA(bars, 50)[n - 1];
  const prev = bars[n - 2]?.close;
  const back5 = bars[n - 6]?.close;
  return {
    price: r2(price),
    changePct: prev ? r2(((price - prev) / prev) * 100) : null,
    roc5Pct: back5 ? r2(((price - back5) / back5) * 100) : null,
    aboveSma20: s20 != null ? price > s20 : null,
    aboveSma50: s50 != null ? price > s50 : null,
  };
}

function returnPct(bars: DayBar[], price: number, days: number): number | null {
  const base = bars[bars.length - 1 - days]?.close;
  return base ? ((price - base) / base) * 100 : null;
}

export function buildSnapshot(input: SnapshotInput) {
  const { pos } = input;
  const live = input.price != null && input.price > 0 ? input.price : null;
  const bars = withLivePrice(input.bars, live, { day: input.day, open: input.quote?.open, volume: input.quote?.volume });
  const n = bars.length;
  const last = bars[n - 1];
  const price = live ?? last?.close ?? 0;
  const atr = calculateAtr(bars, 14)[n - 1] ?? 0;
  const closes = bars.map((b, i) => (i === n - 1 ? price : b.close));
  const at = (v: number | null) => (v != null && atr > 0 ? r2((price - v) / atr) : null);
  const ma = (p: number) => {
    const v = calculateSMA(bars, p)[n - 1];
    return { value: num(v), atr: at(v) };
  };
  const ema10 = calculateEMA(bars, 10)[n - 1], ema20 = calculateEMA(bars, 20)[n - 1];
  const ext = atrxFrom50(price, bars);
  const pctFromEntry = pos.entry > 0 ? ((price - pos.entry) / pos.entry) * 100 : null;
  const { stop, planned } = stopFor(pos.entry, pos.stopPlan);
  const tp = trailPeriod(ext, pctFromEntry ?? 0);
  const trailMa = calculateSMA(bars, tp)[n - 1];

  const roc3History: number[] = [];
  const atrSeries = calculateAtr(bars, 14);
  for (let i = 20; i < n - 1; i++) {
    const a = atrSeries[i];
    if (a && a > 0) roc3History.push((bars[i].close - bars[i - 3].close) / a);
  }
  const roc1 = rocAtr(closes, atr, 1), roc3 = rocAtr(closes, atr, 3), roc5 = rocAtr(closes, atr, 5), roc10 = rocAtr(closes, atr, 10);
  const roc3Before = rocAtr(closes, atr, 3, 3);
  const unusual = roc3 != null ? zScore(roc3, roc3History.slice(-250)) : { z: null, pctile: null };
  const open = input.quote?.open && input.quote.open > 0 ? input.quote.open : last?.open;
  const prevClose = bars[n - 2]?.close;
  const bodyAvg = bars.slice(Math.max(0, n - 21), n - 1).reduce((s, b) => s + Math.abs(b.close - b.open), 0) / Math.max(1, Math.min(20, n - 1));
  const dayHigh = Math.max(last?.high ?? price, price), dayLow = Math.min(last?.low ?? price, price);

  const volDays = bars.slice(Math.max(0, n - 51), n - 1);
  const avgVol = volDays.reduce((s, b) => s + b.volume, 0) / Math.max(1, volDays.length);
  const todayVol = input.quote?.volume && input.quote.volume > 0 ? input.quote.volume : last?.volume ?? 0;
  const frac = Math.max(0.05, Math.min(1, input.sessionFraction));
  const vwap = input.quote?.vwap && input.quote.vwap > 0 && live != null ? input.quote.vwap : null;

  const levels = supportLevels(bars, price, vwap);
  const cap = pos.entry * (1 - POSITION_RULES.maxLossPct / 100);
  const stopCheck = assessStop({ entry: pos.entry, stopPlan: pos.stopPlan, cap, levels, atr: atr || null });
  const hits: KellHit[] = kellSetups(bars, price, input.closeFinal, input.sessionFraction);
  const stage: KellStage = kellStage(bars, price, hits);
  const signals: PositionSignal[] = evaluatePosition(pos, {
    bars, price: live, closeFinal: input.closeFinal, vix: input.vix?.level ?? null, day: input.day,
  });

  const spy = indexState(input.spy), qqq = indexState(input.qqq);
  const dayChange = prevClose ? ((price - prevClose) / prevClose) * 100 : null;
  const rel = (idxBars: DayBar[] | undefined, idxPrice: number | null | undefined, days: number) => {
    if (!idxBars?.length) return null;
    const ip = idxPrice && idxPrice > 0 ? idxPrice : idxBars[idxBars.length - 1].close;
    const mine = returnPct(bars, price, days), theirs = returnPct(idxBars, ip, days);
    return mine != null && theirs != null ? r2(mine - theirs) : null;
  };
  const daysToEarnings = input.earningsDate
    ? Math.round((Date.parse(`${input.earningsDate}T12:00:00Z`) - Date.parse(`${input.day}T12:00:00Z`)) / 86_400_000)
    : null;

  return {
    itemId: pos.itemId,
    symbol: pos.symbol.toUpperCase(),
    at: input.at ?? new Date().toISOString(),
    day: input.day,
    live: live != null,
    closeFinal: input.closeFinal,
    price: r2(price),
    entry: pos.entry,
    entryDate: pos.entryDate ?? null,
    shares: pos.shares ?? null,
    pctFromEntry: num(pctFromEntry),
    stop: {
      price: r2(stop), planned, plannedPrice: pos.stopPlan ?? null, cap: r2(cap),
      pctAway: price > 0 ? r2(((price - stop) / price) * 100) : null, atrAway: at(stop),
      ...stopCheck,
    },
    levels,
    atr14: num(atr),
    atrPct: price > 0 ? num((atr / price) * 100) : null,
    sma: { sma5: ma(5), sma10: ma(10), sma20: ma(20), sma50: ma(50), sma200: ma(200) },
    ema: { ema10: { value: num(ema10), atr: at(ema10) }, ema20: { value: num(ema20), atr: at(ema20) } },
    extensionAtr: num(ext),
    trail: { period: tp, ma: num(trailMa), atrAbove: at(trailMa), below: trailMa != null ? price < trailMa : null },
    trimPctAtVix: vixTrimPct(input.vix?.level ?? null),
    kell: { stage, setups: hits },
    vwap: vwap != null ? { value: r2(vwap), pct: r2(((price - vwap) / vwap) * 100), above: price > vwap } : null,
    relVolume: avgVol > 0 ? r2(todayVol / (avgVol * frac)) : null,
    velocity: {
      roc1Atr: num(roc1), roc3Atr: num(roc3), roc5Atr: num(roc5), roc10Atr: num(roc10),
      accelAtr: roc3 != null && roc3Before != null ? r2(roc3 - roc3Before) : null,
      gapAtr: open && prevClose && atr > 0 ? r2((open - prevClose) / atr) : null,
      intradayAtr: open && atr > 0 ? r2((price - open) / atr) : null,
      intradayVsNormal: open && bodyAvg > 0 ? r2(Math.abs(price - open) / bodyAvg) : null,
      rangeAtr: atr > 0 ? r2((dayHigh - dayLow) / atr) : null,
      roc3Z: num(unusual.z),
      roc3Pctile: unusual.pctile,
    },
    rs: {
      dayChangePct: num(dayChange),
      vsSpyToday: spy?.changePct != null && dayChange != null ? r2(dayChange - spy.changePct) : null,
      vsQqqToday: qqq?.changePct != null && dayChange != null ? r2(dayChange - qqq.changePct) : null,
      vsSpy20d: rel(input.spy?.bars, input.spy?.price, 20),
      vsQqq20d: rel(input.qqq?.bars, input.qqq?.price, 20),
    },
    regime: { vix: input.vix?.level ?? null, vixChange: input.vix?.change ?? null, spy, qqq, breadth: null },
    earnings: input.earningsDate ? { date: input.earningsDate, days: daysToEarnings } : null,
    signals,
  };
}
export type PositionSnapshot = ReturnType<typeof buildSnapshot>;

export const MATERIAL = {
  threshold: 40,
  signal: { "stop:breach": 100, "stop:warn": 45, level_break: 40, trim: 50, trail: 50, wedge_drop: 45 } as Record<string, number>,
  newSetup: 30,
  stageChange: 20,
  velocityZ: [{ z: 3, score: 40 }, { z: 2, score: 25 }],
  accelAtr: 2,
  accelScore: 15,
  vixJumpPct: 10,
  regimeScore: 20,
  rsFlip: 1.5,
  rsScore: 10,
  earningsDays: 3,
  earningsScore: 15,
};

const zBucket = (z: number | null) => (z == null ? 0 : Math.sign(z) * Math.min(4, Math.floor(Math.abs(z))));

/** How much the situation changed since the last snapshot (0..), why, and a fingerprint of the situation: the same
 *  fingerprint twice in a day is the same situation, so it is not sent again. */
export function materialChange(prev: PositionSnapshot | null, cur: PositionSnapshot, params = MATERIAL) {
  const reasons: string[] = [];
  let score = 0;
  const bump = (s: number, why: string) => { score += s; reasons.push(why); };
  const had = new Set((prev?.signals ?? []).map((s) => `${s.rule}:${s.level}`));
  for (const s of cur.signals) {
    const id = `${s.rule}:${s.level}`;
    if (!had.has(id)) bump(params.signal[id] ?? params.signal[s.rule] ?? 30, `new signal ${id}`);
  }
  const hadSetups = new Set((prev?.kell.setups ?? []).map((h) => h.name));
  for (const h of cur.kell.setups) if (!hadSetups.has(h.name)) bump(params.newSetup, `Kell ${h.name}${h.confirmed ? "" : " (forming)"}`);
  if (prev && prev.kell.stage !== cur.kell.stage) bump(params.stageChange, `stage ${prev.kell.stage} → ${cur.kell.stage}`);
  const z = cur.velocity.roc3Z;
  if (z != null && zBucket(z) !== zBucket(prev?.velocity.roc3Z ?? null)) {
    const step = params.velocityZ.find((v) => Math.abs(z) >= v.z);
    if (step) bump(step.score, `3-day move ${z.toFixed(1)} sd from its norm`);
  }
  const acc = cur.velocity.accelAtr;
  if (acc != null && Math.abs(acc) >= params.accelAtr && Math.abs(prev?.velocity.accelAtr ?? 0) < params.accelAtr) {
    bump(params.accelScore, `velocity ${acc > 0 ? "accelerating" : "decelerating"} ${acc.toFixed(1)} ATR`);
  }
  const vixChg = cur.regime.vixChange, vix = cur.regime.vix;
  if (vix != null && vixChg != null && vix - vixChg > 0 && (vixChg / (vix - vixChg)) * 100 >= params.vixJumpPct &&
      !(prev?.regime.vixChange != null && prev.regime.vix != null && prev.regime.vix - prev.regime.vixChange > 0 &&
        (prev.regime.vixChange / (prev.regime.vix - prev.regime.vixChange)) * 100 >= params.vixJumpPct)) {
    bump(params.regimeScore, `VIX up ${((vixChg / (vix - vixChg)) * 100).toFixed(0)}% today`);
  }
  for (const k of ["spy", "qqq"] as const) {
    const a = prev?.regime[k]?.aboveSma20, b = cur.regime[k]?.aboveSma20;
    if (a != null && b != null && a !== b) bump(params.regimeScore, `${k.toUpperCase()} ${b ? "back above" : "lost"} its 20-day`);
  }
  const rsA = prev?.rs.vsQqqToday, rsB = cur.rs.vsQqqToday;
  if (rsA != null && rsB != null && Math.sign(rsA) !== Math.sign(rsB) && Math.abs(rsB) >= params.rsFlip) {
    bump(params.rsScore, `${rsB > 0 ? "now leading" : "now lagging"} QQQ by ${Math.abs(rsB).toFixed(1)} pts`);
  }
  const ed = cur.earnings?.days;
  if (ed != null && ed >= 0 && ed <= params.earningsDays && !(prev?.earnings?.days != null && prev.earnings.days <= params.earningsDays)) {
    bump(params.earningsScore, `earnings in ${ed} day${ed === 1 ? "" : "s"}`);
  }
  const fingerprint = [
    ...cur.signals.map((s) => `${s.rule}:${s.level}`).sort(),
    ...cur.kell.setups.map((h) => h.name).sort(),
    `stage:${cur.kell.stage}`,
    `z:${zBucket(z)}`,
    `spy20:${cur.regime.spy?.aboveSma20 ?? "?"}`,
    `qqq20:${cur.regime.qqq?.aboveSma20 ?? "?"}`,
  ].join("|");
  return { score, reasons, fingerprint, material: score >= params.threshold };
}
