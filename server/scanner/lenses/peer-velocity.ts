// ---------------------------------------------------------------------------
// Lens: Peer Velocity
// "Are this ticker's theme peers also moving?"
// ---------------------------------------------------------------------------

import type { Signal, PeerVelocityResult } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";
import {
  getTickerPrimaryCluster,
  getClusterById,
  type ClusterId,
} from "../../market-condition/universe";

const PEER_VELOCITY_WINDOW = 10; // ~5 min at 30s
const MOVING_THRESHOLD_PCT = 1.0;

export const peerVelocityLens: Lens = {
  id: "peer_velocity",

  async apply(signal: Signal, ctx: LensContext): Promise<PeerVelocityResult | null> {
    if (signal.subjectKind !== "ticker") return null;

    const symbol = signal.subject;
    const clusterId = getTickerPrimaryCluster(symbol);
    if (!clusterId) return null;

    const cluster = getClusterById(clusterId as ClusterId);
    if (!cluster) return null;

    const peerSymbols = [...cluster.core, ...cluster.candidates].filter((s) => s !== symbol);

    const prev = ctx.getFrame(PEER_VELOCITY_WINDOW);
    const current = ctx.currentFrame;

    const peers = peerSymbols.map((peer) => {
      const curr = current.tickers.get(peer);
      const prv = prev?.tickers.get(peer);
      if (!curr) return { symbol: peer, changePct: 0, volumeRatio: 0 };

      const changePct = prv && prv.price > 0
        ? ((curr.price - prv.price) / prv.price) * 100
        : curr.changePct;

      const volumeRatio = curr.avgVolume14d > 0
        ? curr.volume / curr.avgVolume14d
        : 0;

      return {
        symbol: peer,
        changePct: Math.round(changePct * 100) / 100,
        volumeRatio: Math.round(volumeRatio * 10) / 10,
      };
    });

    const signalDirection = signal.direction === "up" ? 1 : -1;
    const movingCount = peers.filter(
      (p) => Math.abs(p.changePct) >= MOVING_THRESHOLD_PCT &&
             Math.sign(p.changePct) === signalDirection
    ).length;

    const avgPeerChange = peers.length > 0
      ? Math.round((peers.reduce((s, p) => s + p.changePct, 0) / peers.length) * 100) / 100
      : 0;

    // Simple correlation: what fraction of peers moved in the same direction
    const sameDir = peers.filter((p) => Math.sign(p.changePct) === signalDirection).length;
    const correlation = peers.length > 0
      ? Math.round((sameDir / peers.length) * 100) / 100
      : 0;

    let verdict: PeerVelocityResult["verdict"] = "isolated";
    if (movingCount >= 3 || (movingCount >= 2 && correlation >= 0.7)) verdict = "sector_wide";
    else if (movingCount >= 2) verdict = "cluster";

    return { peers, movingCount, avgPeerChange, correlation, verdict };
  },
};
