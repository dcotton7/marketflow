/**
 * VWAP reclaim / loss (session VWAP, from 9:30, typical price x volume).
 * Long  `vwap_reclaim`: bar i closes at least vwapMinCrossAdr ADR above VWAP and each of the vwapPriorBars bars before
 *                       it closed below its VWAP.
 * Short `vwap_loss`:    the mirror.
 */
import { r2, type TriggerFn } from "./common";

export const vwapCross: TriggerFn = ({ ctx, s, i, settings }) => {
  const n = settings.vwapPriorBars;
  const by = settings.vwapMinCrossAdr * ctx.adr;
  if (i < n) return [];
  const b = s.bars[i];
  const prior = Array.from({ length: n }, (_, k) => i - 1 - k);
  if (b.c - s.vwap[i] >= by && b.c > s.vwap[i] && prior.every((j) => s.bars[j].c < s.vwap[j])) {
    return [{ setupKey: "vwap_reclaim", side: "long", variant: "vwap", why: `closed ${r2(b.c)} back above VWAP ${r2(s.vwap[i])} after ${n} bars under it`, facts: { vwap: r2(s.vwap[i]), priorBars: n } }];
  }
  if (s.vwap[i] - b.c >= by && b.c < s.vwap[i] && prior.every((j) => s.bars[j].c > s.vwap[j])) {
    return [{ setupKey: "vwap_loss", side: "short", variant: "vwap", why: `closed ${r2(b.c)} back under VWAP ${r2(s.vwap[i])} after ${n} bars over it`, facts: { vwap: r2(s.vwap[i]), priorBars: n } }];
  }
  return [];
};
