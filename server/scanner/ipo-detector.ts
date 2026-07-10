// ---------------------------------------------------------------------------
// IPO Debut Detector
//
// Polls FMP's IPO calendar endpoint for recent and imminent IPOs.
// Fires ipo_debut signals for new listings that meet minimum market cap.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import type { Signal } from "@shared/scanner-types";
import { autoMapTickerToCluster } from "../market-condition/universe";

const FMP_API_KEY = process.env.FMP_API_KEY ?? "";
const FMP_BASE = "https://financialmodelingprep.com/stable";

const POLL_INTERVAL_MS = 30 * 60_000; // 30 minutes
const COOLDOWN_MS = 24 * 60 * 60_000; // 24 hours per symbol
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60_000; // 7 days

const seenIpos = new Map<string, number>();

interface FmpIpoEntry {
  symbol: string;
  company: string;
  exchange: string;
  actions: string;
  date: string;
  priceRange: string;
  shares: number;
  marketCap: number;
}

function dateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function pruneSeenIpos(): void {
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  for (const [k, ts] of seenIpos) {
    if (ts < cutoff) seenIpos.delete(k);
  }
}

function isCooling(symbol: string): boolean {
  const last = seenIpos.get(symbol);
  return !!last && Date.now() - last < COOLDOWN_MS;
}

function computeMagnitude(entry: FmpIpoEntry): number {
  const capM = (entry.marketCap ?? 0) / 1e6;
  if (capM >= 10_000) return 10;
  if (capM >= 5_000) return 8;
  if (capM >= 1_000) return 6;
  if (capM >= 500) return 4;
  if (capM >= 200) return 3;
  return 2;
}

function formatMarketCap(cap: number): string {
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
  return `$${cap.toLocaleString()}`;
}

async function fetchIpoCalendar(): Promise<FmpIpoEntry[]> {
  if (!FMP_API_KEY) return [];

  const from = dateStr(-3);
  const to = dateStr(2);
  const url = `${FMP_BASE}/ipo_calendar?from=${from}&to=${to}&apikey=${FMP_API_KEY}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        console.warn(`[IPO Detector] FMP returned ${res.status} — skipping this cycle`);
      }
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data as FmpIpoEntry[];
  } catch (err) {
    console.warn("[IPO Detector] Fetch error:", String(err).slice(0, 120));
    return [];
  }
}

async function fetchIpoConfirmed(): Promise<FmpIpoEntry[]> {
  if (!FMP_API_KEY) return [];

  const url = `${FMP_BASE}/ipo-calendar-confirmed?from=${dateStr(-3)}&to=${dateStr(2)}&apikey=${FMP_API_KEY}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data as FmpIpoEntry[];
  } catch {
    return [];
  }
}

export async function detectIpoAlerts(minMarketCapM: number): Promise<Signal[]> {
  pruneSeenIpos();

  const [calendar, confirmed] = await Promise.all([
    fetchIpoCalendar(),
    fetchIpoConfirmed(),
  ]);

  // Merge and deduplicate by symbol
  const merged = new Map<string, FmpIpoEntry>();
  for (const entry of [...calendar, ...confirmed]) {
    if (!entry.symbol) continue;
    const existing = merged.get(entry.symbol);
    // Prefer "priced" action entries over "filed" / "expected"
    if (!existing || entry.actions === "priced") {
      merged.set(entry.symbol, entry);
    }
  }

  const signals: Signal[] = [];
  const minCapRaw = minMarketCapM * 1e6;

  for (const [symbol, entry] of merged) {
    if (isCooling(symbol)) continue;
    if (entry.marketCap && entry.marketCap < minCapRaw) continue;

    seenIpos.set(symbol, Date.now());

    const themeId = autoMapTickerToCluster(symbol, "", entry.exchange ?? "");

    signals.push({
      id: randomUUID(),
      type: "ipo_debut",
      subjectKind: "ticker",
      subject: symbol,
      direction: "up",
      magnitude: computeMagnitude(entry),
      timestamp: new Date(),
      meta: {
        company: entry.company,
        exchange: entry.exchange,
        priceRange: entry.priceRange,
        sharesOffered: entry.shares,
        marketCap: entry.marketCap,
        marketCapFormatted: formatMarketCap(entry.marketCap ?? 0),
        ipoDate: entry.date,
        actionStatus: entry.actions,
        ...(themeId ? { themeId } : {}),
      },
    });
  }

  if (signals.length > 0) {
    console.log(`[IPO Detector] Found ${signals.length} new IPO(s): ${signals.map(s => s.subject).join(", ")}`);
  }

  return signals;
}

// ── Timer management ─────────────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastPollAt = 0;

export function startIpoDetector(
  onSignals: (signals: Signal[]) => void,
  minMarketCapM: number
): void {
  if (intervalHandle) return;

  const poll = async () => {
    if (Date.now() - lastPollAt < POLL_INTERVAL_MS - 5000) return;
    lastPollAt = Date.now();
    try {
      const signals = await detectIpoAlerts(minMarketCapM);
      if (signals.length > 0) onSignals(signals);
    } catch (err) {
      console.error("[IPO Detector] Poll error:", err);
    }
  };

  // Initial poll after short delay
  setTimeout(poll, 10_000);
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  console.log("[IPO Detector] Started — polling every 30 minutes");
}

export function stopIpoDetector(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
