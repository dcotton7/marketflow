/**
 * Historical 15-Minute Snapshot Backfill Script
 * 
 * Fetches real historical 15-minute bar data from Alpaca and calculates
 * theme scores for each interval. Populates theme_snapshots table with
 * historical intraday data for Race timeline and Theme Tracker features.
 * 
 * Usage: node server/scripts/backfill15minSnapshots.ts [days]
 * 
 * Arguments:
 *   days - Number of trading days to backfill (default: 30, max depends on Alpaca plan)
 * 
 * Example: node server/scripts/backfill15minSnapshots.ts 10
 */

import 'dotenv/config';
import pkg from 'pg';
const { Client } = pkg;
import { fetchAlpacaTradingCalendar } from '../alpaca';
import { initializeDatabase } from '../db';
import { getAlpacaProvider } from '../market-condition/providers/alpaca';
import {
  getAllThemeTickerSymbols,
  getThemeMembersFromCache,
  initializeThemeMembersCache,
} from '../market-condition/utils/theme-db-loader';
import { CLUSTER_IDS, type ClusterId } from '../market-condition/universe';

const THEME_IDS = CLUSTER_IDS;
const BENCHMARK_SYMBOL = "SPY";

interface TickerBar {
  symbol: string;
  timestamp: Date;
  close: number;
  volume: number;
  vwap: number;
  changePct: number;
}

/**
 * Calculate theme score based on median performance
 */
function calculateThemeScore(tickers: TickerBar[]): { score: number; medianPct: number; breadthPct: number } {
  if (tickers.length === 0) {
    return { score: 50, medianPct: 0, breadthPct: 0 };
  }

  // Sort by change%
  const sorted = [...tickers].sort((a, b) => a.changePct - b.changePct);
  const median = sorted[Math.floor(sorted.length / 2)].changePct;

  // Breadth: % of tickers with positive change
  const positiveCount = tickers.filter(t => t.changePct > 0).length;
  const breadthPct = (positiveCount / tickers.length) * 100;

  // Score: Map median% to 0-100 scale
  // Typical range: -5% to +5% maps to 0-100
  const score = Math.max(0, Math.min(100, 50 + (median * 10)));

  return {
    score,
    medianPct: median,
    breadthPct,
  };
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Rank themes by score
 */
function rankThemes(themes: Map<string, { score: number; medianPct: number; breadthPct: number }>): Map<string, number> {
  const sorted = Array.from(themes.entries()).sort((a, b) => b[1].score - a[1].score);
  const ranks = new Map<string, number>();
  sorted.forEach(([themeId], index) => {
    ranks.set(themeId, index + 1);
  });
  return ranks;
}

function getEtDateString(anchor: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(anchor);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/**
 * Get actual market-session dates to backfill from Alpaca's trading calendar.
 * Excludes weekends, holidays, and today's in-progress session.
 */
async function getTradingDaysToBackfill(daysBack: number): Promise<string[]> {
  const today = new Date();
  const todayEt = getEtDateString(today);
  let lookbackCalendarDays = Math.max(45, Math.ceil(daysBack * 2));

  for (let attempt = 0; attempt < 5; attempt++) {
    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - lookbackCalendarDays);

    const calendar = await fetchAlpacaTradingCalendar(
      startDate.toISOString().slice(0, 10),
      today.toISOString().slice(0, 10)
    );

    const marketDates = calendar
      .map((day) => day.date)
      .filter((date): date is string => typeof date === "string" && date.length === 10)
      .filter((date) => date < todayEt)
      .sort();

    if (marketDates.length >= daysBack) {
      return marketDates.slice(-daysBack); // Oldest first
    }

    lookbackCalendarDays *= 2;
  }

  throw new Error(`Unable to load ${daysBack} trading days from Alpaca calendar`);
}

/**
 * Check if a time is within market hours (9:30 AM - 4:00 PM ET)
 */
function isMarketHours(hour: number, minute: number): boolean {
  if (hour < 9 || hour > 15) return false;
  if (hour === 9 && minute < 30) return false;
  return true;
}

/**
 * Parse timestamp to get ET hour
 */
function getETHour(timestamp: Date): number {
  const etString = timestamp.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  });
  return parseInt(etString.split(":")[0], 10);
}

