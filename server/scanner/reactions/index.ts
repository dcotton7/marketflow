// ---------------------------------------------------------------------------
// Reaction Registry
// Processes enriched signals through all requested reactions.
// ---------------------------------------------------------------------------

import type { EnrichedSignal, DiscoveryCard, ReactionId } from "@shared/scanner-types";
import { buildDiscoveryCard } from "./discovery-brief";
import { processWatchlistAdd } from "./watchlist-add";
// heat map accumulator disabled — no frontend consumer, leaked memory

/**
 * Run reactions for an enriched signal.
 * Returns discovery cards that should be sent to the client feed.
 */
export async function executeReactions(
  enriched: EnrichedSignal[]
): Promise<DiscoveryCard[]> {
  const cards: DiscoveryCard[] = [];

  for (const es of enriched) {
    if (es.qualified) {
      const card = buildDiscoveryCard(es);
      cards.push(card);
    }

    processWatchlistAdd(es);
  }

  return cards;
}
