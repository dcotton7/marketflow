/**
 * A daily level touched and held: the 5/10/20/50-day SMA, the 10/20-day EMA, the previous day's low/high, or a gap
 * edge (with its role: a long only off support, a short only off resistance).
 * Long  `level_hold`: earlier today price traded at least levelApproachAdr ADR above the level (a pullback to it, not
 *                     chop on it), the previous bar closed above it, bar i's low came within touchTolPct of it (or
 *                     through it), and bar i closed back above it.
 * Short `level_reject`: the mirror (traded far enough under it earlier, previous close under, high tags it, close back
 *                     under).
 * One hit per bar: the level nearest the close. The level's name is the variant, so each level dedupes on its own.
 */
import { dailyLevels } from "../levels";
import type { TriggerHit } from "../types";
import { r2, type TriggerFn } from "./common";

export const levelHold: TriggerFn = ({ ctx, s, i, settings }) => {
  if (i < 1) return [];
  const b = s.bars[i], prev = s.bars[i - 1];
  const tol = settings.touchTolPct / 100;
  const away = settings.levelApproachAdr * ctx.adr;
  const highBefore = s.hod[i - 1], lowBefore = s.lod[i - 1];
  const longs: TriggerHit[] = [], shorts: TriggerHit[] = [];
  for (const l of dailyLevels(ctx)) {
    const tag = l.name === "gap" ? `gap ${l.gap!.dir} ${l.gap!.date} (${l.gap!.state})` : l.name;
    const variant = l.name === "gap" ? `gap:${l.gap!.date}` : l.name;
    const facts = { level: r2(l.price), levelName: l.name, gapState: l.gap?.state ?? null };
    if ((!l.gap || l.gap.role === "support") && highBefore - l.price >= away && prev.c > l.price && b.l <= l.price * (1 + tol) && b.c > l.price) {
      longs.push({ setupKey: "level_hold", side: "long", variant, why: `tagged ${tag} ${r2(l.price)} (low ${r2(b.l)}) and closed back above at ${r2(b.c)}`, facts });
    }
    if ((!l.gap || l.gap.role === "resistance") && l.price - lowBefore >= away && prev.c < l.price && b.h >= l.price * (1 - tol) && b.c < l.price) {
      shorts.push({ setupKey: "level_reject", side: "short", variant, why: `tagged ${tag} ${r2(l.price)} (high ${r2(b.h)}) and closed back under at ${r2(b.c)}`, facts });
    }
  }
  const nearest = (hits: TriggerHit[]) =>
    hits.sort((x, y) => Math.abs(b.c - Number(x.facts.level)) - Math.abs(b.c - Number(y.facts.level)))[0];
  return [nearest(longs), nearest(shorts)].filter((h): h is TriggerHit => !!h);
};
