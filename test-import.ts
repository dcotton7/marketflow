import * as fs from 'fs';
import { parseCSV } from './server/sentinel/tradeImport';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './shared/schema';
import { eq, and, inArray, sql, isNull } from 'drizzle-orm';

const { sentinelImportBatches, sentinelImportedTrades, sentinelTrades, sentinelTradeToLabels, sentinelEvaluations, sentinelEvents } = schema;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  const userId = 1; // testuser123

  // Step 1: Clear existing import data
  console.log("Clearing existing import data...");
  await db.delete(sentinelTradeToLabels).where(
    inArray(sentinelTradeToLabels.tradeId, 
      db.select({ id: sentinelTrades.id }).from(sentinelTrades).where(eq(sentinelTrades.source, 'import'))
    )
  );
  await db.delete(sentinelEvaluations).where(
    inArray(sentinelEvaluations.tradeId, 
      db.select({ id: sentinelTrades.id }).from(sentinelTrades).where(eq(sentinelTrades.source, 'import'))
    )
  );
  await db.delete(sentinelEvents).where(
    inArray(sentinelEvents.tradeId, 
      db.select({ id: sentinelTrades.id }).from(sentinelTrades).where(eq(sentinelTrades.source, 'import'))
    )
  );
  await db.delete(sentinelTrades).where(eq(sentinelTrades.source, 'import'));
  await db.delete(sentinelImportedTrades).where(eq(sentinelImportedTrades.userId, userId));
  await db.delete(sentinelImportBatches).where(eq(sentinelImportBatches.userId, userId));
  console.log("Cleared.");

  // Step 2: Import 2025 CSV first (older data)
  const csv2025 = fs.readFileSync('./attached_assets/2025_Activity_2_DC_Rollover_IRA__4915_1770227940131.csv', 'utf-8');
  const result2025 = parseCSV(csv2025, '2025_Activity.csv', 'testuser123', 'FIDELITY');
  console.log(`\n2025 CSV parsed: ${result2025.trades.length} trades, ${result2025.batch.skippedRows.length} skipped`);

  // Insert batch 2025
  const batch2025 = await db.insert(sentinelImportBatches).values({
    batchId: result2025.batch.batchId,
    userId,
    brokerId: 'FIDELITY',
    fileName: '2025_Activity.csv',
    fileType: 'CSV',
    totalTradesFound: result2025.trades.length,
    totalTradesImported: result2025.trades.length,
    orphanSellsCount: 0,
    skippedRows: result2025.batch.skippedRows,
    status: 'trades_imported',
    importedAt: new Date()
  }).returning();
  console.log(`2025 batch created: ${batch2025[0].id}`);

  // Insert 2025 trades
  for (let i = 0; i < result2025.trades.length; i += 100) {
    const chunk = result2025.trades.slice(i, i + 100);
    await db.insert(sentinelImportedTrades).values(
      chunk.map(trade => ({
        tradeId: trade.tradeId,
        batchId: result2025.batch.batchId,
        userId,
        brokerId: 'FIDELITY',
        brokerOrderId: trade.brokerOrderId,
        ticker: trade.ticker,
        assetType: trade.assetType,
        direction: trade.direction,
        quantity: trade.quantity.toString(),
        price: trade.price.toString(),
        totalAmount: trade.totalAmount.toString(),
        commission: trade.commission.toString(),
        fees: trade.fees.toString(),
        netAmount: trade.netAmount.toString(),
        tradeDate: trade.tradeDate,
        settlementDate: trade.settlementDate,
        tradeTimestamp: trade.tradeTimestamp,
        timestampSource: trade.timestampSource,
        status: trade.status,
        accountType: trade.accountType,
        accountName: trade.accountName,
        rawData: trade.rawData,
        isOrphanSell: false,
        orphanStatus: null
      }))
    );
  }
  console.log(`2025 trades inserted: ${result2025.trades.length}`);

  // Step 3: Import 2026 CSV (newer data)
  const csv2026 = fs.readFileSync('./attached_assets/2026_Activity_2_DC_Rollover_IRA__4915_1770227927933.csv', 'utf-8');
  const result2026 = parseCSV(csv2026, '2026_Activity.csv', 'testuser123', 'FIDELITY');
  console.log(`\n2026 CSV parsed: ${result2026.trades.length} trades, ${result2026.batch.skippedRows.length} skipped`);

  // Insert batch 2026
  const batch2026 = await db.insert(sentinelImportBatches).values({
    batchId: result2026.batch.batchId,
    userId,
    brokerId: 'FIDELITY',
    fileName: '2026_Activity.csv',
    fileType: 'CSV',
    totalTradesFound: result2026.trades.length,
    totalTradesImported: result2026.trades.length,
    orphanSellsCount: 0,
    skippedRows: result2026.batch.skippedRows,
    status: 'trades_imported',
    importedAt: new Date()
  }).returning();
  console.log(`2026 batch created: ${batch2026[0].id}`);

  // Insert 2026 trades
  for (let i = 0; i < result2026.trades.length; i += 100) {
    const chunk = result2026.trades.slice(i, i + 100);
    await db.insert(sentinelImportedTrades).values(
      chunk.map(trade => ({
        tradeId: trade.tradeId,
        batchId: result2026.batch.batchId,
        userId,
        brokerId: 'FIDELITY',
        brokerOrderId: trade.brokerOrderId,
        ticker: trade.ticker,
        assetType: trade.assetType,
        direction: trade.direction,
        quantity: trade.quantity.toString(),
        price: trade.price.toString(),
        totalAmount: trade.totalAmount.toString(),
        commission: trade.commission.toString(),
        fees: trade.fees.toString(),
        netAmount: trade.netAmount.toString(),
        tradeDate: trade.tradeDate,
        settlementDate: trade.settlementDate,
        tradeTimestamp: trade.tradeTimestamp,
        timestampSource: trade.timestampSource,
        status: trade.status,
        accountType: trade.accountType,
        accountName: trade.accountName,
        rawData: trade.rawData,
        isOrphanSell: false,
        orphanStatus: null
      }))
    );
  }
  console.log(`2026 trades inserted: ${result2026.trades.length}`);

  // Step 4: Run orphan detection
  console.log("\n--- Running FIFO Orphan Detection ---");
  
  // Get all imported trades for user grouped by ticker+account
  const allTrades = await db.select().from(sentinelImportedTrades)
    .where(eq(sentinelImportedTrades.userId, userId));
  
  console.log(`Total imported trades: ${allTrades.length}`);

  // Group by ticker+account
  const grouped = new Map<string, typeof allTrades>();
  for (const trade of allTrades) {
    const key = `${trade.ticker}::${trade.accountName || 'default'}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(trade);
  }

  const trueOrphanIds = new Set<string>();
  const positionSummary: Array<{ticker: string, buys: number, sells: number, orphans: number, position: number}> = [];

  for (const [key, trades] of grouped) {
    // Sort by date, then direction (BUYs before SELLs), then ID
    trades.sort((a, b) => {
      const dateA = new Date(a.tradeDate).getTime();
      const dateB = new Date(b.tradeDate).getTime();
      if (dateA !== dateB) return dateA - dateB;
      if (a.direction === 'BUY' && b.direction === 'SELL') return -1;
      if (a.direction === 'SELL' && b.direction === 'BUY') return 1;
      return a.tradeId.localeCompare(b.tradeId);
    });

    let position = 0;
    let totalBuys = 0;
    let totalSells = 0;
    let orphansInTicker = 0;

    for (const trade of trades) {
      const qty = parseFloat(trade.quantity || '0');
      
      if (trade.direction === 'BUY') {
        position += qty;
        totalBuys += qty;
      } else {
        // SELL
        totalSells += qty;
        if (position >= qty) {
          position -= qty;
        } else {
          // Orphan - selling more than we have
          trueOrphanIds.add(trade.tradeId);
          orphansInTicker++;
          position = 0; // Reset position after orphan
        }
      }
    }

    const ticker = key.split('::')[0];
    positionSummary.push({ ticker, buys: totalBuys, sells: totalSells, orphans: orphansInTicker, position });
  }

  // Show tickers with orphans or open positions
  console.log("\n=== Position Summary ===");
  const interestingPositions = positionSummary.filter(p => p.orphans > 0 || p.position > 0);
  interestingPositions.sort((a, b) => b.position - a.position);
  
  console.log("\nTickers with open positions:");
  for (const p of interestingPositions.filter(x => x.position > 0)) {
    console.log(`  ${p.ticker}: buys=${p.buys}, sells=${p.sells}, open=${p.position.toFixed(4)}`);
  }
  
  console.log("\nTickers with orphans:");
  for (const p of positionSummary.filter(x => x.orphans > 0)) {
    console.log(`  ${p.ticker}: ${p.orphans} orphan sells (buys=${p.buys}, sells=${p.sells})`);
  }

  console.log(`\nTotal true orphans: ${trueOrphanIds.size}`);

  // Update database with orphan flags
  if (trueOrphanIds.size > 0) {
    const orphanArray = Array.from(trueOrphanIds);
    for (let i = 0; i < orphanArray.length; i += 100) {
      const batch = orphanArray.slice(i, i + 100);
      await db.update(sentinelImportedTrades)
        .set({ isOrphanSell: true, orphanStatus: 'pending' })
        .where(inArray(sentinelImportedTrades.tradeId, batch));
    }
    console.log(`Marked ${trueOrphanIds.size} orphans in database`);
  }

  // Update batch orphan counts
  for (const batchId of [result2025.batch.batchId, result2026.batch.batchId]) {
    const count = await db.select({ count: sql<number>`count(*)` })
      .from(sentinelImportedTrades)
      .where(and(
        eq(sentinelImportedTrades.batchId, batchId),
        eq(sentinelImportedTrades.isOrphanSell, true)
      ));
    
    await db.update(sentinelImportBatches)
      .set({ orphanSellsCount: count[0]?.count || 0 })
      .where(eq(sentinelImportBatches.batchId, batchId));
  }

  console.log("\n--- Test Complete ---");
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
