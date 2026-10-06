/**
 * Options Pulse v0 — pure reducers over Alpaca OPRA chain snapshots + contracts OI.
 * No I/O here so the math can be unit-tested against small fixtures.
 */

export interface RawOptionBar {
  t?: string;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
  vw?: number;
  n?: number;
}

export interface RawOptionSnapshot {
  latestQuote?: { bp?: number; ap?: number; bs?: number; as?: number; t?: string };
  latestTrade?: { p?: number; s?: number; t?: string };
  dailyBar?: RawOptionBar;
  prevDailyBar?: RawOptionBar;
  minuteBar?: RawOptionBar;
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number };
  impliedVolatility?: number;
}

export interface RawOptionContract {
  symbol: string;
  underlying_symbol?: string;
  open_interest?: string | number | null;
  open_interest_date?: string | null;
}

/** Compact per-contract record kept after a page is parsed (raw JSON is dropped). */
export interface CompactContract {
  symbol: string;
  expiration: string;
  type: "call" | "put";
  strike: number;
  volume: number;
  vwap: number | null;
  barDate: string | null;
  bid: number | null;
  ask: number | null;
  iv: number | null;
}

export interface OpenInterestEntry {
  oi: number | null;
  date: string | null;
}

export interface OptionsPulseScope {
  maxDte: number;
  strikeBandPct: number;
  expirations: number;
  contracts: number;
  truncated: boolean;
}

export interface OptionsPulseAtm {
  expiration: string | null;
  dte: number | null;
  strike: number | null;
  callIv: number | null;
  putIv: number | null;
  iv: number | null;
  straddleMid: number | null;
  expectedMove: number | null;
  expectedMovePct: number | null;
}

export interface OptionsPulseOpenInterest {
  total: number | null;
  contractsWithOi: number;
  coveragePct: number;
  asOfDate: string | null;
  label: string;
}

export interface OptionsPulse {
  symbol: string;
  spot: number | null;
  fetchedAt: string;
  session: string | null;
  scope: OptionsPulseScope;
  volumeDate: string | null;
  callVolume: number;
  putVolume: number;
  totalVolume: number;
  pcVolumeRatio: number | null;
  callPremium: number;
  putPremium: number;
  callPremiumSharePct: number | null;
  openInterest: OptionsPulseOpenInterest | null;
  volumeVsOi: number | null;
  atm: OptionsPulseAtm;
  ivCoveragePct: number;
  apiCalls: { data: number; trading: number };
  error?: string;
}

