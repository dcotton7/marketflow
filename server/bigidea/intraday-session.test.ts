/**
 * Session-correct intraday indicators (ITD-4..ITD-7) on fixed 5-minute bar series with real timestamps: pre-market and
 * after-hours bars, the DST weeks (March and November 2026), the 27 Nov 2026 half day and the Thanksgiving holiday.
 * Also: ITD-1 and ITD-2 are retired but give exactly the answers they gave before (the review's fixed cases).
 */
import assert from "node:assert/strict";
import { INDICATOR_LIBRARY, normalizeResult, activeIndicators, retiredNotesFor, isRetiredIndicator, type CandleData } from "./indicators";
import { etClock, isRegularSessionBar, openingRange, sessionWindow } from "@shared/intraday-session";

const ind = (id: string) => INDICATOR_LIBRARY.find((x) => x.id === id)!;
const run = (id: string, oldestFirst: CandleData[], params: Record<string, any>) =>
  normalizeResult(ind(id).evaluate([...oldestFirst].reverse(), params));

/** UTC offset of New York, written out by hand (not computed by the code under test). */
const offsetHours = (day: string) => (day >= "2026-03-08" && day < "2026-11-01") ? 4 : 5;
/** ISO time of HH:MM New York time on `day`. */
const et = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${day}T00:00:00Z`) + ((h + offsetHours(day)) * 60 + m) * 60_000).toISOString();
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** Bars from `start` (HH:MM ET) every 5 minutes, one per [o, h, l, c, v?]. */
function session(day: string, start: string, rows: number[][]): CandleData[] {
  const [h, m] = start.split(":").map(Number);
  return rows.map((r, i) => ({ date: et(day, hhmm(h * 60 + m + i * 5)), open: r[0], high: r[1], low: r[2], close: r[3], volume: r[4] ?? 1e5 }));
}
const flat = (n: number, o: number, h: number, l: number, c: number, v = 1e5) => Array.from({ length: n }, () => [o, h, l, c, v]);

// ---- the clock: DST-safe, half days, holidays
assert.deepEqual(etClock(et("2026-03-06", "09:30")), { day: "2026-03-06", minute: 570, weekday: "Fri" });
assert.equal(et("2026-03-06", "09:30"), "2026-03-06T14:30:00.000Z", "EST");
assert.equal(et("2026-03-09", "09:30"), "2026-03-09T13:30:00.000Z", "EDT, the Monday after the change");
assert.equal(etClock("2026-03-09T13:30:00.000Z")!.minute, 570);
assert.equal(etClock("2026-11-02T14:30:00.000Z")!.minute, 570, "EST again after 1 Nov");
assert.equal(isRegularSessionBar(et("2026-03-09", "09:25")), false, "pre-market");
assert.equal(isRegularSessionBar(et("2026-03-09", "15:55")), true);
assert.equal(isRegularSessionBar(et("2026-03-09", "16:00")), false, "after-hours");
assert.equal(isRegularSessionBar(et("2026-11-27", "12:55")), true, "half day, last regular bar");
assert.equal(isRegularSessionBar(et("2026-11-27", "13:00")), false, "half day closes at 13:00");
assert.equal(isRegularSessionBar(et("2026-11-26", "10:00")), false, "Thanksgiving");
assert.equal(isRegularSessionBar(et("2026-03-07", "10:00")), false, "Saturday");

// ---- ITD-5 opening range: the review's case 1, now with a pre-market and real times
{
  const day = "2026-10-28";
  const pre = session(day, "08:00", flat(18, 103, 104, 102.5, 103.5, 3e5)); // a pre-market high of 104 must not count
  const rth = session(day, "09:30", [
    [100.5, 101, 100, 100.8], [100.8, 101, 100.2, 100.6], [100.6, 100.9, 100.1, 100.4], // 9:30-9:45: 100-101
    ...flat(20, 100.5, 100.9, 100.3, 100.6),
    [100.6, 102.5, 100.6, 102.3], [102.3, 102.6, 102.0, 102.2], [102.2, 102.4, 101.9, 102.0], // broke out
    [102.0, 102.1, 101.6, 101.8], [101.8, 101.9, 101.5, 101.7], [101.7, 101.9, 101.4, 101.8],
  ]);
  const bars = [...pre, ...rth];
  const range = openingRange(sessionWindow([...bars].reverse())!.today, 15)!;
  assert.deepEqual([range.high, range.low, range.bars, range.complete], [101, 100, 3, true]);
  assert.equal(run("ITD-5", bars, { rangeMinutes: 15, event: "above" }).pass, true, "101.8 is above the 9:30-9:45 high");
  assert.equal(run("ITD-5", bars, { rangeMinutes: 15, event: "break_above" }).pass, false, "it broke out 6 bars ago, not on this bar");
  assert.equal(run("ITD-5", bars, { rangeMinutes: 15, event: "break_above", skipBars: 5 }).pass, true, "the break bar itself");
  assert.equal(run("ITD-5", bars, { rangeMinutes: 15, event: "inside" }).pass, false);
  // the old one, unchanged: it says no (the review's finding)
  const old = run("ITD-1", bars, { orbBars: 3, breakoutDir: "up", minBreakout: 0.1 });
  assert.equal(old.pass, false);
  assert.equal(old.data?._diagnostics.value, "ORB: $100.60-$102.60");
  // failed break: close back inside after the breakout
  const failed = [...bars, ...session(day, hhmm(9 * 60 + 30 + rth.length * 5), [[101.8, 101.8, 100.6, 100.7]])];
  assert.equal(run("ITD-5", failed, { rangeMinutes: 15, event: "failed_break_above" }).pass, true);
  assert.equal(run("ITD-5", failed, { rangeMinutes: 15, event: "inside" }).pass, true);
  // not complete yet at 9:40
  const early = [...pre, ...rth.slice(0, 3)];
  assert.equal(run("ITD-5", early, { rangeMinutes: 15, event: "inside" }).data?._diagnostics.value, "opening range not complete yet");
}

// ---- review case 2: price never left a 99-103 range
{
  const day = "2026-10-28";
  const bars = session(day, "09:30", [
    [100.5, 103, 99, 101], [101, 103, 99.5, 101], [101, 102.8, 99.2, 100.5],
    ...flat(20, 100, 100.2, 99.8, 100),
    [100, 100.3, 99.9, 100.1], [100.1, 100.4, 100, 100.2], [100.2, 100.6, 100.1, 100.5],
  ]);
  assert.equal(run("ITD-5", bars, { rangeMinutes: 15, event: "inside" }).pass, true);
  assert.equal(run("ITD-5", bars, { rangeMinutes: 15, event: "above" }).pass, false);
  assert.equal(run("ITD-1", bars, { orbBars: 3, breakoutDir: "up", minBreakout: 0.1 }).pass, true, "the old one still says yes");
}

// ---- DST weeks: the range is 9:30-9:45 New York time on both sides of each change
for (const day of ["2026-03-06", "2026-03-09", "2026-10-30", "2026-11-02"]) {
  const bars = [
    ...session(day, "08:30", flat(12, 90, 120, 80, 95)),            // a wide pre-market hour, the hour a fixed offset gets wrong
    ...session(day, "09:30", [[100, 101, 99, 100.5], [100.5, 101.2, 99.6, 101], [101, 101.1, 100.2, 100.9]]),
    ...session(day, "09:45", flat(6, 101, 101.5, 100.8, 101.4)),
  ];
  const w = sessionWindow([...bars].reverse())!;
  assert.equal(w.day, day);
  assert.equal(w.today.length, 9, `${day}: pre-market left out`);
  const r = openingRange(w.today, 15)!;
  assert.deepEqual([r.high, r.low], [101.2, 99], `${day}: 9:30-9:45 ET`);
  assert.equal(run("ITD-5", bars, { rangeMinutes: 15, event: "above" }).pass, true, `${day}`);
}

// ---- ITD-4 session VWAP: the review's case 3 (yesterday heavy at 50, today light at 60, last close 58.5)
{
  const y = session("2026-10-27", "09:30", flat(78, 50, 50.2, 49.8, 50, 1e6));
  const pre = session("2026-10-28", "08:00", flat(18, 50, 50.2, 49.8, 50, 1e6)); // heavy pre-market at 50 too
  const today = session("2026-10-28", "09:30", [...flat(11, 60, 60.2, 59.8, 60), [60, 60.2, 59.8, 58.5]]);
  const bars = [...y, ...pre, ...today];
  const r = run("ITD-4", bars, { event: "below" });
  assert.equal(r.pass, true, "58.5 is below today's session VWAP");
  assert.ok(Math.abs(r.data!.sessionVwap - 59.958) < 0.01, String(r.data!.sessionVwap));
  assert.equal(run("ITD-4", bars, { event: "above" }).pass, false);
  // the old one, unchanged (its window is the last 78 bars, so now pre-market at 50 too)
  const old = run("ITD-2", [...y, ...today], { vwapBars: 78, position: "below" });
  assert.equal(old.pass, false);
  assert.match(old.data?._diagnostics.value, /^VWAP: \$50\.18/);

  // reclaim / loss on a closing bar
  const dip = session("2026-10-28", "09:30", [[60, 60.2, 59.8, 60], [60, 60.1, 59, 59.2], [59.2, 59.4, 58.9, 59.1], [59.1, 60.6, 59, 60.5]]);
  assert.equal(run("ITD-4", dip, { event: "reclaim", minBarsOtherSide: 2 }).pass, true);
  assert.equal(run("ITD-4", dip, { event: "reclaim", minBarsOtherSide: 3 }).pass, false, "only 2 closes were under");
  assert.equal(run("ITD-4", dip, { event: "reclaim", minBarsOtherSide: 2, skipBars: 1 }).pass, false, "the bar before was still under");
  const pop = session("2026-10-28", "09:30", [[60, 60.2, 59.8, 60], [60, 61, 60, 60.9], [60.9, 61.2, 60.8, 61], [61, 61, 59.2, 59.4]]);
  assert.equal(run("ITD-4", pop, { event: "loss", minBarsOtherSide: 2 }).pass, true);
  // after the close, the last regular bar is judged, after-hours left out
  const ah = [...dip, ...session("2026-10-28", "16:00", [[60.5, 60.5, 40, 41, 5e6]])];
  assert.equal(run("ITD-4", ah, { event: "reclaim", minBarsOtherSide: 2 }).pass, true);
}

// ---- ITD-6 high/low of day, half day: the 13:00+ after-hours spike on 27 Nov is not the day's high
{
  const day = "2026-11-27";
  const bars = [
    ...session(day, "09:30", [[100, 101, 99.5, 100.5], [100.5, 101.5, 100.2, 101.2], [101.2, 101.4, 100.8, 101], [101, 102, 100.9, 101.9]]),
    ...session(day, "13:00", [[101.9, 110, 101.9, 109]]),
  ];
  const r = run("ITD-6", bars, { event: "new_high" });
  assert.equal(r.pass, true, "the last regular bar made the high");
  assert.equal(r.data!.highOfDay, 102);
  assert.equal(run("ITD-6", bars, { event: "near_high", withinPct: 0.2 }).pass, true);
  assert.equal(run("ITD-6", bars, { event: "new_low" }).pass, false);
  assert.equal(run("ITD-6", bars, { event: "new_high", skipBars: 1 }).pass, false, "bar 3 did not");
}

// ---- ITD-7 prior-day levels: RTH only, over the weekend and over Thanksgiving
{
  const fri = session("2026-10-30", "09:30", [[50, 51, 49, 50.5], [50.5, 52, 50, 51.5]]);
  const friAh = session("2026-10-30", "16:00", [[51.5, 60, 51.5, 59]]);       // after-hours spike: not the prior high
  const monPre = session("2026-11-02", "08:00", [[52, 53, 52, 52.8]]);
  const mon = session("2026-11-02", "09:30", [[51.8, 51.9, 51.2, 51.3], [51.3, 52.4, 51.2, 52.3]]);
  const bars = [...fri, ...friAh, ...monPre, ...mon];
  const r = run("ITD-7", bars, { level: "high", event: "cross_above" });
  assert.equal(r.pass, true, "Monday's 9:35 bar closed over Friday's regular-hours high 52");
  assert.deepEqual([r.data!.priorDayHigh, r.data!.priorDayLow, r.data!.priorDayClose], [52, 49, 51.5]);
  assert.equal(run("ITD-7", bars, { level: "high", event: "cross_above", skipBars: 1 }).pass, false);
  assert.equal(run("ITD-7", bars, { level: "close", event: "below", skipBars: 1 }).pass, true, "opened under Friday's close");
  assert.equal(run("ITD-7", bars, { level: "low", event: "near", withinPct: 7 }).pass, true, "52.3 is within 7% of 49");
  assert.equal(run("ITD-7", bars, { level: "low", event: "near", withinPct: 5 }).pass, false);
  // the half day's prior session is 25 Nov (26 Nov is a holiday)
  const wed = session("2026-11-25", "09:30", [[70, 72, 69, 71]]);
  const fri27 = session("2026-11-27", "09:30", [[71, 71.5, 70.5, 71.2]]);
  assert.equal(run("ITD-7", [...wed, ...fri27], { level: "high", event: "below" }).data!.priorDayHigh, 72);
  // data that starts today has no prior session: a plain "no data", not a silent pass
  assert.equal(run("ITD-7", mon, { level: "high", event: "below" }).data?._diagnostics.value, "no prior session in the data");
}

// ---- no regular-session bars at all (pre-market only, or daily bars)
assert.equal(run("ITD-4", session("2026-10-28", "07:00", flat(5, 1, 1, 1, 1)), { event: "above" }).data?._diagnostics.value, "no regular-session bars");

// ---- retired: kept and evaluable, hidden from what is offered, named where shown
assert.equal(isRetiredIndicator("ITD-1"), true);
assert.equal(isRetiredIndicator("ITD-2"), true);
assert.equal(isRetiredIndicator("ITD-3"), false);
const active = activeIndicators(INDICATOR_LIBRARY).map((i) => i.id);
assert.ok(!active.includes("ITD-1") && !active.includes("ITD-2"));
for (const id of ["ITD-3", "ITD-4", "ITD-5", "ITD-6", "ITD-7"]) assert.ok(active.includes(id), id);
assert.match(ind("ITD-1").description, /^RETIRED: use ITD-5/);
assert.match(ind("ITD-2").description, /^RETIRED: use ITD-4/);
const notes = retiredNotesFor([{ indicatorId: "MA-1" }, { indicatorId: "ITD-2" }, { indicatorId: "ITD-2" }, { indicatorId: "ITD-1" }]);
assert.equal(notes.length, 2);
assert.match(notes[0], /^ITD-2 VWAP Position: Retired: use ITD-4/);
assert.deepEqual(retiredNotesFor([{ indicatorId: "ITD-4" }]), []);
// ids are unique
assert.equal(new Set(INDICATOR_LIBRARY.map((i) => i.id)).size, INDICATOR_LIBRARY.length);

// ---- cost: a 60-day 5-minute series with extended hours (about 11,500 bars) reads only the last two sessions
{
  const days: CandleData[] = [];
  for (let d = 1; d <= 30; d++) {
    const day = `2026-10-${String(d).padStart(2, "0")}`;
    const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    days.push(...session(day, "04:00", flat(192, 100, 101, 99, 100)));
  }
  const newest = [...days].reverse();
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) ind("ITD-7").evaluate(newest, { level: "high", event: "above" });
  const ms = (performance.now() - t0) / 200;
  assert.ok(ms < 10, `ITD-7 took ${ms.toFixed(2)} ms a name`);
}

console.log("intraday-session: all checks passed");
