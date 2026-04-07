/**
 * Seed 15-minute snapshot data for Race timeline testing
 * Generates realistic intraday snapshots for recent trading days
 */
import 'dotenv/config';
import pkg from 'pg';
const { Client } = pkg;

const THEME_IDS = [
  "SEMIS", "AI_INFRA", "STORAGE", "ENTERPRISE_SOFT", "CYBER",
  "FIBER_OPTICAL", "DATA_CENTER_REITS", "INDUSTRIAL_INFRA", "DEFENSE",
  "FINANCIAL_CORE", "PAYMENTS_FINTECH", "ENERGY",
  "CONSUMER_DISC", "CONSUMER_STAPLES", "HEALTHCARE", "MATERIALS_METALS",
  "TRANSPORTS", "HOMEBUILDERS",
  "CRYPTO_EQ", "NUCLEAR_URANIUM", "SPACE_FRONTIER", "QUANTUM",
  "RARE_EARTH", "PRECIOUS_METALS", "BIOTECH", "SOLAR",
  "GAMING_CASINOS", "HOSPITALITY_LEISURE"
];

/**
 * Generate 15min timestamps for a trading day (9:30 AM - 4:00 PM ET)
 * Creates UTC timestamps that represent the correct ET time
 */
function generate15minSlots(marketDate: string): Array<{ timestamp: Date; hour: number }> {
  const slots: Array<{ timestamp: Date; hour: number }> = [];
  
  // Market hours in ET: 9:30 AM - 4:00 PM
  const startHour = 9;
  const endHour = 16;
  
  for (let hour = startHour; hour < endHour; hour++) {
    const slots15 = hour === 9 ? [30, 45] : [0, 15, 30, 45];
    
    for (const minute of slots15) {
      // Create UTC timestamp for this ET time
      // March 2026 is in EDT (UTC-4), so ET time + 4 hours = UTC
      const [year, month, day] = marketDate.split('-');
      
      // Build a UTC timestamp that when converted to ET gives us the target time
      // EDT = UTC-4, so 9:30 ET = 13:30 UTC
      const utcHour = hour + 4; // EDT offset
      const utcDate = new Date(Date.UTC(
        parseInt(year),
        parseInt(month) - 1, // Month is 0-indexed
        parseInt(day),
        utcHour,
        minute,
        0,
        0
      ));
      
      slots.push({ timestamp: utcDate, hour });
    }
  }
  
  return slots;
}

/**
 * Generate realistic theme scores with intraday variation
 */
function generateIntradayScores(
  baseScores: Record<string, number>,
  slotIndex: number,
  totalSlots: number
): Record<string, { rank: number; score: number; medianPct: number; rsVsBenchmark: number; breadthPct: number }> {
  const themes = Object.entries(baseScores);
  const result: Record<string, any> = {};
  
  // Add intraday variation (random walk)
  const varied = themes.map(([id, baseScore]) => {
    // Intraday variation: ±3-8 points from base, trending back toward base at EOD
    const variance = Math.random() * 8 - 4;
    const eodPull = (slotIndex / totalSlots) * 0.6; // Pull back toward base as day progresses
    const score = Math.max(0, Math.min(100, baseScore + variance * (1 - eodPull)));
    
    return {
      id,
      score,
      medianPct: (score - 50) / 10, // Rough correlation
      rsVsBenchmark: (score - 50) / 15,
      breadthPct: Math.max(0, Math.min(100, score * 1.1 - 5)),
    };
  });
  
  // Sort by score to get ranks
  varied.sort((a, b) => b.score - a.score);
  
  varied.forEach((theme, index) => {
    result[theme.id] = {
      rank: index + 1,
      score: theme.score,
      medianPct: theme.medianPct,
      rsVsBenchmark: theme.rsVsBenchmark,
      breadthPct: theme.breadthPct,
    };
  });
  
  return result;
}

async function seedSnapshots() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log("✓ Connected to database\n");
    console.log("🌱 Seeding 15-minute snapshot data...\n");

    // Get recent daily close snapshots to use as base scores
    console.log("📊 Loading base scores from recent daily snapshots...");
    const recentDaily = await client.query(`
      SELECT theme_id, market_date, score
      FROM theme_snapshots
      WHERE snapshot_type = 'daily_close'
      ORDER BY market_date DESC
      LIMIT 100
    `);
    
    // Get most recent score for each theme as baseline
    const baseScores: Record<string, number> = {};
    const dailyByDate = new Map<string, any[]>();
    
    for (const snap of recentDaily.rows) {
      if (!dailyByDate.has(snap.market_date)) {
        dailyByDate.set(snap.market_date, []);
      }
      dailyByDate.get(snap.market_date)!.push(snap);
    }
    
    // Use most recent day's scores
    const dates = Array.from(dailyByDate.keys()).sort().reverse();
    if (dates.length > 0) {
      const latestSnaps = dailyByDate.get(dates[0])!;
      for (const snap of latestSnaps) {
        baseScores[snap.theme_id] = snap.score ?? 50;
      }
    }
    
    // Fill in any missing themes with default score
    for (const themeId of THEME_IDS) {
      if (!baseScores[themeId]) {
        baseScores[themeId] = 50;
      }
    }
    
    console.log(`✓ Loaded base scores for ${Object.keys(baseScores).length} themes\n`);

    // Trading days to seed (last 3 trading days before weekend)
    const tradingDays = [
      "2026-03-24", // Monday
      "2026-03-25", // Tuesday  
      "2026-03-26", // Wednesday
    ];

    let totalInserted = 0;

    for (const marketDate of tradingDays) {
      console.log(`📅 Generating snapshots for ${marketDate}...`);
      
      const slots = generate15minSlots(marketDate);
      console.log(`  Generated ${slots.length} fifteen-minute time slots`);
      
      const records: any[] = [];
      
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
        const { timestamp, hour } = slots[slotIndex];
        
        const themeMetrics = generateIntradayScores(baseScores, slotIndex, slots.length);
        
        for (const themeId of THEME_IDS) {
          const metrics = themeMetrics[themeId];
          if (!metrics) continue;
          
          records.push({
            themeId,
            rank: metrics.rank,
            score: metrics.score,
            medianPct: metrics.medianPct,
            rsVsBenchmark: metrics.rsVsBenchmark,
            breadthPct: metrics.breadthPct,
            accDistDays: null,
            snapshotType: "hourly",
            marketDate,
            snapshotHour: hour,
            createdAt: timestamp,
          });
        }
      }
      
      // Insert records into database
      for (const record of records) {
        await client.query(`
          INSERT INTO theme_snapshots (
            theme_id, rank, score, median_pct, rs_vs_benchmark, breadth_pct,
            acc_dist_days, snapshot_type, market_date, snapshot_hour, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          record.themeId,
          record.rank,
          record.score,
          record.medianPct,
          record.rsVsBenchmark,
          record.breadthPct,
          record.accDistDays,
          record.snapshotType,
          record.marketDate,
          record.snapshotHour,
          record.createdAt
        ]);
      }
      
      totalInserted += records.length;
      console.log(`  ✓ Inserted ${records.length} snapshot rows\n`);
    }

    console.log(`\n✅ Seed complete! Inserted ${totalInserted} total snapshots`);
    console.log(`   Days: ${tradingDays.length}`);
    console.log(`   Snapshots per day: ~${Math.round(totalInserted / tradingDays.length / THEME_IDS.length)}`);
    console.log(`   Themes: ${THEME_IDS.length}`);

  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }

  process.exit(0);
}

seedSnapshots();
