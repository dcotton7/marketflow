/**
 * A daily level touched and held: the 5/10/20/50-day SMA, the 10/20-day EMA, the previous day's low/high, or a gap
 * edge (with its role: a long only off support, a short only off resistance).
 * Long  `level_hold`: earlier today price traded at least levelApproachAdr ADR above the level (a pullback to it, not
 *                     chop on it), the previous bar closed above it, bar i's low reached it (within
 *                     min(touchTolPct % of the level, touchTolAdr ADR), or through it), and bar i closed back above it.
 * Short `level_reject`: the mirror (traded far enough under it earlier, previous close under, high tags it, close back
 *                     under).
 * One hit per bar and side: the heaviest level touched (levels.ts levelWeight: the 20/50-day, the 20-day EMA, the
 * previous high/low and gap edges before the 5/10-day), the nearest to the close among equals. The level's name is the
 * variant, so each level dedupes on its own (once a day: registry).
 *
 * A real test (v3, 28 Nov; the first live session raised 1,075 of these in 53 minutes, most of them a few cents on a
 * thin bar): the bar's range is at least levelMinRangeAdr ADR, it closes in the top (short: bottom) levelCloseShare of
 * that range, on at least levelMinRelVol x its slot's volume. A touch that fails is returned with `refused` (counted
 * in the run row as level_hold:<reason>), never raised.
 */
import { dailyLevels, levelWeight } from "../levels";
import { relVol } from "../session";
import type { ScannerSettings } from "../settings";
import type { Bar, Side, TriggerHit } from "../types";
import { r2, type TriggerFn } from "./common";

export const levelHold: TriggerFn = ({ ctx, s, i, settings }) => {
  if (i < 1) return [];
  const b = s.bars[i], prev = s.bars[i - 1];
  const away = settings.levelApproachAdr * ctx.adr;
  const highBefore = s.hod[i - 1], lowBefore = s.lod[i - 1];
  const longs: TriggerHit[] = [], shorts: TriggerHit[] = [];
  for (const l of dailyLevels(ctx)) {
    const tag = l.name === "gap" ? `gap ${l.gap!.dir} ${l.gap!.date} (${l.gap!.state})` : l.name;
    const variant = l.name === "gap" ? `gap:${l.gap!.date}` : l.name;
    const facts = { level: r2(l.price), levelName: l.name, gapState: l.gap?.state ?? null };
    if ((!l.gap || l.gap.role === "support") && highBefore - l.price >= away && prev.c > l.price && levelTouched(b, "long", l.price, ctx.adr, settings) && b.c > l.price) {
      longs.push({ setupKey: "level_hold", side: "long", variant, why: `tagged ${tag} ${r2(l.price)} (low ${r2(b.l)}) and closed back above at ${r2(b.c)}`, facts });
    }
    if ((!l.gap || l.gap.role === "resistance") && l.price - lowBefore >= away && prev.c < l.price && levelTouched(b, "short", l.price, ctx.adr, settings) && b.c < l.price) {
      shorts.push({ setupKey: "level_reject", side: "short", variant, why: `tagged ${tag} ${r2(l.price)} (high ${r2(b.h)}) and closed back under at ${r2(b.c)}`, facts });
    }
  }
  const pick = (hits: TriggerHit[]) =>
    hits.sort((x, y) => levelWeight(String(y.facts.levelName)) - levelWeight(String(x.facts.levelName)) || Math.abs(b.c - Number(x.facts.level)) - Math.abs(b.c - Number(y.facts.level)))[0];
  const rv = relVol(s, i, ctx.avgVol20);
  const test = (h: TriggerHit): TriggerHit => {
    const t = levelTest(b, h.side, ctx.adr, rv, settings);
    h.facts = { ...h.facts, barRangeAdr: r2(t.rangeAdr), closeShare: r2(t.closeShare), relVol: rv === null ? null : r2(rv) };
    if (t.refused) h.refused = t.refused;
    return h;
  };
  return [pick(longs), pick(shorts)].filter((h): h is TriggerHit => !!h).map(test);
};

/** The real-test half of the rule, pure (the replay of stored candidates uses it too). */
export function levelTest(b: Bar, side: Side, adr: number, rv: number | null, st: Pick<ScannerSettings, "levelMinRangeAdr" | "levelCloseShare" | "levelMinRelVol">): { refused: "small_bar" | "weak_close" | "low_volume" | null; rangeAdr: number; closeShare: number } {
  const range = b.h - b.l;
  const closeShare = range > 0 ? (side === "long" ? (b.c - b.l) / range : (b.h - b.c) / range) : 0;
  const rangeAdr = adr > 0 ? range / adr : 0;
  const refused = rangeAdr < st.levelMinRangeAdr ? "small_bar" : closeShare < st.levelCloseShare ? "weak_close" : rv === null || rv < st.levelMinRelVol ? "low_volume" : null;
  return { refused, rangeAdr, closeShare };
}

/** The bar reached the level: within min(touchTolPct % of it, touchTolAdr ADR), or through it. */
export function levelTouched(b: Bar, side: Side, level: number, adr: number, st: Pick<ScannerSettings, "touchTolPct" | "touchTolAdr">): boolean {
  const tol = Math.min((st.touchTolPct / 100) * level, adr > 0 ? st.touchTolAdr * adr : Infinity);
  return side === "long" ? b.l <= level + tol : b.h >= level - tol;
}
