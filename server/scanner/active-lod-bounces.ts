// ---------------------------------------------------------------------------
// Active LOD Bounce tracker — clear live discovery cards when the bounce
// thesis dies (gives up near LOD / new lower low) or extends too far.
// ---------------------------------------------------------------------------

import type { DiscoveryCard } from "@shared/scanner-types";
import { getScannerConfig } from "./signal-producer";
import type { SnapshotFrame } from "./signal-producer";

export type LodBounceClearReason = "gave_up" | "extended";

export interface LodBounceClearEvent {
  type: "discovery_clear";
  signalType: "lod_bounce";
  subject: string;
  cardIds: number[];
  reason: LodBounceClearReason;
}

interface ActiveLodBounce {
  cardId: number;
  symbol: string;
  lodPrice: number;
  maxPrice: number;
  firedAt: number;
}

const active = new Map<number, ActiveLodBounce>();

export function trackLodBounceDiscoveries(
  cards: DiscoveryCard[],
  frame: SnapshotFrame
): void {
  for (const card of cards) {
    if (card.signalType !== "lod_bounce") continue;
    const tick = frame.tickers.get(card.subject);
    if (!tick || tick.todayLow <= 0 || tick.price <= 0) continue;

    active.set(card.id, {
      cardId: card.id,
      symbol: card.subject,
      lodPrice: tick.todayLow,
      maxPrice: Math.max(tick.price, tick.todayLow * (1 + card.magnitude / 100)),
      firedAt: Date.now(),
    });
  }
}

/**
 * Re-check every active LOD bounce against the latest frame.
 * Returns clear events (one per symbol) and drops those entries from the tracker.
 */
export function evaluateActiveLodBounces(frame: SnapshotFrame): LodBounceClearEvent[] {
  if (active.size === 0) return [];

  const cfg = getScannerConfig();
  const giveUpPct = cfg.lodBounceGiveUpPct;
  const clearMaxPct = cfg.lodBounceClearMaxPct;
  const maxAtr = cfg.lodBounceMaxAtrExt;

  // Group clears by symbol+reason so one SSE event can drop multiple cards
  const pending = new Map<string, { reason: LodBounceClearReason; cardIds: number[] }>();

  for (const [cardId, entry] of active) {
    const tick = frame.tickers.get(entry.symbol);
    if (!tick || tick.price <= 0) continue;

    entry.maxPrice = Math.max(entry.maxPrice, tick.price);

    let reason: LodBounceClearReason | null = null;

    // New undercut of the setup's LOD → bounce thesis is dead
    if (tick.todayLow > 0 && tick.todayLow < entry.lodPrice - 1e-6) {
      reason = "gave_up";
    } else {
      const lod = entry.lodPrice;
      const pctAbove = ((tick.price - lod) / lod) * 100;
      const pctPeak = ((entry.maxPrice - lod) / lod) * 100;

      if (pctAbove < giveUpPct) {
        reason = "gave_up";
      } else if (pctPeak >= clearMaxPct) {
        reason = "extended";
      } else if (Math.abs(tick.extensionFrom20dAdr) > maxAtr) {
        reason = "extended";
      }
    }

    if (!reason) continue;

    const key = `${entry.symbol}:${reason}`;
    const bucket = pending.get(key) ?? { reason, cardIds: [] };
    bucket.cardIds.push(cardId);
    pending.set(key, bucket);
    active.delete(cardId);
  }

  const events: LodBounceClearEvent[] = [];
  for (const [key, bucket] of pending) {
    const subject = key.split(":")[0]!;
    events.push({
      type: "discovery_clear",
      signalType: "lod_bounce",
      subject,
      cardIds: bucket.cardIds,
      reason: bucket.reason,
    });
  }
  return events;
}

export function activeLodBounceCount(): number {
  return active.size;
}
