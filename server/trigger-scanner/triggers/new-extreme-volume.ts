/**
 * New session high / low on volume.
 * Long  `new_high_volume`: bar i is after the opening range, closes above every earlier bar's high, and both the
 *                          bar's volume and the day's volume so far are at least newExtremeMinRelVol x their
 *                          time-of-day norms.
 * Short `new_low_volume`:  the mirror under every earlier low.
 * Re-raised at most once per dedupe window (registry), so a trending day does not repeat every bar.
 */
import { cumRelVol, relVol } from "../session";
import { r2, type TriggerFn } from "./common";

export const newExtremeVolume: TriggerFn = ({ ctx, s, i, settings }) => {
  if (s.orHigh === null || i < s.orEnd || i < 1) return [];
  const b = s.bars[i];
  const rv = relVol(s, i, ctx.avgVol20), crv = cumRelVol(s, i, ctx.avgVol20);
  if (rv === null || crv === null || rv < settings.newExtremeMinRelVol || crv < settings.newExtremeMinRelVol) return [];
  const priorHigh = s.hod[i - 1], priorLow = s.lod[i - 1];
  const facts = { relVol: r2(rv), cumRelVol: r2(crv), priorHigh: r2(priorHigh), priorLow: r2(priorLow) };
  if (b.c > priorHigh) return [{ setupKey: "new_high_volume", side: "long", variant: "high_of_day", why: `closed ${r2(b.c)} at a new session high on ${r2(rv)}x bar volume, ${r2(crv)}x for the day`, facts }];
  if (b.c < priorLow) return [{ setupKey: "new_low_volume", side: "short", variant: "low_of_day", why: `closed ${r2(b.c)} at a new session low on ${r2(rv)}x bar volume, ${r2(crv)}x for the day`, facts }];
  return [];
};
