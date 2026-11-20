import assert from "node:assert/strict";
import type { DBar } from "./daily-math";
import { labelDates, type Breadth } from "./market-label";
import { buildCard, buildWatch, CARD_ETFS, CARD_VERSION, makeCtx, MARKERS, stagedState, stressSeries, watchSeries, type CardData } from "./market-card";
import { runMarketCard, type CardSource } from "./market-card-job";

// ---- made-up market: 420 sessions; SPY rises 1 year, then falls 12% over 25 sessions while VIXY doubles ----------
const days: string[] = [];
for (let t = Date.parse("2024-12-02T12:00:00Z"); days.length < 420; t += 864e5) { const wd = new Date(t).getUTCDay(); if (wd >= 1 && wd <= 5) days.push(new Date(t).toISOString().slice(0, 10)); }
const N = days.length, FALL = N - 25;
const path = (f: (i: number) => number, vol = () => 1e7): DBar[] => days.map((d, i) => { const c = f(i); return { date: d, open: c, high: c * 1.005, low: c * 0.995, close: c, volume: vol() }; });
const spyF = (i: number) => (i < FALL ? 400 + i * 0.5 + (i % 3) * 0.2 : (400 + FALL * 0.5) * (1 - 0.005 * (i - FALL)));
const etf: Record<string, DBar[]> = {};
for (const s of CARD_ETFS) etf[s] = path((i) => spyF(i) / 4 + (i % 2) * 0.05);
etf.SPY = path(spyF);
etf.VIXY = path((i) => (i < FALL ? 20 + (i % 4) * 0.2 : 20 + (i - FALL) * 1.2));
// SOXX led the past year by a lot and has trailed hard for the last 60 sessions (a leadership unwind)
etf.SOXX = path((i) => (i < N - 60 ? 100 + i * 1.0 : (100 + (N - 60) * 1.0) * (1 - 0.004 * (i - (N - 60)))));
// RSP beats SPY over the last 20 sessions; VHT held up best before the fall
etf.RSP = path((i) => (i < N - 20 ? spyF(i) / 4 : (spyF(N - 20) / 4) * (1 - 0.001 * (i - (N - 20)))));
// SMH falls harder than SPY in the drop (relative strength turns negative)
etf.SMH = path((i) => (i < FALL ? spyF(i) / 4 : (spyF(i) / 4) * (1 - 0.003 * (i - FALL))));
etf.VHT = path((i) => (i < FALL - 60 ? 50 : 50 + (i - (FALL - 60)) * 0.3));
// breadth: 70% above the 50-day, falling to 35% in the drop; 500 names
const breadth: Breadth = new Map(days.map((d, i) => [d, { up: i < FALL ? 350 : 175, n: 500 }]));
const labels = labelDates({ SPY: etf.SPY, QQQ: etf.QQQ, IWM: etf.IWM, VIXY: etf.VIXY }, breadth);
const data: CardData = {
  etf, labels, nhnl: new Map(days.map((d, i) => [d, { nh: i < FALL ? 0.05 : 0.001, nl: i < FALL ? 0.01 : 0.06, n: 500 }])),
  members: {}, stock: new Map(), themeBreadth: new Map([[days[N - 1], { share: 0.2, n: 25 }]]), mfRank: () => NaN,
};
const c = makeCtx(data);
const D = days[N - 1];

// ---- watch list -----------------------------------------------------------------------------------------------------
{
  const stress = stressSeries(c);
  assert.equal(stress.get(days[FALL - 5]), false, "a rising market is not stress");
  assert.equal(stress.get(D), true, "volatility high + SPY under a falling 50-day + 5%+ off its high");
  const w = buildWatch(c, D);
  assert.equal(w.stress, true);
  assert.ok(w.liveEpisode && w.liveEpisode.sessions > 3, JSON.stringify(w.liveEpisode));
  assert.ok(w.spyFromHigh! < -0.05);
  assert.equal(w.unwind, true, "a theme ETF that led the year by 15%+ trails by 8%+ over 60 days, equal weight beats SPY");
  assert.ok(w.unwinding.some((t) => t.includes("SEMIS")), JSON.stringify(w.unwinding));
  assert.equal(w.holdingGroup?.etf, "VHT", "the group that held up best before the episode");
  assert.equal(w.markers.length, Object.keys(MARKERS).length);
  assert.ok(w.markers.every((m) => m.researchRecord), "each marker carries the research's record");
  assert.match(w.sources.volatility, /VIXY proxy/, "the list says the VIX is a proxy");
  // one pass of marker fires serves every date: the same answer as computing up to that date
  const pre = watchSeries(c);
  for (const d of [days[N - 10], days[N - 3], D]) {
    const a = buildWatch(c, d, pre), b = buildWatch(c, d, { stress: stressSeries(c), fires: watchSeries(makeCtx({ ...data, etf: Object.fromEntries(Object.entries(etf).map(([s, x]) => [s, x.filter((y) => y.date <= d)])) })).fires });
    assert.deepEqual(a.markers.map((m) => [m.firedToday, m.recent]), b.markers.map((m) => [m.firedToday, m.recent]), d);
  }
}

