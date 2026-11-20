/**
 * The real Cboe VIX index, from FMP (the key already in use; read-only, one quote call a minute at most).
 *
 * Found 20 Nov 2026: FMP /stable/quote?symbol=^VIX and /stable/historical-price-eod/light?symbol=^VIX serve it.
 * Finnhub does not (quote: "Market data subscription required for CFD indices"; VIX / CBOE:VIX return zeros). Alpaca
 * snapshots do not carry indices. Until now the app only had ETFs (VIXY, UVXY) and called one of them "VIX".
 *
 * Where it is used:
 *   - the header tile (/api/market/indicators): the real VIX when FMP answers, else VIXY, and the tile says which;
 *   - the regime score's volatility part and Sentinel's risk basket: only when REAL_VIX_FOR_SCORES=1 (off by default).
 *     Turning it on changes the input from today forward (stored readings are not touched): the volatility part then
 *     uses the VIX's own day change in the same formula it applied to UVXY's, which moves less than UVXY, so scores
 *     will read differently. PM's word first.
 *   - the market card: its rules are built on the VIXY proxy and its rows are stored, so they stay; GET
 *     /api/market-condition/setups/vix shows the real VIX beside the proxy.
 * The proxy is always the fallback: any failure here returns null and the caller keeps what it had.
 */

export type VolSource = "VIX" | "VIXY";

export interface RealVixQuote {
  price: number;
  changePct: number;
  previousClose: number | null;
  asOf: string; // ISO time
  source: "Cboe VIX via FMP";
}

const QUOTE_TTL_MS = 60_000;
const CLOSES_TTL_MS = 30 * 60_000;

let quoteCache: { at: number; value: RealVixQuote | null } = { at: 0, value: null };
let closesCache: { at: number; days: number; value: number[] | null } = { at: 0, days: 0, value: null };

export function realVixForScoresEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.REAL_VIX_FOR_SCORES ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/** FMP /stable/quote body -> quote, or null when the body is not a usable VIX row. */
export function parseVixQuote(body: unknown, now: Date = new Date()): RealVixQuote | null {
  const row: any = Array.isArray(body) ? body[0] : null;
  if (!row || typeof row !== "object") return null;
  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0 || price > 200) return null; // the VIX has never been above ~90
  const prev = Number(row.previousClose);
  const previousClose = Number.isFinite(prev) && prev > 0 ? prev : null;
  let changePct = Number(row.changePercentage ?? row.changesPercentage);
  if (!Number.isFinite(changePct)) changePct = previousClose ? ((price - previousClose) / previousClose) * 100 : NaN;
  if (!Number.isFinite(changePct)) return null;
  return { price, changePct, previousClose, asOf: now.toISOString(), source: "Cboe VIX via FMP" };
}

/** FMP /stable/historical-price-eod/light body (newest first) -> closes, newest first. null when too short or bad. */
export function parseVixCloses(body: unknown, minLength = 20): number[] | null {
  if (!Array.isArray(body)) return null;
  const rows = (body as any[])
    .filter((r) => r && typeof r.date === "string" && Number.isFinite(Number(r.price)) && Number(r.price) > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const closes = rows.map((r) => Number(r.price));
  return closes.length >= minLength ? closes : null;
}

async function fmpGet(path: string): Promise<unknown | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/${path}&apikey=${key}`, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function fetchRealVixQuote(): Promise<RealVixQuote | null> {
  if (Date.now() - quoteCache.at < QUOTE_TTL_MS) return quoteCache.value;
  const value = parseVixQuote(await fmpGet("quote?symbol=%5EVIX"));
  // A failed call keeps the last good value for a while rather than flapping to the proxy on one timeout.
  quoteCache = { at: Date.now(), value: value ?? (Date.now() - quoteCache.at < 10 * 60_000 ? quoteCache.value : null) };
  return quoteCache.value;
}

/** Closes newest first, at least `days` of them when the vendor has them. */
export async function fetchRealVixCloses(days = 30): Promise<number[] | null> {
  if (Date.now() - closesCache.at < CLOSES_TTL_MS && closesCache.days >= days) return closesCache.value?.slice(0, days) ?? null;
  const value = parseVixCloses(await fmpGet("historical-price-eod/light?symbol=%5EVIX"));
  closesCache = { at: Date.now(), days, value };
  return value?.slice(0, days) ?? null;
}

/** What the header tile shows. `proxy` is the VIXY tile the app used before; it is the fallback. */
export function vixTile(real: RealVixQuote | null, proxy: { price: number; changePercent: number }) {
  if (real) {
    return {
      symbol: "VIXY", // chart link keeps pointing at a symbol that has a chart
      label: "VIX",
      price: real.price,
      changePercent: Math.round(real.changePct * 100) / 100,
      source: real.source,
      isProxy: false,
    };
  }
  return { symbol: "VIXY", label: "VIXY", price: proxy.price, changePercent: proxy.changePercent, source: "VIXY ETF (proxy for the VIX)", isProxy: true };
}

export function resetVixCacheForTests(): void {
  quoteCache = { at: 0, value: null };
  closesCache = { at: 0, days: 0, value: null };
}
