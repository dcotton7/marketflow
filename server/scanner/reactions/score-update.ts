// ---------------------------------------------------------------------------
// Reaction: Score Update
// Maintains per-ticker "heat scores" that accumulate as signals fire.
// Scores decay with a 30-minute half-life during market hours.
// ---------------------------------------------------------------------------

import type { EnrichedSignal } from "@shared/scanner-types";

const HALF_LIFE_MS = 30 * 60 * 1000;
const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_MS;
const MIN_SCORE_THRESHOLD = 1;

interface HeatEntry {
  symbol: string;
  score: number;
  lastUpdated: number;
  signalCount: number;
}

const heatMap = new Map<string, HeatEntry>();

function decayScore(entry: HeatEntry, now: number): number {
  const elapsed = now - entry.lastUpdated;
  if (elapsed <= 0) return entry.score;
  return entry.score * Math.exp(-DECAY_LAMBDA * elapsed);
}

export function processScoreUpdate(es: EnrichedSignal): void {
  if (!es.qualified) return;
  if (es.signal.subjectKind !== "ticker") return;

  const symbol = es.signal.subject;
  const now = Date.now();
  const increment = es.qualifyScore;

  const existing = heatMap.get(symbol);
  if (existing) {
    const decayed = decayScore(existing, now);
    existing.score = decayed + increment;
    existing.lastUpdated = now;
    existing.signalCount += 1;
  } else {
    heatMap.set(symbol, {
      symbol,
      score: increment,
      lastUpdated: now,
      signalCount: 1,
    });
  }
}

export interface HeatScoreEntry {
  symbol: string;
  heat: number;
  signalCount: number;
  lastUpdated: string;
}

export function getHeatScores(limit = 50): HeatScoreEntry[] {
  const now = Date.now();
  const results: HeatScoreEntry[] = [];

  for (const entry of heatMap.values()) {
    const currentScore = decayScore(entry, now);
    if (currentScore < MIN_SCORE_THRESHOLD) continue;
    results.push({
      symbol: entry.symbol,
      heat: Math.round(currentScore * 10) / 10,
      signalCount: entry.signalCount,
      lastUpdated: new Date(entry.lastUpdated).toISOString(),
    });
  }

  results.sort((a, b) => b.heat - a.heat);
  return results.slice(0, limit);
}

export function pruneStaleEntries(): void {
  const now = Date.now();
  for (const [symbol, entry] of heatMap) {
    if (decayScore(entry, now) < MIN_SCORE_THRESHOLD) {
      heatMap.delete(symbol);
    }
  }
}
