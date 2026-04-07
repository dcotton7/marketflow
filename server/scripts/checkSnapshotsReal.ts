import 'dotenv/config';
import pkg from 'pg';
const { Client } = pkg;

async function checkSnapshots() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✓ Connected to database\n');

    // Count all snapshots by type and date
    console.log('=== ALL SNAPSHOTS BY TYPE AND DATE ===');
    const countResult = await client.query(`
      SELECT 
        snapshot_type,
        market_date,
        COUNT(*)::int as count,
        MIN(created_at) as first_snapshot,
        MAX(created_at) as last_snapshot
      FROM theme_snapshots
      GROUP BY snapshot_type, market_date
      ORDER BY market_date DESC, snapshot_type
    `);
    console.table(countResult.rows);

    // Total counts
    console.log('\n=== TOTAL COUNTS ===');
    const totalResult = await client.query(`
      SELECT 
        snapshot_type,
        COUNT(*)::int as total_count,
        MIN(market_date) as oldest_date,
        MAX(market_date) as newest_date
      FROM theme_snapshots
      GROUP BY snapshot_type
      ORDER BY snapshot_type
    `);
    console.table(totalResult.rows);

    // Sample hourly snapshots if any exist
    console.log('\n=== SAMPLE HOURLY SNAPSHOTS (10 most recent) ===');
    const hourlyResult = await client.query(`
      SELECT 
        theme_id,
        market_date,
        snapshot_hour,
        score,
        median_pct,
        created_at
      FROM theme_snapshots
      WHERE snapshot_type = 'hourly'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (hourlyResult.rows.length > 0) {
      console.table(hourlyResult.rows);
    } else {
      console.log('❌ NO HOURLY SNAPSHOTS FOUND IN DATABASE');
    }

    // Sample daily snapshots
    console.log('\n=== SAMPLE DAILY SNAPSHOTS (10 most recent) ===');
    const dailyResult = await client.query(`
      SELECT 
        theme_id,
        market_date,
        score,
        median_pct,
        acc_dist_days,
        created_at
      FROM theme_snapshots
      WHERE snapshot_type = 'daily_close'
      ORDER BY market_date DESC, theme_id
      LIMIT 10
    `);
    
    if (dailyResult.rows.length > 0) {
      console.table(dailyResult.rows);
    } else {
      console.log('❌ NO DAILY SNAPSHOTS FOUND IN DATABASE');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

checkSnapshots();
