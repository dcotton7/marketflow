import type { DailyBar, WeinsteinStage } from "./types";

/**
 * Weinstein stage on weekly bars (30-week SMA), an informational label in the decision log only. Don's direction
 * (2026-10-28): Weinstein is reference only; no rule, filter or tested setup uses it.
 */

export interface WeeklyBar {
  weekEnd: string;
  close: number;
  high: number;
  low: number;
  volume: number;
  /** Index of the week's last daily bar. */
  lastDailyIndex: number;
}

function isoWeekKey(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function weeklyBars(daily: DailyBar[]): WeeklyBar[] {
  const out: WeeklyBar[] = [];
  let key = "";
  for (let i = 0; i < daily.length; i++) {
    const b = daily[i];
    const k = isoWeekKey(b.date);
    if (k !== key) {
      key = k;
      out.push({ weekEnd: b.date, close: b.close, high: b.high, low: b.low, volume: b.volume, lastDailyIndex: i });
    } else {
      const w = out[out.length - 1];
      w.weekEnd = b.date;
      w.close = b.close;
      w.high = Math.max(w.high, b.high);
      w.low = Math.min(w.low, b.low);
      w.volume += b.volume;
      w.lastDailyIndex = i;
    }
  }
  return out;
}

/**
 * Stage per daily bar from the last completed week (the week containing bar i counts only once bar i is that week's
 * last bar, so a mid-week label never uses the rest of the week).
 */
export function weinsteinStages(daily: DailyBar[]): (WeinsteinStage | null)[] {
  const weeks = weeklyBars(daily);
  const closes = weeks.map((w) => w.close);
  const ma: (number | null)[] = closes.map((_, j) => (j >= 29 ? closes.slice(j - 29, j + 1).reduce((a, b) => a + b, 0) / 30 : null));
  const stageOfWeek: (WeinsteinStage | null)[] = [];
  let prev: WeinsteinStage | null = null;
  for (let j = 0; j < weeks.length; j++) {
    const m = ma[j];
    const m4 = j >= 4 ? ma[j - 4] : null;
    if (m == null || m4 == null) {
      stageOfWeek.push(null);
      continue;
    }
    const slope = m / m4 - 1;
    const above = closes[j] > m;
    let s: WeinsteinStage;
    if (above && slope > 0.005) s = 2;
    else if (!above && slope < -0.005) s = 4;
    else if (prev === 2 || prev === 3) s = 3;
    else s = 1;
    stageOfWeek.push(s);
    prev = s;
  }
  const out: (WeinsteinStage | null)[] = new Array(daily.length).fill(null);
  let w = -1;
  for (let i = 0; i < daily.length; i++) {
    while (w + 1 < weeks.length && weeks[w + 1].lastDailyIndex <= i) w++;
    out[i] = w >= 0 ? stageOfWeek[w] : null;
  }
  return out;
}
