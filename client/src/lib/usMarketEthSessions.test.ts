import { getEtClockParts, rthSessionBoundaryTimes, RTH_CLOSE_MIN, RTH_OPEN_MIN } from "./usMarketEthSessions";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function utcSec(y: number, m: number, d: number, h: number, min: number): number {
  return Math.floor(Date.UTC(y, m - 1, d, h, min, 0) / 1000);
}

function testClock() {
  const openEst = utcSec(2024, 1, 16, 14, 30);
  const closeEst = utcSec(2024, 1, 16, 21, 0);
  const openEdt = utcSec(2024, 7, 16, 13, 30);
  const closeEdt = utcSec(2024, 7, 16, 20, 0);
  assert(getEtClockParts(openEst).totalMin === RTH_OPEN_MIN, "EST 9:30");
  assert(getEtClockParts(closeEst).totalMin === RTH_CLOSE_MIN, "EST 16:00");
  assert(getEtClockParts(openEdt).totalMin === RTH_OPEN_MIN, "EDT 9:30");
  assert(getEtClockParts(closeEdt).totalMin === RTH_CLOSE_MIN, "EDT 16:00");
}

function testBoundariesRthOnly() {
  const times = [
    utcSec(2024, 1, 16, 14, 25),
    utcSec(2024, 1, 16, 14, 30),
    utcSec(2024, 1, 16, 15, 0),
    utcSec(2024, 1, 16, 20, 55),
    utcSec(2024, 1, 17, 14, 30),
    utcSec(2024, 1, 17, 20, 55),
  ];
  const bounds = rthSessionBoundaryTimes(times);
  assert(bounds.length === 4, `expected 4 bounds, got ${bounds.length}`);
  assert(bounds[0] === times[1], "day1 open 9:30");
  assert(bounds[1] === times[3], "day1 last RTH 15:55");
  assert(bounds[2] === times[4], "day2 open");
  assert(bounds[3] === times[5], "day2 last RTH");
}

function testBoundariesWithEthClose() {
  const times = [
    utcSec(2024, 1, 16, 14, 30),
    utcSec(2024, 1, 16, 20, 55),
    utcSec(2024, 1, 16, 21, 0),
  ];
  const bounds = rthSessionBoundaryTimes(times);
  assert(bounds.length === 2, `expected 2, got ${bounds.length}`);
  assert(bounds[0] === times[0], "open");
  assert(bounds[1] === times[2], "16:00 post bar, not 15:55");
}

function testSkipWeekend() {
  const sat = utcSec(2024, 1, 13, 14, 30);
  assert(rthSessionBoundaryTimes([sat]).length === 0, "Saturday skipped");
}

testClock();
testBoundariesRthOnly();
testBoundariesWithEthClose();
testSkipWeekend();
console.log("usMarketEthSessions.test.ts ok");
