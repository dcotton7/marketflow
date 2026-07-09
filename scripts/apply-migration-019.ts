import pg from "pg";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const sqlPath = path.resolve("migrations/019_catalyst_detectors.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  console.log("Applying migration 019...");
  await pool.query(sql);
  console.log("Migration 019 applied successfully.");
  await pool.end();
}

run().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
