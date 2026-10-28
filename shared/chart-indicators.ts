/**
 * The chart's indicator math, shared by MiniChart (Start Here / Anima charts panels) and the server's alerts, so an
 * alert says exactly what the chart shows. Series functions take bars oldest first and return one value per bar
 * (null until the window is full).
 */

export type CloseBar = { close: number };
export type HlcBar = { high: number; low: number; close: number };
export type VwapBar = { date: string; high: number; low: number; close: number; volume: number };

export function sessionDateKeyEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function calculateSMA(data: CloseBar[], period: number): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((acc, d) => acc + d.close, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

/** Seeded with the SMA of the first `period` closes. */
export function calculateEMA(data: CloseBar[], period: number): (number | null)[] {
  const ema: (number | null)[] = [];
  const multiplier = 2 / (period + 1);
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      ema.push(null);
    } else if (i === period - 1) {
      const sum = data.slice(0, period).reduce((acc, d) => acc + d.close, 0);
      ema.push(sum / period);
    } else {
      const prevEma = ema[i - 1];
      ema.push(prevEma !== null ? (data[i].close - prevEma) * multiplier + prevEma : null);
    }
  }
  return ema;
}

/** Simple average of true range over `period` bars (not Wilder smoothing). */
export function calculateAtr(data: HlcBar[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let trSum = 0;
  const trWindow: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const cur = data[i];
    const prevClose = i > 0 ? data[i - 1].close : cur.close;
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));
    trWindow.push(tr);
    trSum += tr;
    if (trWindow.length > period) {
      trSum -= trWindow.shift() ?? 0;
    }
    out.push(trWindow.length === period ? trSum / period : null);
  }
  return out;
}

/** Cumulative session VWAP (typical price × volume); resets each ET session. Bars without a usable price or volume
 *  carry the session's VWAP so far. */
export function calculateSessionVwap(bars: VwapBar[]): (number | null)[] {
  let cumPv = 0;
  let cumVol = 0;
  let sessionKey: string | null = null;
  const out: (number | null)[] = [];
  for (const bar of bars) {
    const key = sessionDateKeyEt(bar.date);
    if (key !== sessionKey) {
      sessionKey = key;
      cumPv = 0;
      cumVol = 0;
    }
    const h = Number(bar.high);
    const l = Number(bar.low);
    const c = Number(bar.close);
    const v = Number(bar.volume);
    if (![h, l, c, v].every(Number.isFinite) || v <= 0) {
      out.push(cumVol > 0 ? cumPv / cumVol : null);
      continue;
    }
    cumPv += ((h + l + c) / 3) * v;
    cumVol += v;
    out.push(cumVol > 0 ? cumPv / cumVol : null);
  }
  return out;
}

export const EXTENSION_MA_PERIOD = 50;
export const EXTENSION_ATR_PERIOD = 14;

/** (price − MA) / ATR14 on daily bars: how many ATRs price sits above (or below) the moving average. */
export function atrMultipleFromMa(
  price: number,
  dailyBars: HlcBar[],
  maPeriod: number,
  maType: "sma" | "ema" = "sma",
): number | null {
  if (!Number.isFinite(price) || price <= 0 || !dailyBars.length) return null;
  const i = dailyBars.length - 1;
  const ma = (maType === "ema" ? calculateEMA(dailyBars, maPeriod) : calculateSMA(dailyBars, maPeriod))[i];
  const atr = calculateAtr(dailyBars, EXTENSION_ATR_PERIOD)[i];
  return ma != null && atr != null && atr > 0 ? (price - ma) / atr : null;
}

/** The chart info box's "ATRx from 50MA": (price − SMA50) / ATR14 on daily bars. */
export function atrxFrom50(price: number, dailyBars: HlcBar[]): number | null {
  return atrMultipleFromMa(price, dailyBars, EXTENSION_MA_PERIOD, "sma");
}

/** The chart info box: % from entry, % from the 200-day SMA and ATRx from 50MA. */
export function chartInfoSnapshot(
  price: number,
  dailyBars: HlcBar[],
  entryPrice: number | null,
): { pctFromEntry: number | null; pctFrom200Dma: number | null; adrsFrom50: number | null } | null {
  if (!dailyBars.length || !Number.isFinite(price) || price <= 0) return null;
  const s200 = calculateSMA(dailyBars, 200)[dailyBars.length - 1];
  return {
    pctFromEntry: entryPrice != null ? ((price - entryPrice) / entryPrice) * 100 : null,
    pctFrom200Dma: s200 != null && s200 > 0 ? ((price - s200) / s200) * 100 : null,
    adrsFrom50: atrxFrom50(price, dailyBars),
  };
}
