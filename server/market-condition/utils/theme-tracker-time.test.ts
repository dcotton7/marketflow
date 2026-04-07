/**
 * Manual tests for theme-tracker-time utilities
 * Run with: tsx server/market-condition/utils/theme-tracker-time.test.ts
 */

import { deriveTradingRangeWindow, raceLookbackStart, subtractTradingDays } from "./theme-tracker-time";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testSubtractTradingDays(): void {
  console.log("\n=== Testing subtractTradingDays ===");

  // Test 1: Friday -> Thursday (1 trading day back)
  const friday = new Date("2026-03-27T12:00:00Z"); // Friday
  const result1 = subtractTradingDays(friday, 1);
  const expected1 = new Date("2026-03-26T00:00:00.000Z"); // Thursday
  assert(
    result1.toISOString() === expected1.toISOString(),
    `Friday - 1 trading day should be Thursday. Got: ${result1.toISOString()}, Expected: ${expected1.toISOString()}`
  );
  console.log("✓ Test 1 passed: Friday - 1 trading day = Thursday");

  // Test 2: Monday -> Friday (1 trading day back, spans weekend)
  const monday = new Date("2026-03-30T12:00:00Z"); // Monday
  const result2 = subtractTradingDays(monday, 1);
  const expected2 = new Date("2026-03-27T00:00:00.000Z"); // Friday
  assert(
    result2.toISOString() === expected2.toISOString(),
    `Monday - 1 trading day should be Friday (skipping weekend). Got: ${result2.toISOString()}, Expected: ${expected2.toISOString()}`
  );
  console.log("✓ Test 2 passed: Monday - 1 trading day = Friday (skipped weekend)");

  // Test 3: Friday -> Monday (3 trading days back)
  const friday2 = new Date("2026-03-27T12:00:00Z"); // Friday
  const result3 = subtractTradingDays(friday2, 3);
  const expected3 = new Date("2026-03-24T00:00:00.000Z"); // Tuesday
  assert(
    result3.toISOString() === expected3.toISOString(),
    `Friday - 3 trading days should be Tuesday. Got: ${result3.toISOString()}, Expected: ${expected3.toISOString()}`
  );
  console.log("✓ Test 3 passed: Friday - 3 trading days = Tuesday");

  // Test 4: Result should be at 00:00:00.000 UTC
  const someDate = new Date("2026-03-27T14:30:45.123Z");
  const result4 = subtractTradingDays(someDate, 0);
  assert(
    result4.getUTCHours() === 0 &&
      result4.getUTCMinutes() === 0 &&
      result4.getUTCSeconds() === 0 &&
      result4.getUTCMilliseconds() === 0,
    "Result should be normalized to 00:00:00.000 UTC"
  );
  console.log("✓ Test 4 passed: Result normalized to 00:00:00.000 UTC");
}

function testRaceLookbackStart(): void {
  console.log("\n=== Testing raceLookbackStart ===");

  // Test 1: "3d" should use trading days
  const result1 = raceLookbackStart("3d", "daily");
  assert(result1.interpretation === "trading", "3d should use trading day interpretation");
  console.log(`✓ Test 1 passed: "3d" uses trading day interpretation`);
  console.log(`  From date: ${result1.fromDateStr}`);

  // Test 2: "1mo" should use calendar days
  const result2 = raceLookbackStart("1mo", "daily");
  assert(result2.interpretation === "calendar", "1mo should use calendar day interpretation");
  console.log(`✓ Test 2 passed: "1mo" uses calendar day interpretation`);
  console.log(`  From date: ${result2.fromDateStr}`);

  // Test 3: "2w" should use trading days (10 trading days)
  const result3 = raceLookbackStart("2w", "daily");
  assert(result3.interpretation === "trading", "2w should use trading day interpretation");
  console.log(`✓ Test 3 passed: "2w" uses trading day interpretation (10 trading days)`);
  console.log(`  From date: ${result3.fromDateStr}`);

  // Test 4: Unknown range key should fallback gracefully
  const result4 = raceLookbackStart("unknown", "daily");
  assert(result4.fromDateStr.length === 10, "Should return valid date string for unknown key");
  assert(result4.interpretation === "calendar", "Unknown key should fallback to calendar");
  console.log(`✓ Test 4 passed: Unknown range key handled gracefully`);
  console.log(`  From date: ${result4.fromDateStr}, interpretation: ${result4.interpretation}`);

  // Test 5: fromDateStr should be in YYYY-MM-DD format
  const result5 = raceLookbackStart("5d", "daily");
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  assert(dateRegex.test(result5.fromDateStr), "fromDateStr should be in YYYY-MM-DD format");
  console.log(`✓ Test 5 passed: fromDateStr is in YYYY-MM-DD format: ${result5.fromDateStr}`);

  // Test 6: fromInstant should be a valid Date
  const result6 = raceLookbackStart("1d", "intraday");
  assert(result6.fromInstant instanceof Date, "fromInstant should be a Date object");
  assert(!isNaN(result6.fromInstant.getTime()), "fromInstant should be a valid Date");
  console.log(`✓ Test 6 passed: fromInstant is a valid Date: ${result6.fromInstant.toISOString()}`);
}

function testDeriveTradingRangeWindow(): void {
  console.log("\n=== Testing deriveTradingRangeWindow ===");

  const marketDates = [
    "2026-01-15",
    "2026-01-16",
    // 2026-01-19 intentionally omitted to simulate MLK holiday
    "2026-01-20",
    "2026-01-21",
    "2026-01-22",
  ];

  const liveResult = deriveTradingRangeWindow("3d", marketDates, new Date("2026-01-22T15:00:00Z"));
  assert(liveResult != null, "Expected trading range window for live session");
  assert(liveResult?.fromDateStr === "2026-01-16", `Expected start at 2026-01-16, got ${liveResult?.fromDateStr}`);
  assert(liveResult?.terminalState === "LIVE", `Expected LIVE terminal state, got ${liveResult?.terminalState}`);
  console.log("✓ Test 1 passed: 3d live window skips market holiday and starts on the prior open session");

  const preOpenResult = deriveTradingRangeWindow("3d", marketDates, new Date("2026-01-22T13:00:00Z"));
  assert(preOpenResult != null, "Expected trading range window before open");
  assert(preOpenResult?.fromDateStr === "2026-01-16", `Expected start at 2026-01-16 before open, got ${preOpenResult?.fromDateStr}`);
  assert(preOpenResult?.terminalState === "PRE_OPEN", `Expected PRE_OPEN terminal state, got ${preOpenResult?.terminalState}`);
  console.log("✓ Test 2 passed: pre-open state excludes today from terminal playback state");

  const closedResult = deriveTradingRangeWindow("3d", marketDates, new Date("2026-01-24T16:00:00Z"));
  assert(closedResult != null, "Expected trading range window on weekend");
  assert(closedResult?.fromDateStr === "2026-01-16", `Expected start at 2026-01-16 on weekend fallback, got ${closedResult?.fromDateStr}`);
  assert(closedResult?.terminalState === "CLOSED", `Expected CLOSED terminal state, got ${closedResult?.terminalState}`);
  console.log("✓ Test 3 passed: weekend state reports CLOSED terminal playback");
}

function runAllTests(): void {
  console.log("Running theme-tracker-time utility tests...");

  try {
    testSubtractTradingDays();
    testRaceLookbackStart();
    testDeriveTradingRangeWindow();
    console.log("\n✅ All tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
// Just run the tests since this is a test file
runAllTests();
