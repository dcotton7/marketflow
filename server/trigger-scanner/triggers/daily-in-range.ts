/**
 * A daily setup coming into range. The watch list is built before the open: Leader Shakeout hits of the last
 * shakeoutLookbackSessions sessions (entry level = the drop day's close, long: the research enters the bounce at
 * about that price; PROPOSAL), and each user's stored daily setups that passed on last night's bars (entry level by
 * their entry rule: prev_high, prev_low or prev_close).
 * Fires on bar i when its close is within inRangeAdr ADR of the entry level and the bar moves the setup's way (a long
 * closes up, a short closes down). Once per watch per day (registry dedupe), so the setup key, owner and hit date
 * travel with the candidate.
 */
import type { TriggerHit } from "../types";
import { r2, type TriggerFn } from "./common";

export const dailyInRange: TriggerFn = ({ ctx, s, i, settings, watch }) => {
  if (!watch?.length || !(ctx.adr > 0)) return [];
  const b = s.bars[i];
  const out: TriggerHit[] = [];
  for (const w of watch) {
    const distAdr = Math.abs(b.c - w.entryLevel) / ctx.adr;
    if (distAdr > (w.rangeAdr ?? settings.inRangeAdr)) continue;
    if (w.side === "long" ? !(b.c > b.o) : !(b.c < b.o)) continue;
    out.push({
      setupKey: w.setupKey,
      side: w.side,
      variant: `${w.setupOwner}:${w.hitDate}`,
      why: `${w.setupKey} from ${w.hitDate}: closed ${r2(b.c)}, ${r2(distAdr)} ADR from its entry level ${w.entryName} ${r2(w.entryLevel)}`,
      facts: { entryLevel: r2(w.entryLevel), entryName: w.entryName, hitDate: w.hitDate, distAdr: r2(distAdr), setupOwner: w.setupOwner, ownerUserId: w.ownerUserId, tested: w.tested ? 1 : 0 },
    });
  }
  return out;
};
