/**
 * Failed break / reversal after the opening range (Don: "She should look for reversals etc after ORB").
 * Short `failed_orb`:   an earlier bar after the range CLOSED above the range high (a real break), and bar i is the
 *                       first close back inside the range since then (below the high, above the low).
 * Long  `orb_reversal`: an earlier bar after the range closed under the range low, and bar i is the first close back
 *                       inside since then.
 * The break must have reached at least failedBreakMinAdr ADR beyond the range (the day's high / low so far).
 * No volume condition (a reversal often comes on fading volume); no time limit.
 */
import type { TriggerHit } from "../types";
import { r2, type TriggerFn } from "./common";

function lastIndex<T>(a: T[], from: number, to: number, f: (x: T) => boolean): number {
  for (let j = to; j >= from; j--) if (f(a[j])) return j;
  return -1;
}

export const failedOrb: TriggerFn = ({ ctx, s, i, settings }) => {
  if (s.orHigh === null || s.orLow === null || i <= s.orEnd) return [];
  const hi = s.orHigh, lo = s.orLow;
  const b = s.bars[i];
  const inside = b.c < hi && b.c > lo;
  if (!inside) return [];
  const out: TriggerHit[] = [];
  // the last bar before i that closed outside the range, and on which side
  const k = lastIndex(s.bars, s.orEnd, i - 1, (x) => x.c > hi || x.c < lo);
  if (k < 0) return [];
  // bar i is the first close back inside only when bar i-1 was that outside bar
  if (k !== i - 1) return [];
  const broke = s.bars[k];
  const min = settings.failedBreakMinAdr * ctx.adr;
  if (broke.c > hi && s.hod[i] - hi >= min) {
    out.push({ setupKey: "failed_orb", side: "short", variant: "range_high", why: `broke the opening range high ${r2(hi)} (closed ${r2(broke.c)}) and closed back inside at ${r2(b.c)}`, facts: { orHigh: hi, orLow: lo, breakClose: broke.c, breakHigh: s.hod[i] } });
  } else if (broke.c < lo && lo - s.lod[i] >= min) {
    out.push({ setupKey: "orb_reversal", side: "long", variant: "range_low", why: `broke the opening range low ${r2(lo)} (closed ${r2(broke.c)}) and closed back inside at ${r2(b.c)}`, facts: { orHigh: hi, orLow: lo, breakClose: broke.c, breakLow: s.lod[i] } });
  }
  return out;
};