const OCC_RE = /^([A-Z0-9.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export function parseOccSymbol(
  symbol: string
): { root: string; expiration: string; type: "call" | "put"; strike: number } | null {
  const m = OCC_RE.exec(symbol);
  if (!m) return null;
  const [, root, yy, mm, dd, cp, strikeRaw] = m;
  return {
    root,
    expiration: `20${yy}-${mm}-${dd}`,
    type: cp === "C" ? "call" : "put",
    strike: Number(strikeRaw) / 1000,
  };
}

function finitePositive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export function compactSnapshot(symbol: string, snap: RawOptionSnapshot): CompactContract | null {
  const parsed = parseOccSymbol(symbol);
  if (!parsed) return null;
  const bar = snap.dailyBar;
  const volume = typeof bar?.v === "number" && bar.v > 0 ? bar.v : 0;
  return {
    symbol,
    expiration: parsed.expiration,
    type: parsed.type,
    strike: parsed.strike,
    volume,
    vwap: finitePositive(bar?.vw) ?? finitePositive(bar?.c),
    barDate: bar?.t ? bar.t.slice(0, 10) : null,
    bid: finitePositive(snap.latestQuote?.bp),
    ask: finitePositive(snap.latestQuote?.ap),
    iv: finitePositive(snap.impliedVolatility),
  };
}

export function parseOpenInterest(raw: RawOptionContract): OpenInterestEntry {
  const v = raw.open_interest;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return {
    oi: Number.isFinite(n) && n >= 0 ? n : null,
    date: raw.open_interest_date ?? null,
  };
}

/** P/C volume ratio; null when there is no call volume to divide by. */
export function putCallRatio(callVolume: number, putVolume: number): number | null {
  if (!(callVolume > 0)) return null;
  return putVolume / callVolume;
}

/** Premium in dollars: contracts × average price × 100 multiplier. */
export function contractPremium(volume: number, avgPrice: number | null): number {
  if (!(volume > 0) || avgPrice == null) return 0;
  return volume * avgPrice * 100;
}

export function formatOiAsOfLabel(date: string | null): string {
  return date ? `OI as of ${date}` : "OI date n/a";
}

/** Calendar days between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86_400_000);
}

function mode(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = -1;
  for (const [v, n] of counts) {
    if (n > bestN || (n === bestN && best != null && v > best)) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function mid(c: CompactContract | undefined): number | null {
  if (!c || c.bid == null || c.ask == null || c.ask < c.bid) return null;
  return (c.bid + c.ask) / 2;
}

/**
 * ATM read from the nearest expiry with DTE ≥ 1 (same-day expiry is skipped because its
 * straddle collapses toward intrinsic late in the session). Falls back to DTE 0 if that is all there is.
 */
export function computeAtm(contracts: CompactContract[], spot: number | null, today: string): OptionsPulseAtm {
  const empty: OptionsPulseAtm = {
    expiration: null,
    dte: null,
    strike: null,
    callIv: null,
    putIv: null,
    iv: null,
    straddleMid: null,
    expectedMove: null,
    expectedMovePct: null,
  };
  if (spot == null || !(spot > 0) || contracts.length === 0) return empty;

  const expirations = Array.from(new Set(contracts.map((c) => c.expiration)))
    .filter((e) => daysBetween(today, e) >= 0)
    .sort();
  const expiration = expirations.find((e) => daysBetween(today, e) >= 1) ?? expirations[0];
  if (!expiration) return empty;

  const byStrike = new Map<number, { call?: CompactContract; put?: CompactContract }>();
  for (const c of contracts) {
    if (c.expiration !== expiration) continue;
    const slot = byStrike.get(c.strike) ?? {};
    slot[c.type] = c;
    byStrike.set(c.strike, slot);
  }
  let strike: number | null = null;
  for (const [k, slot] of byStrike) {
    if (!slot.call || !slot.put) continue;
    if (strike == null || Math.abs(k - spot) < Math.abs(strike - spot)) strike = k;
  }
  if (strike == null) return { ...empty, expiration, dte: daysBetween(today, expiration) };

  const { call, put } = byStrike.get(strike)!;
  const callIv = call?.iv ?? null;
  const putIv = put?.iv ?? null;
  const ivs = [callIv, putIv].filter((v): v is number => v != null);
  const iv = ivs.length > 0 ? ivs.reduce((s, v) => s + v, 0) / ivs.length : null;
  const callMid = mid(call);
  const putMid = mid(put);
  const straddleMid = callMid != null && putMid != null ? callMid + putMid : null;

  return {
    expiration,
    dte: daysBetween(today, expiration),
    strike,
    callIv,
    putIv,
    iv,
    straddleMid,
    expectedMove: straddleMid,
    expectedMovePct: straddleMid != null ? (straddleMid / spot) * 100 : null,
  };
}

export interface ComputePulseInput {
  symbol: string;
  spot: number | null;
  contracts: CompactContract[];
  /** Omit (undefined) when OI was not requested; the pulse then reports openInterest = null. */
  openInterest?: Map<string, OpenInterestEntry>;
  today: string;
  scope: Omit<OptionsPulseScope, "expirations" | "contracts">;
  session?: string | null;
  fetchedAt?: string;
  apiCalls?: { data: number; trading: number };
}

export function computeOptionsPulse(input: ComputePulseInput): OptionsPulse {
  const { contracts } = input;
  let callVolume = 0;
  let putVolume = 0;
  let callPremium = 0;
  let putPremium = 0;
  let withIv = 0;
  const barDates: string[] = [];

  for (const c of contracts) {
    if (c.iv != null) withIv++;
    if (c.volume > 0 && c.barDate) barDates.push(c.barDate);
    const premium = contractPremium(c.volume, c.vwap);
    if (c.type === "call") {
      callVolume += c.volume;
      callPremium += premium;
    } else {
      putVolume += c.volume;
      putPremium += premium;
    }
  }

  const totalVolume = callVolume + putVolume;
  const totalPremium = callPremium + putPremium;

  let openInterest: OptionsPulseOpenInterest | null = null;
  let volumeVsOi: number | null = null;
  if (input.openInterest) {
    let total = 0;
    let withOi = 0;
    const dates: string[] = [];
    for (const c of contracts) {
      const entry = input.openInterest.get(c.symbol);
      if (!entry || entry.oi == null) continue;
      total += entry.oi;
      withOi++;
      if (entry.date) dates.push(entry.date);
    }
    const asOfDate = mode(dates);
    openInterest = {
      total: withOi > 0 ? total : null,
      contractsWithOi: withOi,
      coveragePct: contracts.length > 0 ? (withOi / contracts.length) * 100 : 0,
      asOfDate,
      label: formatOiAsOfLabel(asOfDate),
    };
    volumeVsOi = withOi > 0 && total > 0 ? totalVolume / total : null;
  }

  return {
    symbol: input.symbol,
    spot: input.spot,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    session: input.session ?? null,
    scope: {
      ...input.scope,
      expirations: new Set(contracts.map((c) => c.expiration)).size,
      contracts: contracts.length,
    },
    volumeDate: mode(barDates),
    callVolume,
    putVolume,
    totalVolume,
    pcVolumeRatio: putCallRatio(callVolume, putVolume),
    callPremium,
    putPremium,
    callPremiumSharePct: totalPremium > 0 ? (callPremium / totalPremium) * 100 : null,
    openInterest,
    volumeVsOi,
    atm: computeAtm(contracts, input.spot, input.today),
    ivCoveragePct: contracts.length > 0 ? (withIv / contracts.length) * 100 : 0,
    apiCalls: input.apiCalls ?? { data: 0, trading: 0 },
  };
}
