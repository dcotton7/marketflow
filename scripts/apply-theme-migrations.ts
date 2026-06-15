import fs from "fs";
import path from "path";
import pg from "pg";

function getDatabaseUrl(): string {
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !databaseUrl.includes("postgresql://")) {
    const envPath = path.join(process.cwd(), ".env");
    const envContent = fs.readFileSync(envPath, "utf-8");
    const quoted = envContent.match(/DATABASE_URL="([^"]+)"/);
    const unquoted = envContent.match(/^DATABASE_URL=(.+)$/m);
    if (quoted) databaseUrl = quoted[1];
    else if (unquoted) databaseUrl = unquoted[1].trim();
  }
  if (!databaseUrl) throw new Error("DATABASE_URL not found");
  return databaseUrl;
}

async function main() {
  const pool = new pg.Pool({ connectionString: getDatabaseUrl() });
  const files = [
    "drizzle/0006_theme_editor.sql",
    "drizzle/0007_global_theme_layers.sql",
    "drizzle/0008_chart_setup_enrich.sql",
  ];
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(process.cwd(), file), "utf-8");
      await pool.query(sql);
      console.log(`Applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
