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
  const sqlPath = path.join(process.cwd(), "drizzle/0005_admin_semantic_text_colors.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");
  const pool = new pg.Pool({ connectionString: getDatabaseUrl() });
  try {
    await pool.query(sql);
    console.log("Applied migration 0005_admin_semantic_text_colors.sql");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
