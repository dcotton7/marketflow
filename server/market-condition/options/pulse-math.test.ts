import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compactSnapshot,
  computeOptionsPulse,
  contractPremium,
  formatOiAsOfLabel,
  parseOccSymbol,
  parseOpenInterest,
  putCallRatio,
  type OpenInterestEntry,
  type RawOptionContract,
  type RawOptionSnapshot,
} from "./pulse-math";
import { CallBudget, budgetLimitFromEnv } from "./budget";

const here = dirname(fileURLToPath(import.meta.url));
const chain = JSON.parse(readFileSync(join(here, "__fixtures__/aapl-chain-small.json"), "utf8")) as {
  snapshots: Record<string, RawOptionSnapshot>;
};
const contractsRaw = JSON.parse(readFileSync(join(here, "__fixtures__/aapl-contracts-small.json"), "utf8")) as {
  option_contracts: RawOptionContract[];
};

const close = (a: number | null, b: number, eps = 1e-9) => {
  assert.ok(a != null, `expected ${b}, got null`);
  assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
};

// OCC symbol parsing
assert.deepEqual(parseOccSymbol("AAPL261007C00330000"), { root: "AAPL", expiration: "2026-10-07", type: "call", strike: 330 });
assert.deepEqual(parseOccSymbol("SPY261016P00672500"), { root: "SPY", expiration: "2026-10-16", type: "put", strike: 672.5 });
assert.equal(parseOccSymbol("not-a-contract"), null);

// P/C ratio and premium
close(putCallRatio(200, 50), 0.25);
assert.equal(putCallRatio(0, 50), null, "no call volume -> null, not Infinity");
close(contractPremium(10, 2.5), 2500);
assert.equal(contractPremium(10, null), 0);
assert.equal(contractPremium(0, 3), 0);

// OI parsing + date label
assert.deepEqual(parseOpenInterest({ symbol: "X", open_interest: "1048", open_interest_date: "2026-10-01" }), { oi: 1048, date: "2026-10-01" });
assert.deepEqual(parseOpenInterest({ symbol: "X", open_interest: null, open_interest_date: null }), { oi: null, date: null });
assert.equal(formatOiAsOfLabel("2026-10-01"), "OI as of 2026-10-01");
assert.equal(formatOiAsOfLabel(null), "OI date n/a");

// Compact snapshots: missing greeks/IV stay null (never 0)
const contracts = Object.entries(chain.snapshots).map(([sym, s]) => compactSnapshot(sym, s)!);
assert.equal(contracts.length, 7);
const deepItm = contracts.find((c) => c.symbol === "AAPL261005C00250000")!;
assert.equal(deepItm.iv, null);
const quoteOnly = contracts.find((c) => c.symbol === "AAPL261007P00335000")!;
assert.equal(quoteOnly.volume, 0);
assert.equal(quoteOnly.vwap, null);

const oi = new Map<string, OpenInterestEntry>();
for (const raw of contractsRaw.option_contracts) oi.set(raw.symbol, parseOpenInterest(raw));

const scope = { maxDte: 30, strikeBandPct: 15, truncated: false };

// Full pulse at spot 332.77 (real AAPL print): nearest DTE>=1 expiry is 10-07, nearest strike with both legs is 335
const pulse = computeOptionsPulse({ symbol: "AAPL", spot: 332.77, contracts, openInterest: oi, today: "2026-10-05", scope });
assert.equal(pulse.callVolume, 37 + 1000 + 610 + 300);
assert.equal(pulse.putVolume, 800 + 4625);
close(pulse.pcVolumeRatio, 5425 / 1947);
close(pulse.callPremium, (37 * 83.74973 + 1000 * 3.0 + 610 * 5.213492 + 300 * 2.1) * 100, 1e-6);
close(pulse.putPremium, (800 * 0.5 + 4625 * 1.074664) * 100, 1e-6);
assert.equal(pulse.volumeDate, "2026-10-05");
assert.equal(pulse.scope.expirations, 2);
assert.equal(pulse.scope.contracts, 7);

