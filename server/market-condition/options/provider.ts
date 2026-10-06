/**
 * Options Pulse v0 provider — read-only Alpaca OPRA chain snapshots + contracts open interest.
 *
 * Memory only: short-TTL in-process caches, no DB, no websocket, no universe sweep.
 * Only GET market-data / contract-reference endpoints are used — never trading endpoints.
 */

import { alpacaHeaders } from "../providers/alpaca";
import { getMarketSession } from "../universe";
import { getQuotesBatch } from "../../data-layer/quotes";
import { CallBudget, budgetLimitFromEnv } from "./budget";
import {
  compactSnapshot,
  computeOptionsPulse,
  parseOpenInterest,
  type CompactContract,
  type OpenInterestEntry,
  type OptionsPulse,
  type RawOptionContract,
  type RawOptionSnapshot,
} from "./pulse-math";

const ALPACA_DATA_URL = "https://data.alpaca.markets";

function tradingBaseUrl(): string {
  return process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets";
}

/** Data API allows 10k/min on this plan; options are capped well below and never above 1,000/min. */
export const dataBudget = new CallBudget(
  "options-data",
  budgetLimitFromEnv(process.env.MC_OPTIONS_DATA_CALLS_PER_MIN, 300, 1000)
);
/** Contracts (OI) live on the trading API, which has a shared 200/min account limit. */
export const tradingBudget = new CallBudget(
  "options-contracts",
  budgetLimitFromEnv(process.env.MC_OPTIONS_CONTRACT_CALLS_PER_MIN, 30, 60)
);

export type PulseProfile = "stock" | "index";

const PROFILES: Record<PulseProfile, { maxDte: number; strikeBandPct: number; maxPages: number }> = {
  stock: { maxDte: 30, strikeBandPct: 15, maxPages: 5 },
  index: { maxDte: 14, strikeBandPct: 8, maxPages: 8 },
};

const OI_GROUP_SIZE = 15;
const OI_MAX_PAGES_PER_GROUP = 3;
const CHAIN_CONCURRENCY = 3;
const PULSE_CACHE_MAX = 300;
const OI_CACHE_MAX = 120;
export const MAX_BATCH_SYMBOLS = 80;

function pulseTtlMs(): number {
  return getMarketSession() === "MARKET_HOURS" ? 5 * 60_000 : 15 * 60_000;
}
const OI_TTL_MS = 15 * 60_000;
const REGIME_TTL_MS = 5 * 60_000;

