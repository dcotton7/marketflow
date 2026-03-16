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

  // Ensure sentinel_watchlist has the columns used by /api/sentinel/watchlist/with-ivy-eval
  const alters = [
    "ALTER TABLE sentinel_watchlist ADD COLUMN IF NOT EXISTS direction text DEFAULT 'long';",
    "ALTER TABLE sentinel_watchlist ADD COLUMN IF NOT EXISTS ivy_eval_id integer;",
    "ALTER TABLE sentinel_watchlist ADD COLUMN IF NOT EXISTS ivy_eval_text text;",
    "ALTER TABLE sentinel_watchlist ADD COLUMN IF NOT EXISTS ivy_recommended_entry double precision;",
    "ALTER TABLE sentinel_watchlist ADD COLUMN IF NOT EXISTS ivy_recommended_stop double precision;",
    "ALTER TABLE sentinel_watchlist ADD COLUMN IF NOT EXISTS ivy_recommended_target double precision;",
    "ALTER TABLE sentinel_watchlist ADD COLUMN IF NOT EXISTS ivy_risk_assessment text;",
  ];

  for (const sql of alters) {
    // eslint-disable-next-line no-console
    console.log(sql);
    await client.query(sql);
  }

  const r = await client.query(
    "select column_name from information_schema.columns where table_name='sentinel_watchlist' order by ordinal_position"
  );
  // eslint-disable-next-line no-console
  console.log("\nColumns now:\n" + r.rows.map((x) => x.column_name).join(", "));

  await client.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

