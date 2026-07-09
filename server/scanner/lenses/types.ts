// ---------------------------------------------------------------------------
// Lens interface — every lens implements this contract
// ---------------------------------------------------------------------------

import type { Signal, LensId, LensResult } from "@shared/scanner-types";
import type { SnapshotFrame } from "../signal-producer";

export interface LensContext {
  currentFrame: SnapshotFrame;
  getFrame: (offset: number) => SnapshotFrame | null;
  bufferLength: number;
}

export interface Lens {
  id: LensId;
  apply(signal: Signal, ctx: LensContext): Promise<LensResult | null>;
}