assert.ok(pulse.openInterest);
assert.equal(pulse.openInterest.total, 500 + 1048 + 2210);
assert.equal(pulse.openInterest.contractsWithOi, 3);
assert.equal(pulse.openInterest.asOfDate, "2026-10-01", "most common OI date wins");
assert.equal(pulse.openInterest.label, "OI as of 2026-10-01");
close(pulse.volumeVsOi, (1947 + 5425) / 3758);

assert.equal(pulse.atm.expiration, "2026-10-07", "same-day expiry skipped");
assert.equal(pulse.atm.dte, 2);
assert.equal(pulse.atm.strike, 335);
assert.equal(pulse.atm.iv, null, "missing IV on both legs -> n/a");
assert.equal(pulse.atm.callIv, null);
close(pulse.atm.straddleMid, 2.05 + 4.0);
close(pulse.atm.expectedMovePct, ((2.05 + 4.0) / 332.77) * 100);
close(pulse.ivCoveragePct, (4 / 7) * 100);

// Spot 330: ATM strike 330 with IV on both legs
const at330 = computeOptionsPulse({ symbol: "AAPL", spot: 330, contracts, openInterest: oi, today: "2026-10-05", scope });
assert.equal(at330.atm.strike, 330);
close(at330.atm.iv, (0.2473 + 0.2495) / 2);
close(at330.atm.straddleMid, 4.1 + 1.28);
close(at330.atm.expectedMove, 5.38);

// One leg missing IV -> use the other leg only
const oneLeg = contracts.map((c) => (c.symbol === "AAPL261007P00330000" ? { ...c, iv: null } : c));
close(computeOptionsPulse({ symbol: "AAPL", spot: 330, contracts: oneLeg, today: "2026-10-05", scope }).atm.iv, 0.2473);

// One-sided quote -> no straddle / expected move (n/a, not 0)
const noBid = contracts.map((c) => (c.symbol === "AAPL261007P00330000" ? { ...c, bid: null } : c));
const noBidPulse = computeOptionsPulse({ symbol: "AAPL", spot: 330, contracts: noBid, today: "2026-10-05", scope });
assert.equal(noBidPulse.atm.straddleMid, null);
assert.equal(noBidPulse.atm.expectedMovePct, null);

// OI not requested -> openInterest null; OI requested but none returned -> total null, label n/a
const noOiReq = computeOptionsPulse({ symbol: "AAPL", spot: 330, contracts, today: "2026-10-05", scope });
assert.equal(noOiReq.openInterest, null);
assert.equal(noOiReq.volumeVsOi, null);
const emptyOi = computeOptionsPulse({ symbol: "AAPL", spot: 330, contracts, openInterest: new Map(), today: "2026-10-05", scope });
assert.equal(emptyOi.openInterest?.total, null);
assert.equal(emptyOi.openInterest?.label, "OI date n/a");
assert.equal(emptyOi.volumeVsOi, null);

// Empty chain / missing spot
const empty = computeOptionsPulse({ symbol: "ZZZZ", spot: null, contracts: [], today: "2026-10-05", scope });
assert.equal(empty.pcVolumeRatio, null);
assert.equal(empty.callPremiumSharePct, null);
assert.equal(empty.atm.iv, null);
assert.equal(empty.atm.expectedMovePct, null);

// Call budget: refuses past the per-minute cap, frees up after 60s
const budget = new CallBudget("test", 3);
assert.ok(budget.tryTake(0) && budget.tryTake(1) && budget.tryTake(2));
assert.equal(budget.tryTake(3), false);
assert.throws(() => budget.take(4), /budget exceeded/);
assert.equal(budget.tryTake(60_001), true);
assert.equal(budgetLimitFromEnv(undefined, 300, 1000), 300);
assert.equal(budgetLimitFromEnv("5000", 300, 1000), 1000, "never above hard max");
assert.equal(budgetLimitFromEnv("abc", 300, 1000), 300);

console.log("options pulse math: all assertions passed");
