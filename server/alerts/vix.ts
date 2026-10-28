/**
 * VIX level for the trim ladder and the regime. Alpaca has no index quotes, so this reads Cboe's public delayed quote
 * (free, no key, about 15 minutes behind; a trim size doesn't need it fresher). Cached; on a failed read the last good
 * value is kept for up to STALE_MS, after that trim alerts go out without a size.
 */
const CBOE_VIX_URL = "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json";
const FRESH_MS = 5 * 60_000;
const STALE_MS = 6 * 60 * 60_000;
const TIMEOUT_MS = 5_000;

export interface VixReading {
  level: number;
  change: number | null;
}

let cached: { value: VixReading; at: number } | null = null;
let lastTry = 0;

export function parseCboeVix(body: unknown): VixReading | null {
  const data = (body as { data?: { current_price?: unknown; close?: unknown; price_change?: unknown } } | null)?.data;
  const level = Number(data?.current_price ?? data?.close);
  if (!Number.isFinite(level) || level <= 0 || level >= 200) return null;
  const change = Number(data?.price_change);
  return { level, change: Number.isFinite(change) ? change : null };
}

export async function getVix(now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<VixReading | null> {
  if (cached && now - cached.at < FRESH_MS) return cached.value;
  if (now - lastTry >= 60_000) {
    lastTry = now;
    try {
      const res = await fetchImpl(CBOE_VIX_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const v = res.ok ? parseCboeVix(await res.json()) : null;
      if (v != null) cached = { value: v, at: now };
    } catch (error) {
      console.warn("[PositionAlerts] VIX read failed:", error instanceof Error ? error.message : error);
    }
  }
  return cached && now - cached.at < STALE_MS ? cached.value : null;
}
