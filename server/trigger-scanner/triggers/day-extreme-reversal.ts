/**
 * Low-of-day / high-of-day reversal.
 * Long  `lod_reversal`: the session low was made on bar i or i-1 (a new low below every earlier bar, not on the first
 *                       bar), the day's open is at least reversalMinMoveAdr ADR above that low (a real flush), and bar i
 *                       closes up (close > open) in the top reversalCloseShare of its range and above the previous
 *                       bar's close.
 * Short `hod_reversal`: the mirror off a new session high.
 */
import type { TriggerHit } from "../types";
import { r2, type TriggerFn } from "./common";

export const dayExtremeReversal: TriggerFn = ({ ctx, s, i, settings }) => {
  if (i < 2 || !(ctx.adr > 0)) return [];
  const b = s.bars[i], prev = s.bars[i - 1];
  const open = s.bars[0].o;
  const range = b.h - b.l;
  if (!(range > 0)) return [];
  const share = settings.reversalCloseShare;
  const out: TriggerHit[] = [];
  // the bar (i or i-1, never the first bar) that set the session's low / high as it stands at bar i
  const setLow = (j: number) => j >= 1 && s.bars[j].l === s.lod[i] && s.bars[j].l < s.lod[j - 1];
  const setHigh = (j: number) => j >= 1 && s.bars[j].h === s.hod[i] && s.bars[j].h > s.hod[j - 1];
  if ((setLow(i) || setLow(i - 1)) && open - s.lod[i] >= settings.reversalMinMoveAdr * ctx.adr && b.c > b.o && b.c >= b.l + share * range && b.c > prev.c) {
    out.push({ setupKey: "lod_reversal", side: "long", variant: "low_of_day", why: `reversed off the day's low ${r2(s.lod[i])} (${r2((open - s.lod[i]) / ctx.adr)} ADR under the open), closed ${r2(b.c)} in the top of the bar`, facts: { lowOfDay: r2(s.lod[i]), moveAdr: r2((open - s.lod[i]) / ctx.adr) } });
  }
  if ((setHigh(i) || setHigh(i - 1)) && s.hod[i] - open >= settings.reversalMinMoveAdr * ctx.adr && b.c < b.o && b.c <= b.h - share * range && b.c < prev.c) {
    out.push({ setupKey: "hod_reversal", side: "short", variant: "high_of_day", why: `reversed off the day's high ${r2(s.hod[i])} (${r2((s.hod[i] - open) / ctx.adr)} ADR over the open), closed ${r2(b.c)} in the bottom of the bar`, facts: { highOfDay: r2(s.hod[i]), moveAdr: r2((s.hod[i] - open) / ctx.adr) } });
  }
  return out;
};
