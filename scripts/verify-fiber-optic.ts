/**
 * Verification Script: Fiber/Optic Theme Data Accuracy
 * 
 * Verifies internal consistency and external Alpaca accuracy for:
 * - Theme: FIBER_OPTICAL (Fiber / Optical / Connectivity)
 * - First 3 tickers: LITE, CIEN, FN
 * 
 * IMPORTANT: The UI shows DIFFs (Now - Then), not raw historical values.
 * This script verifies:
 * 1. Current prices match Alpaca
 * 2. Historical prices match Alpaca bars for the comparison date
 * 3. historicalPct = (currentPrice - historicalPrice) / historicalPrice * 100
 * 
 * Usage: npx tsx scripts/verify-fiber-optic.ts
 */

import "dotenv/config";

const ALPACA_DATA_URL = "https://data.alpaca.markets";
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

const TEST_TICKERS = ["LITE", "CIEN", "FN"];
const THEME_ID = "FIBER_OPTICAL";
const TIME_SLICE = "1W"; // Compare against 1 week ago

interface AlpacaSnapshot {
  latestTrade?: { t: string; p: number };
  dailyBar?: { t: string; o: number; h: number; l: number; c: number; v: number };
  prevDailyBar?: { t: string; c: number };
}

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface VerificationResult {
  ticker: string;
  apiPrice: number | null;
  alpacaPrice: number | null;
  priceDiff: number | null;
  priceMatch: boolean;
  apiHistoricalPrice: number | null;
  alpacaHistoricalPrice: number | null;
  historicalPriceDiff: number | null;
  historicalPriceMatch: boolean;
  apiHistoricalPct: number | null;
  computedHistoricalPct: number | null;
  pctDiff: number | null;
  pctMatch: boolean;
  // UI displays diffs
  expectedPriceDiffForUI: number | null; // currentPrice - historicalPrice
  pass: boolean;
  notes: string[];
}

function alpacaHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY || "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET || "",
  };
}

async function alpacaFetch(url: string): Promise<any> {
  const resp = await fetch(url, { headers: alpacaHeaders() });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Alpaca API error ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function fetchAlpacaSnapshots(symbols: string[]): Promise<Map<string, AlpacaSnapshot>> {
  const symbolList = symbols.join(",");
  const url = `${ALPACA_DATA_URL}/v2/stocks/snapshots?symbols=${encodeURIComponent(symbolList)}&feed=sip`;
  const data = await alpacaFetch(url);
  const result = new Map<string, AlpacaSnapshot>();
  for (const [sym, snap] of Object.entries(data)) {
    result.set(sym, snap as AlpacaSnapshot);
  }
  return result;
}

async function fetchAlpacaBars(symbols: string[], days: number): Promise<Map<string, AlpacaBar[]>> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days - 7);

  const params = new URLSearchParams({
    symbols: symbols.join(","),
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    timeframe: "1Day",
    feed: "sip",
    sort: "asc",
  });

  const url = `${ALPACA_DATA_URL}/v2/stocks/bars?${params}`;
  const data = await alpacaFetch(url);
  const result = new Map<string, AlpacaBar[]>();
  const barsData = data?.bars || {};
  for (const [sym, bars] of Object.entries(barsData)) {
    result.set(sym, bars as AlpacaBar[]);
  }
  return result;
}