async function backfillSnapshots(daysBack: number = 30) {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log("✓ Connected to database\n");
    
    console.log(`🔄 Starting historical backfill for ${daysBack} trading days...\n`);

    await initializeDatabase();
    console.log("📊 Initializing theme membership cache...");
    await initializeThemeMembersCache();

    const themeMembersById = new Map<ClusterId, Set<string>>();
    for (const themeId of THEME_IDS) {
      themeMembersById.set(
        themeId,
        new Set(getThemeMembersFromCache(themeId).map((m) => m.symbol.toUpperCase()))
      );
    }

    // Get theme tickers
    console.log("📊 Loading theme constituents...");
    const themeTickers = getAllThemeTickerSymbols(CLUSTER_IDS);
    const tickerSet = new Set(themeTickers);
    tickerSet.add(BENCHMARK_SYMBOL);
    console.log(`✓ Loaded ${tickerSet.size} unique tickers across ${THEME_IDS.length} themes\n`);

    // Get trading days to backfill
    const tradingDays = await getTradingDaysToBackfill(daysBack);
    console.log(`📅 Backfill range: ${tradingDays[0]} to ${tradingDays[tradingDays.length - 1]}`);
    console.log(`   Trading days: ${tradingDays.length}\n`);

    // Check existing snapshots
    const existingCheck = await client.query(`
      SELECT market_date, COUNT(*) as count
      FROM theme_snapshots
      WHERE snapshot_type = 'hourly'
        AND market_date >= $1
        AND market_date <= $2
      GROUP BY market_date
      ORDER BY market_date
    `, [tradingDays[0], tradingDays[tradingDays.length - 1]]);
    
    if (existingCheck.rows.length > 0) {
      console.log("⚠️  Found existing 15-min snapshots for some dates:");
      for (const row of existingCheck.rows) {
        console.log(`   ${row.market_date}: ${row.count} snapshots`);
      }
      console.log("\n   These will be SKIPPED to avoid duplicates.\n");
    }

    const existingDates = new Set(existingCheck.rows.map(r => r.market_date));
    const datesToBackfill = tradingDays.filter(d => !existingDates.has(d));
    const orderedDatesToBackfill = [...datesToBackfill].reverse();

    if (orderedDatesToBackfill.length === 0) {
      console.log("✅ All dates already have snapshots. Nothing to backfill.");
      return;
    }

    console.log(`📥 Fetching 15-minute bars from Alpaca for ${orderedDatesToBackfill.length} days...`);
    console.log(`   This may take several minutes...\n`);

    const provider = getAlpacaProvider();
    let totalInserted = 0;

    // Process in chunks of 5 days to avoid overwhelming the API
    const CHUNK_SIZE = 5;
    for (let chunkStart = 0; chunkStart < orderedDatesToBackfill.length; chunkStart += CHUNK_SIZE) {
      const chunk = orderedDatesToBackfill.slice(chunkStart, chunkStart + CHUNK_SIZE);
      const startDate = new Date(chunk[chunk.length - 1] + "T00:00:00Z");
      const endDate = new Date(chunk[0] + "T23:59:59Z");

      console.log(`📦 Processing chunk: ${chunk[0]} to ${chunk[chunk.length - 1]}`);

      try {
        // Fetch 15-minute bars for all tickers
        const barsMap = await provider.getMultiSymbolIntradayBars(
          Array.from(tickerSet),
          startDate,
          endDate,
          "15Min"
        );

        console.log(`   ✓ Fetched bars for ${barsMap.size} tickers`);

        // Group bars by timestamp
        const barsByTimestamp = new Map<string, TickerBar[]>();
        
        for (const [symbol, bars] of barsMap.entries()) {
          for (const bar of bars) {
            const timestamp = bar.timestamp.toISOString();
            if (!barsByTimestamp.has(timestamp)) {
              barsByTimestamp.set(timestamp, []);
            }

            // Calculate change% from open (intraday)
            const changePct = bar.open > 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0;

            barsByTimestamp.get(timestamp)!.push({
              symbol,
              timestamp: bar.timestamp,
              close: bar.close,
              volume: bar.volume,
              vwap: bar.vwap || bar.close,
              changePct,
            });
          }
        }

        console.log(`   ✓ Organized into ${barsByTimestamp.size} unique 15-min intervals`);

        // Calculate theme scores for each timestamp
        let chunkInserted = 0;
        for (const [timestamp, tickers] of barsByTimestamp.entries()) {
          const ts = new Date(timestamp);
          const marketDate = ts.toISOString().slice(0, 10);
          const hour = getETHour(ts);
          const minute = ts.getUTCMinutes();

          // Skip if not in market hours
          if (!isMarketHours(hour, minute)) continue;

          const spyBar = tickers.find((ticker) => ticker.symbol.toUpperCase() === BENCHMARK_SYMBOL);
          const spyChangePct = spyBar?.changePct ?? 0;

          // Group tickers by theme using the live DB-backed theme membership map
          const themeTickersMap = new Map<ClusterId, TickerBar[]>();
          for (const themeId of THEME_IDS) {
            themeTickersMap.set(themeId, []);
          }

          for (const ticker of tickers) {
            const symbol = ticker.symbol.toUpperCase();
            if (symbol === BENCHMARK_SYMBOL) continue;
            for (const themeId of THEME_IDS) {
              if (themeMembersById.get(themeId)?.has(symbol)) {
                themeTickersMap.get(themeId)!.push(ticker);
              }
            }
          }

          // Calculate scores for each theme
          const themeScores = new Map<ClusterId, { score: number; medianPct: number; breadthPct: number; rsVsBenchmark: number }>();
          for (const [themeId, themeTickers] of themeTickersMap.entries()) {
            if (themeTickers.length === 0) continue;
            const metrics = calculateThemeScore(themeTickers);
            const rsVsBenchmark = calculateMedian(themeTickers.map((ticker) => ticker.changePct - spyChangePct));
            themeScores.set(themeId, { ...metrics, rsVsBenchmark });
          }

          // Rank themes
          const ranks = rankThemes(themeScores);

          // Insert snapshots
          for (const [themeId, metrics] of themeScores.entries()) {
            const rank = ranks.get(themeId) || 999;

            await client.query(`
              INSERT INTO theme_snapshots (
                theme_id, rank, score, median_pct, rs_vs_benchmark, breadth_pct,
                acc_dist_days, snapshot_type, market_date, snapshot_hour, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT DO NOTHING
            `, [
              themeId,
              rank,
              metrics.score,
              metrics.medianPct,
              metrics.rsVsBenchmark,
              metrics.breadthPct,
              null, // acc_dist_days
              "hourly",
              marketDate,
              hour,
              ts
            ]);

            chunkInserted++;
          }
        }

        totalInserted += chunkInserted;
        console.log(`   ✓ Inserted ${chunkInserted} snapshots\n`);

        // Rate limiting: pause between chunks
        if (chunkStart + CHUNK_SIZE < orderedDatesToBackfill.length) {
          console.log("   ⏸️  Pausing 2s to respect API rate limits...\n");
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        console.error(`   ❌ Error processing chunk: ${error}`);
        console.log("   Continuing with next chunk...\n");
      }
    }

    console.log(`\n✅ Backfill complete!`);
    console.log(`   Total snapshots inserted: ${totalInserted}`);
    console.log(`   Days processed: ${orderedDatesToBackfill.length}`);
    console.log(`   Themes: ${THEME_IDS.length}`);

  } catch (error) {
    console.error("❌ Backfill failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }

  process.exit(0);
}

// Parse command line args
const daysArg = process.argv[2];
const daysBack = daysArg ? parseInt(daysArg, 10) : 30;

if (isNaN(daysBack) || daysBack < 1) {
  console.error("❌ Invalid days argument. Usage: node backfill15minSnapshots.ts [days]");
  process.exit(1);
}

// Run backfill
backfillSnapshots(daysBack).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