// ---- card -------------------------------------------------------------------------------------------------------------
{
  const card = buildCard(c, D, { setupsToday: { leaderShakeout: [{ symbol: "X" }] }, mfRegime: "DEFENSIVE" })!;
  assert.equal(card.version, CARD_VERSION);
  assert.equal(card.label, labels.get(D)!.label);
  assert.equal(card.label, "DOWN");
  assert.equal(card.inputs.themeBreadth, 0.2);
  assert.equal(card.mfRegime, "DEFENSIVE");
  assert.ok(card.sameLabelDays >= 0 && card.labelHistoryDays > 300);
  assert.equal(card.detectors.length >= 1, true);
  const ai = card.detectors[0];
  assert.equal(ai.etf, "SMH");
  const under50 = ai.detectors.find((x) => x.key === "under50")!;
  assert.equal(under50.state, "ON", "SMH (follows SPY here) is under its 50-day");
  assert.equal(ai.detectors.find((x) => x.key === "breadth50")!.state, "n/a", "no member bars: n/a, not off");
  assert.match(ai.stagedRule, /^(REDUCE|OUT) since /);
  assert.ok(card.destinations.top.length > 0);
  assert.deepEqual((card.setupsToday as any).leaderShakeout, [{ symbol: "X" }]);
  assert.ok(card.sources.missing.some((m) => /Cboe VIX/.test(m)));
  // same-label history only counts days whose breadth had 100+ names
  const thin = makeCtx({ ...data, labels: new Map([...labels].map(([d, l]) => [d, { ...l, breadthN: 20 }])) });
  assert.equal(buildCard(thin, D)!.labelHistoryDays, 0);
  assert.equal(buildCard(c, "1999-01-01"), null, "no label, no card");
  assert.equal(stagedState(c, "SPY", [], 260, 300), "IN all year", "a steady rise never leaves IN");
}

// ---- the job: append-only, each date once, from CARD_START --------------------------------------------------------
(async () => {
  const rows = new Map<string, { label: string | null; source: string }>();
  const stockBars = new Map<string, DBar[]>([["AAA", path((i) => 50 + i * 0.1, () => 1e6)]]);
  const src: CardSource = {
    async readySessions() { return days; },
    async doneDates() { return new Set(rows.keys()); },
    async symbols() { return ["AAA"]; },
    async bars(s, from) { return new Map(s.map((x) => [x, (stockBars.get(x) ?? []).filter((b) => b.date >= from)])); },
    async etfBars() { return etf; },
    themeMembers: () => ({ SEMIS: ["AAA"] }),
    async mfRanks() { return new Map(); },
    async setupsOn() { return { leaderShakeout: [], earningsGapUp: [] }; },
    mfRegime: () => null,
    async insert(d, label, _card, _watch, source) { if (rows.has(d)) return 0; rows.set(d, { label, source }); return 1; },
  };
  const r1: any = await runMarketCard(src, { maxDates: 5 });
  assert.equal(r1.dates, 5);
  assert.equal(r1.written, 5);
  assert.ok([...rows.keys()].every((d) => d >= "2025-06-02"));
  assert.equal(rows.get(D)!.source, "daily");
  assert.equal(rows.get(days[N - 2])!.source, "backfill");
  const r2: any = await runMarketCard(src, { maxDates: 5 });
  assert.equal(r2.written, 5, "the next five back");
  assert.equal(rows.size, 10);
  console.log("market-card tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
