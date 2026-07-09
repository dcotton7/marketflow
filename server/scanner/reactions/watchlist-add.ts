// ---------------------------------------------------------------------------
// Reaction: Watchlist Add
// Auto-adds tickers to "Scanner Picks" when signals qualify with score >= 70.
// Uses an in-memory set per session day to avoid duplicates.
// ---------------------------------------------------------------------------

import type { EnrichedSignal } from "@shared/scanner-types";

const SCORE_THRESHOLD = 70;

interface ScannerPick {
  symbol: string;
  pipelineId: string;
  qualifyScore: number;
  direction: string;
  addedAt: string;
}

let currentDay = "";
let picksToday = new Map<string, ScannerPick>();

function ensureSessionDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentDay) {
    currentDay = today;
    picksToday = new Map();
  }
}

export function processWatchlistAdd(es: EnrichedSignal): void {
  if (!es.qualified || es.qualifyScore < SCORE_THRESHOLD) return;
  if (es.signal.subjectKind !== "ticker") return;

  ensureSessionDay();

  const symbol = es.signal.subject;
  if (picksToday.has(symbol)) return;

  picksToday.set(symbol, {
    symbol,
    pipelineId: es.pipelineId,
    qualifyScore: es.qualifyScore,
    direction: es.signal.direction,
    addedAt: new Date().toISOString(),
  });

  console.log(`[Scanner] Watchlist pick: ${symbol} (score ${es.qualifyScore}, pipeline ${es.pipelineId})`);
}

export function getScannerPicks(): ScannerPick[] {
  ensureSessionDay();
  return [...picksToday.values()].sort((a, b) => b.qualifyScore - a.qualifyScore);
}

export function getScannerPicksCount(): number {
  ensureSessionDay();
  return picksToday.size;
}
