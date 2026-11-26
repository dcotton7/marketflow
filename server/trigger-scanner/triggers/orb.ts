/**
 * Opening-range breakout / breakdown. The range is the first orMinutes (15 = three 5-minute bars).
 * Long  `orb_breakout`:  bar i is after the range, within orbUntilMin of the open, closes ABOVE the range high, no
 *                        earlier bar after the range closed above it (the first close beyond), and the bar's volume is
 *                        at least orbMinRelVol x its time-of-day norm.
 * Short `orb_breakdown`: the mirror under the range low.
 */
import { minutesAtClose, relVol } from "../session";
import type { TriggerHit } from "../types";
import { r2, type TriggerFn } from "./common";

export const orb: TriggerFn = ({ ctx, s, i, settings }) => {
  if (s.orHigh === null || s.orLow === null || i < s.orEnd) return [];
  if (minutesAtClose(s, i) > settings.orbUntilMin) return [];
  const b = s.bars[i];
  const rv = relVol(s, i, ctx.avgVol20);
  if (rv === null || rv < settings.orbMinRelVol) return [];
  const out: TriggerHit[] = [];
  const earlier = s.bars.slice(s.orEnd, i);
  if (b.c > s.orHigh && !earlier.some((x) => x.c > s.orHigh!)) {
    out.push({ setupKey: "orb_breakout", side: "long", variant: "range_high", why: `closed ${r2(b.c)} above the opening range high ${r2(s.orHigh)} on ${r2(rv)}x volume`, facts: { orHigh: s.orHigh, orLow: s.orLow, relVol: r2(rv) } });
  }
  if (b.c < s.orLow && !earlier.some((x) => x.c < s.orLow!)) {
    out.push({ setupKey: "orb_breakdown", side: "short", variant: "range_low", why: `closed ${r2(b.c)} under the opening range low ${r2(s.orLow)} on ${r2(rv)}x volume`, facts: { orHigh: s.orHigh, orLow: s.orLow, relVol: r2(rv) } });
  }
  return out;
};