export function todayEt(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface CallCounter {
  data: number;
  trading: number;
}

async function optionsGet(url: string, kind: "data" | "trading", counter: CallCounter): Promise<any> {
  const budget = kind === "data" ? dataBudget : tradingBudget;
  for (let attempt = 0; attempt < 2; attempt++) {
    budget.take();
    counter[kind]++;
    const resp = await fetch(url, { headers: alpacaHeaders() });
    if (resp.ok) return resp.json();
    const retryable = resp.status === 429 || resp.status >= 500;
    const text = (await resp.text()).slice(0, 200);
    if (!retryable || attempt === 1) {
      throw new Error(`Alpaca options ${kind} ${resp.status}: ${text}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("unreachable");
}

// -----------------------------------------------------------------------------
// Caches (memory only)
// -----------------------------------------------------------------------------

interface Expiring<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

function capMap<T>(map: Map<string, Expiring<T>>, max: number, now = Date.now()): void {
  for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest == null) break;
    map.delete(oldest);
  }
}

const pulseCache = new Map<string, Expiring<OptionsPulse>>();
const oiCache = new Map<string, Expiring<Map<string, OpenInterestEntry>>>();
const inflight = new Map<string, Promise<OptionsPulseBatchResult>>();
let regimeCache: Expiring<OptionsRegimeResult> | null = null;
let regimeInflight: Promise<OptionsRegimeResult> | null = null;

function pulseKey(profile: PulseProfile, includeOi: boolean, symbol: string): string {
  return `${profile}|${includeOi ? 1 : 0}|${symbol}`;
}

// -----------------------------------------------------------------------------
// Fetchers
// -----------------------------------------------------------------------------

async function fetchChain(
  symbol: string,
  spot: number,
  profile: PulseProfile,
  today: string,
  counter: CallCounter
): Promise<{ contracts: CompactContract[]; truncated: boolean }> {
  const { maxDte, strikeBandPct, maxPages } = PROFILES[profile];
  const band = strikeBandPct / 100;
  const params = new URLSearchParams({
    feed: "opra",
    limit: "1000",
    expiration_date_gte: today,
    expiration_date_lte: addDays(today, maxDte),
    strike_price_gte: (spot * (1 - band)).toFixed(2),
    strike_price_lte: (spot * (1 + band)).toFixed(2),
  });
  const contracts: CompactContract[] = [];
  let pageToken: string | null = null;
  let pages = 0;
  do {
    if (pageToken) params.set("page_token", pageToken);
    const url = `${ALPACA_DATA_URL}/v1beta1/options/snapshots/${encodeURIComponent(symbol)}?${params}`;
    const body = await optionsGet(url, "data", counter);
    pages++;
    const snaps = (body?.snapshots ?? {}) as Record<string, RawOptionSnapshot>;
    for (const [occ, snap] of Object.entries(snaps)) {
      const c = compactSnapshot(occ, snap);
      if (c) contracts.push(c);
    }
    pageToken = typeof body?.next_page_token === "string" && body.next_page_token ? body.next_page_token : null;
  } while (pageToken && pages < maxPages);
  return { contracts, truncated: pageToken != null };
}

/** OI per contract for a group of underlyings (one paged call per group). */
async function fetchOpenInterest(
  underlyings: string[],
  profile: PulseProfile,
  today: string,
  counter: CallCounter,
  strikeBand?: { gte: number; lte: number }
): Promise<Map<string, Map<string, OpenInterestEntry>>> {
  const out = new Map<string, Map<string, OpenInterestEntry>>();
  for (const u of underlyings) out.set(u, new Map());
  const params = new URLSearchParams({
    underlying_symbols: underlyings.join(","),
    expiration_date_gte: today,
    expiration_date_lte: addDays(today, PROFILES[profile].maxDte),
    limit: "10000",
  });
  if (strikeBand) {
    params.set("strike_price_gte", strikeBand.gte.toFixed(2));
    params.set("strike_price_lte", strikeBand.lte.toFixed(2));
  }
  let pageToken: string | null = null;
  let pages = 0;
  do {
    if (pageToken) params.set("page_token", pageToken);
    const body = await optionsGet(`${tradingBaseUrl()}/v2/options/contracts?${params}`, "trading", counter);
    pages++;
    for (const raw of (body?.option_contracts ?? []) as RawOptionContract[]) {
      const u = (raw.underlying_symbol ?? "").toUpperCase();
      const bucket = out.get(u);
      if (bucket) bucket.set(raw.symbol, parseOpenInterest(raw));
    }
    pageToken = typeof body?.next_page_token === "string" && body.next_page_token ? body.next_page_token : null;
  } while (pageToken && pages < OI_MAX_PAGES_PER_GROUP);
  return out;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export interface OptionsPulseBatchResult {
  pulses: Record<string, OptionsPulse>;
  errors: Record<string, string>;
  apiCalls: CallCounter;
  fromCache: number;
}

async function runBatch(
  symbols: string[],
  profile: PulseProfile,
  includeOi: boolean
): Promise<OptionsPulseBatchResult> {
  const now = Date.now();
  const today = todayEt();
  const session = getMarketSession();
  const counter: CallCounter = { data: 0, trading: 0 };
  const pulses: Record<string, OptionsPulse> = {};
  const errors: Record<string, string> = {};
  let fromCache = 0;

  const missing: string[] = [];
  for (const s of symbols) {
    const hit = pulseCache.get(pulseKey(profile, includeOi, s));
    if (hit && hit.expiresAt > now) {
      pulses[s] = hit.value;
      fromCache++;
    } else {
      missing.push(s);
    }
  }
  if (missing.length === 0) return { pulses, errors, apiCalls: counter, fromCache };

  const quotes = await getQuotesBatch(missing).catch(() => new Map());
  const spots = new Map<string, number>();
  for (const s of missing) {
    const p = quotes.get(s)?.price;
    if (typeof p === "number" && p > 0) spots.set(s, p);
    else errors[s] = "No underlying price available";
  }
  const priced = missing.filter((s) => spots.has(s));

  const oiBySymbol = new Map<string, Map<string, OpenInterestEntry>>();
  if (includeOi) {
    const needOi: string[] = [];
    for (const s of priced) {
      const hit = oiCache.get(`${profile}|${s}`);
      if (hit && hit.expiresAt > now) oiBySymbol.set(s, hit.value);
      else needOi.push(s);
    }
    for (let i = 0; i < needOi.length; i += OI_GROUP_SIZE) {
      const group = needOi.slice(i, i + OI_GROUP_SIZE);
      const band = PROFILES[profile].strikeBandPct / 100;
      const strikeBand =
        group.length === 1
          ? { gte: spots.get(group[0])! * (1 - band), lte: spots.get(group[0])! * (1 + band) }
          : undefined;
      try {
        const res = await fetchOpenInterest(group, profile, today, counter, strikeBand);
        for (const [u, m] of res) {
          oiBySymbol.set(u, m);
          oiCache.set(`${profile}|${u}`, { value: m, expiresAt: now + OI_TTL_MS, storedAt: now });
        }
      } catch (err) {
        console.warn(`[OptionsPulse] OI fetch failed for ${group.length} underlyings: ${(err as Error).message}`);
      }
    }
    capMap(oiCache, OI_CACHE_MAX);
  }

  await mapWithConcurrency(priced, CHAIN_CONCURRENCY, async (s) => {
    const spot = spots.get(s)!;
    const symCounter: CallCounter = { data: 0, trading: 0 };
    try {
      const { contracts, truncated } = await fetchChain(s, spot, profile, today, symCounter);
      const pulse = computeOptionsPulse({
        symbol: s,
        spot,
        contracts,
        openInterest: includeOi ? oiBySymbol.get(s) ?? new Map() : undefined,
        today,
        session,
        scope: { maxDte: PROFILES[profile].maxDte, strikeBandPct: PROFILES[profile].strikeBandPct, truncated },
        apiCalls: symCounter,
      });
      pulses[s] = pulse;
      pulseCache.set(pulseKey(profile, includeOi, s), {
        value: pulse,
        expiresAt: Date.now() + pulseTtlMs(),
        storedAt: Date.now(),
      });
    } catch (err) {
      errors[s] = (err as Error).message;
    } finally {
      counter.data += symCounter.data;
      counter.trading += symCounter.trading;
    }
  });
  capMap(pulseCache, PULSE_CACHE_MAX);

  console.log(
    `[OptionsPulse] ${profile} batch: ${symbols.length} symbols (${fromCache} cached), ` +
      `${counter.data} data + ${counter.trading} contracts calls`
  );
  return { pulses, errors, apiCalls: counter, fromCache };
}

export function getOptionsPulseBatch(
  rawSymbols: string[],
  opts: { profile?: PulseProfile; includeOi?: boolean } = {}
): Promise<OptionsPulseBatchResult> {
  const profile = opts.profile ?? "stock";
  const includeOi = opts.includeOi ?? true;
  const symbols = Array.from(
    new Set(rawSymbols.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z][A-Z0-9.]{0,9}$/.test(s)))
  ).slice(0, MAX_BATCH_SYMBOLS);
  const key = `${profile}|${includeOi ? 1 : 0}|${[...symbols].sort().join(",")}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = runBatch(symbols, profile, includeOi).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function getOptionsPulse(symbol: string): Promise<{ pulse: OptionsPulse | null; error: string | null; apiCalls: CallCounter }> {
  const upper = symbol.toUpperCase();
  const res = await getOptionsPulseBatch([upper]);
  return { pulse: res.pulses[upper] ?? null, error: res.errors[upper] ?? null, apiCalls: res.apiCalls };
}

export const REGIME_SYMBOLS = ["SPY", "QQQ", "IWM"] as const;

export interface OptionsRegimeItem {
  symbol: string;
  pcVolumeRatio: number | null;
  atmIv: number | null;
  atmExpiration: string | null;
  expectedMovePct: number | null;
  callVolume: number;
  putVolume: number;
  volumeDate: string | null;
  error?: string;
}

export interface OptionsRegimeResult {
  items: OptionsRegimeItem[];
  fetchedAt: string;
  nextRefreshAt: string;
  session: string;
  scope: { maxDte: number; strikeBandPct: number };
  apiCalls: CallCounter;
}

/** SPY / QQQ / IWM tile for marketHealth; refreshed no faster than every 5 minutes. */
export function getOptionsRegime(): Promise<OptionsRegimeResult> {
  const now = Date.now();
  if (regimeCache && regimeCache.expiresAt > now) return Promise.resolve(regimeCache.value);
  if (regimeInflight) return regimeInflight;
  regimeInflight = (async () => {
    const res = await getOptionsPulseBatch([...REGIME_SYMBOLS], { profile: "index", includeOi: false });
    const fetchedAt = new Date();
    const value: OptionsRegimeResult = {
      items: REGIME_SYMBOLS.map((s) => {
        const p = res.pulses[s];
        return {
          symbol: s,
          pcVolumeRatio: p?.pcVolumeRatio ?? null,
          atmIv: p?.atm.iv ?? null,
          atmExpiration: p?.atm.expiration ?? null,
          expectedMovePct: p?.atm.expectedMovePct ?? null,
          callVolume: p?.callVolume ?? 0,
          putVolume: p?.putVolume ?? 0,
          volumeDate: p?.volumeDate ?? null,
          ...(res.errors[s] ? { error: res.errors[s] } : {}),
        };
      }),
      fetchedAt: fetchedAt.toISOString(),
      nextRefreshAt: new Date(fetchedAt.getTime() + REGIME_TTL_MS).toISOString(),
      session: getMarketSession(),
      scope: { maxDte: PROFILES.index.maxDte, strikeBandPct: PROFILES.index.strikeBandPct },
      apiCalls: res.apiCalls,
    };
    regimeCache = { value, expiresAt: fetchedAt.getTime() + REGIME_TTL_MS, storedAt: fetchedAt.getTime() };
    return value;
  })().finally(() => {
    regimeInflight = null;
  });
  return regimeInflight;
}

export function getOptionsBudgetStats() {
  return {
    data: dataBudget.stats(),
    contracts: tradingBudget.stats(),
    cache: { pulses: pulseCache.size, oiUnderlyings: oiCache.size, regimeCached: regimeCache != null },
  };
}
