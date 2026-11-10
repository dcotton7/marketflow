/** The latest Schwab stream tick per symbol, and the latest one-minute bar. In memory, this instance only. */
export interface SchwabTick {
  symbol: string;
  last: number;
  bid: number | null;
  ask: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  netChange: number | null;
  volume: number | null;
  tradeTime: number | null;
  receivedAt: number;
}

export interface SchwabMinuteBar {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
}

export const FRESH_MS = 15_000;

const ticks = new Map<string, SchwabTick>();
const bars = new Map<string, SchwabMinuteBar>();
let lastTickAt: number | null = null;

/** LEVELONE updates carry only the fields that changed: merge onto the last tick. */
export function mergeTick(symbol: string, part: Partial<SchwabTick>, at = Date.now()): SchwabTick | null {
  const key = symbol.toUpperCase();
  const prev = ticks.get(key);
  const last = part.last ?? prev?.last;
  if (typeof last !== "number" || !(last > 0)) return null;
  const tick: SchwabTick = {
    symbol: key, last,
    bid: part.bid ?? prev?.bid ?? null, ask: part.ask ?? prev?.ask ?? null,
    open: part.open ?? prev?.open ?? null, high: part.high ?? prev?.high ?? null, low: part.low ?? prev?.low ?? null,
    prevClose: part.prevClose ?? prev?.prevClose ?? null, netChange: part.netChange ?? prev?.netChange ?? null,
    volume: part.volume ?? prev?.volume ?? null, tradeTime: part.tradeTime ?? prev?.tradeTime ?? null,
    receivedAt: at,
  };
  ticks.set(key, tick);
  lastTickAt = at;
  return tick;
}

export function setBar(bar: SchwabMinuteBar): void {
  bars.set(bar.symbol.toUpperCase(), bar);
}

export function freshTick(symbol: string, now = Date.now(), maxAge = FRESH_MS): SchwabTick | null {
  const t = ticks.get(symbol.toUpperCase());
  return t && now - t.receivedAt <= maxAge ? t : null;
}

export const latestBar = (symbol: string) => bars.get(symbol.toUpperCase()) ?? null;
export const lastQuoteAgeSec = (now = Date.now()) => (lastTickAt === null ? null : Math.round((now - lastTickAt) / 1000));

export function clearTicks(): void {
  ticks.clear();
  bars.clear();
  lastTickAt = null;
}
