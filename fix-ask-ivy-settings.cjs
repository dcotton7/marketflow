const { Client } = require("pg");

async function main() {
  const connectionString =
    process.env.DATABASE_URL ||
    "postgresql://neondb_owner:npg_d1zsHf7jJRmV@ep-broad-truth-afv67u09-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require";

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS ask_ivy_settings (
      id SERIAL PRIMARY KEY,
      settings JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const defaults = {
    enableMinerviniCheatEntries: true,
    enableEma620Entry: true,
    ema620AllowedTimeframe: "5min_only",
    entryBufferPct: 0.002,

    include21EmaStop: true,
    include50SmaStop: true,
    includeAtrStop: true,
    atrStopMultiple: 1.5,
    stopMaOffsetDollars: 0.1,
    stop21Label: "21 EMA",

    alwaysInclude8RTarget: false,
    includeSwingHighTargets: true,
    swingHighTargetCount: 3,
    include52wTarget: true,
    includeWeeklyTarget: true,
    include5DayTarget: true,
    include8xAdrTarget: true,
    adr8TargetBreakoutOnly: true,
    warnIfNoChartTargets: true,

    extendedThresholdAdr: 5,
    profitTakingThresholdAdr: 8,
    showExtendedWarning: true,

    chartPriceScaleSide: "right",
    overlayResizable: false,
  };

  const existing = await client.query("SELECT id FROM ask_ivy_settings LIMIT 1");
  if (existing.rows.length === 0) {
    await client.query("INSERT INTO ask_ivy_settings(settings) VALUES ($1::jsonb)", [JSON.stringify(defaults)]);
  }

  const r = await client.query("SELECT id, updated_at, settings FROM ask_ivy_settings LIMIT 1");
  // eslint-disable-next-line no-console
  console.log("ask_ivy_settings:", r.rows[0]);

  await client.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