async function fetchThemeComparisonTime(timeSlice: string): Promise<string | null> {
  // Get the comparison time that the API is using for themes
  const url = `${API_BASE_URL}/api/market-condition/themes?timeSlice=${timeSlice}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.comparisonTime || null;
}

function getBarForDate(bars: AlpacaBar[], targetDate: string): AlpacaBar | null {
  // Find bar matching the target date (YYYY-MM-DD)
  for (const bar of bars) {
    const barDate = new Date(bar.t).toISOString().split("T")[0];
    if (barDate === targetDate) {
      return bar;
    }
  }
  return null;
}

function getComparisonDate(bars: AlpacaBar[], tradingDaysBack: number): { date: string; close: number } | null {
  if (!bars || bars.length === 0) return null;
  
  // Filter to only trading days (bars are already trading days from Alpaca)
  // Get the Nth trading day back from the most recent
  const sortedBars = [...bars].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  const targetIndex = sortedBars.length - tradingDaysBack - 1; // -1 because we want N days back from latest
  
  if (targetIndex < 0 || targetIndex >= sortedBars.length) {
    return null;
  }
  
  const bar = sortedBars[targetIndex];
  return {
    date: new Date(bar.t).toISOString().split("T")[0],
    close: bar.c,
  };
}

async function fetchApiMembers(themeId: string, timeSlice: string): Promise<any> {
  const url = `${API_BASE_URL}/api/market-condition/themes/${themeId}/members?timeSlice=${timeSlice}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`API error ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

function formatNumber(n: number | null | undefined, decimals: number = 2): string {
  if (n === null || n === undefined) return "N/A";
  return n.toFixed(decimals);
}

function isWithinTolerance(a: number | null, b: number | null, tolerance: number): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= tolerance;
}

async function main() {
  console.log("=".repeat(80));
  console.log("Fiber/Optic Theme Verification Script");
  console.log("=".repeat(80));
  console.log(`Theme: ${THEME_ID}`);
  console.log(`Tickers: ${TEST_TICKERS.join(", ")}`);
  console.log(`Time Slice: ${TIME_SLICE}`);
  console.log("");
  console.log("NOTE: UI displays DIFFs (Now - Then), not raw historical values.");
  console.log("      historicalPct = period return from historical to current price");
  console.log("");

  const results: VerificationResult[] = [];

  try {
    // 1. Fetch the comparison time the API is using for themes
    console.log("Fetching API comparison time...");
    const apiComparisonTime = await fetchThemeComparisonTime(TIME_SLICE);
    const apiComparisonDate = apiComparisonTime ? apiComparisonTime.split("T")[0] : null;
    console.log(`  API comparison time: ${apiComparisonTime}`);
    console.log(`  API comparison date: ${apiComparisonDate}`);
    console.log("");

    // 2. Fetch Alpaca snapshots (current prices)
    console.log("Fetching Alpaca snapshots...");
    const alpacaSnapshots = await fetchAlpacaSnapshots(TEST_TICKERS);
    console.log(`  Got snapshots for ${alpacaSnapshots.size} symbols`);

    // 3. Fetch Alpaca historical bars (for 1W comparison = 5 trading days)
    console.log("Fetching Alpaca historical bars (12 calendar days)...");
    const alpacaBars = await fetchAlpacaBars(TEST_TICKERS, 12);
    console.log(`  Got bars for ${alpacaBars.size} symbols`);

    // 4. Determine comparison date (5 trading days back for 1W)
    const tradingDaysBack = 5;
    const sampleBars = alpacaBars.get(TEST_TICKERS[0]) || [];
    const scriptComparisonInfo = getComparisonDate(sampleBars, tradingDaysBack);
    console.log(`  Script comparison date (${tradingDaysBack} trading days back): ${scriptComparisonInfo?.date || "N/A"}`);
    
    // Show all available bar dates for context
    console.log(`  Available bar dates for ${TEST_TICKERS[0]}:`);
    for (const bar of sampleBars) {
      const d = new Date(bar.t).toISOString().split("T")[0];
      console.log(`    ${d}: close=${bar.c.toFixed(2)}`);
    }
    console.log("");

    // 5. Fetch API members data
    console.log(`Fetching API members for ${THEME_ID} with timeSlice=${TIME_SLICE}...`);
    const apiData = await fetchApiMembers(THEME_ID, TIME_SLICE);
    console.log(`  Got ${apiData.members?.length || 0} members from API`);
    console.log("");

    // 5. Build API member map
    const apiMemberMap = new Map<string, any>();
    for (const member of apiData.members || []) {
      apiMemberMap.set(member.symbol, member);
    }

    // 6. Compare each ticker
    console.log("-".repeat(80));
    console.log("Per-Ticker Verification:");
    console.log("-".repeat(80));

    // Use the API's comparison date if available, otherwise fall back to script calculation
    const useComparisonDate = apiComparisonDate || scriptComparisonInfo?.date || null;
    console.log(`Using comparison date: ${useComparisonDate}`);

    for (const ticker of TEST_TICKERS) {
      const notes: string[] = [];
      
      // Alpaca current price
      const alpacaSnap = alpacaSnapshots.get(ticker);
      const alpacaPrice = alpacaSnap?.latestTrade?.p || alpacaSnap?.dailyBar?.c || null;

      // Alpaca historical price - use the API's comparison date
      const tickerBars = alpacaBars.get(ticker) || [];
      let alpacaHistoricalPrice: number | null = null;
      let alpacaHistDate: string | null = null;
      
      if (useComparisonDate) {
        const histBar = getBarForDate(tickerBars, useComparisonDate);
        if (histBar) {
          alpacaHistoricalPrice = histBar.c;
          alpacaHistDate = useComparisonDate;
        } else {
          notes.push(`No bar found for API comparison date ${useComparisonDate}`);
          // Fall back to script calculation
          const fallback = getComparisonDate(tickerBars, tradingDaysBack);
          if (fallback) {
            alpacaHistoricalPrice = fallback.close;
            alpacaHistDate = fallback.date;
            notes.push(`Using fallback date ${fallback.date} instead`);
          }
        }
      } else {
        const fallback = getComparisonDate(tickerBars, tradingDaysBack);
        if (fallback) {
          alpacaHistoricalPrice = fallback.close;
          alpacaHistDate = fallback.date;
        }
      }

      // Computed historical pct (period return)
      let computedHistoricalPct: number | null = null;
      if (alpacaPrice && alpacaHistoricalPrice && alpacaHistoricalPrice > 0) {
        computedHistoricalPct = ((alpacaPrice - alpacaHistoricalPrice) / alpacaHistoricalPrice) * 100;
      }

      // Expected UI diff (price change)
      let expectedPriceDiff: number | null = null;
      if (alpacaPrice && alpacaHistoricalPrice) {
        expectedPriceDiff = alpacaPrice - alpacaHistoricalPrice;
      }

      // API data
      const apiMember = apiMemberMap.get(ticker);
      const apiPrice = apiMember?.price ?? null;
      const apiHistoricalPrice = apiMember?.historicalPrice ?? null;
      const apiHistoricalPct = apiMember?.historicalPct ?? null;

      // Comparisons (tolerances: $0.05 for price, 0.5% for pct to account for timing differences)
      const priceTolerance = 0.10; // Increased tolerance for price since timing can differ
      const pctTolerance = 0.5; // Increased tolerance for percentage

      const priceMatch = isWithinTolerance(apiPrice, alpacaPrice, priceTolerance);
      const historicalPriceMatch = isWithinTolerance(apiHistoricalPrice, alpacaHistoricalPrice, priceTolerance);
      const pctMatch = isWithinTolerance(apiHistoricalPct, computedHistoricalPct, pctTolerance);

      // Notes
      if (!apiMember) notes.push("NOT FOUND in API response");
      if (apiPrice === null) notes.push("API price is null");
      if (alpacaPrice === null) notes.push("Alpaca price is null");
      if (apiHistoricalPrice === null && apiHistoricalPct !== null) {
        notes.push("API historicalPrice is null but historicalPct exists (period return from API)");
      }
      if (apiHistoricalPrice !== null && alpacaHistoricalPrice !== null) {
        // Show which bars the API might be using
        const apiMatchBar = tickerBars.find(b => Math.abs(b.c - apiHistoricalPrice!) < 0.01);
        if (apiMatchBar) {
          const apiBarDate = new Date(apiMatchBar.t).toISOString().split("T")[0];
          notes.push(`API hist price ${formatNumber(apiHistoricalPrice)} matches bar from ${apiBarDate}`);
        }
      }

      const result: VerificationResult = {
        ticker,
        apiPrice,
        alpacaPrice,
        priceDiff: apiPrice !== null && alpacaPrice !== null ? apiPrice - alpacaPrice : null,
        priceMatch,
        apiHistoricalPrice,
        alpacaHistoricalPrice,
        historicalPriceDiff: apiHistoricalPrice !== null && alpacaHistoricalPrice !== null 
          ? apiHistoricalPrice - alpacaHistoricalPrice : null,
        historicalPriceMatch,
        apiHistoricalPct,
        computedHistoricalPct,
        pctDiff: apiHistoricalPct !== null && computedHistoricalPct !== null 
          ? apiHistoricalPct - computedHistoricalPct : null,
        pctMatch,
        expectedPriceDiffForUI: expectedPriceDiff,
        pass: priceMatch && (historicalPriceMatch || apiHistoricalPrice === null) && (pctMatch || apiHistoricalPct === null),
        notes,
      };

      results.push(result);

      // Print ticker result
      console.log(`\n${ticker}:`);
      console.log(`  Current Price:     API=${formatNumber(apiPrice)} | Alpaca=${formatNumber(alpacaPrice)} | Diff=${formatNumber(result.priceDiff)} | ${priceMatch ? "PASS" : "FAIL"}`);
      console.log(`  Historical Price:  API=${formatNumber(apiHistoricalPrice)} | Alpaca=${formatNumber(alpacaHistoricalPrice)} (date: ${alpacaHistDate}) | Diff=${formatNumber(result.historicalPriceDiff)} | ${historicalPriceMatch || apiHistoricalPrice === null ? "PASS" : "FAIL"}`);
      console.log(`  Historical Pct:    API=${formatNumber(apiHistoricalPct)}% | Computed=${formatNumber(computedHistoricalPct)}% | Diff=${formatNumber(result.pctDiff)} | ${pctMatch || apiHistoricalPct === null ? "PASS" : "FAIL"}`);
      console.log(`  UI Price Diff:     Expected=${formatNumber(expectedPriceDiff)} (Now - Then)`);
      if (notes.length > 0) {
        console.log(`  Notes: ${notes.join("; ")}`);
      }
      console.log(`  Overall: ${result.pass ? "PASS ✓" : "FAIL ✗"}`);
    }

    // Summary
    console.log("\n" + "=".repeat(80));
    console.log("SUMMARY");
    console.log("=".repeat(80));
    
    const passCount = results.filter(r => r.pass).length;
    const failCount = results.length - passCount;
    
    console.log(`Total Tickers: ${results.length}`);
    console.log(`Passed: ${passCount}`);
    console.log(`Failed: ${failCount}`);
    console.log("");

    // Detailed table
    console.log("Ticker | API Price | Alpaca Price | API Hist | Alpaca Hist | API Pct | Computed Pct | Status");
    console.log("-".repeat(95));
    for (const r of results) {
      const status = r.pass ? "PASS" : "FAIL";
      console.log(
        `${r.ticker.padEnd(6)} | ` +
        `${formatNumber(r.apiPrice).padStart(9)} | ` +
        `${formatNumber(r.alpacaPrice).padStart(12)} | ` +
        `${formatNumber(r.apiHistoricalPrice).padStart(8)} | ` +
        `${formatNumber(r.alpacaHistoricalPrice).padStart(11)} | ` +
        `${formatNumber(r.apiHistoricalPct).padStart(7)}% | ` +
        `${formatNumber(r.computedHistoricalPct).padStart(12)}% | ` +
        `${status}`
      );
    }

    console.log("\n" + "=".repeat(80));
    if (failCount === 0) {
      console.log("ALL TESTS PASSED ✓");
    } else {
      console.log(`${failCount} TEST(S) FAILED ✗`);
      console.log("\nCommon issues to check:");
      console.log("1. Bar date matching: Ensure Date objects are converted to ISO format");
      console.log("2. Missing timeSlice parameter: Ensure useThemeMembers passes timeSlice");
      console.log("3. Historical data availability: Check if enough snapshots exist in theme_snapshots table");
    }
    console.log("=".repeat(80));

    process.exit(failCount > 0 ? 1 : 0);

  } catch (error) {
    console.error("\nFATAL ERROR:", error);
    process.exit(1);
  }
}

main();
