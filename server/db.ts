import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import * as fs from "fs";
import * as path from "path";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;
let initializationAttempted = false;
let initializationError: Error | null = null;

function getDatabaseUrl(): string | undefined {
  let databaseUrl = process.env.DATABASE_URL;
  
  // Handle PowerShell env var parsing issues - check if URL looks malformed
  if (!databaseUrl || !databaseUrl.includes("postgresql://") || databaseUrl.includes(" ") || !databaseUrl.includes("@")) {
    // Try reading directly from .env file
    try {
      const envPath = path.join(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        const match = envContent.match(/DATABASE_URL="([^"]+)"/);
        if (match) {
          databaseUrl = match[1];
          console.log("[DB] Loaded DATABASE_URL from .env file (env var was malformed)");
        }
      }
    } catch (e) {
      // Ignore errors reading .env
    }
  }
  
  return databaseUrl;
}

export async function initializeDatabase(): Promise<NodePgDatabase<typeof schema> | null> {
  if (db) return db;
  if (initializationAttempted) {
    if (initializationError) {
      console.warn("Database initialization previously failed:", initializationError.message);
    }
    return null;
  }
  
  initializationAttempted = true;
  const databaseUrl = getDatabaseUrl();
  
  if (!databaseUrl) {
    console.warn("DATABASE_URL is not set. Database features will be unavailable.");
    return null;
  }
  
  try {
    console.log("Initializing database connection...");
    // maxLifetimeSeconds is in pg-pool 3.6+, but this @types/pg predates it.
    const poolConfig: pg.PoolConfig & { maxLifetimeSeconds?: number } = {
      connectionString: databaseUrl,
      // Increased pool size to match upgraded DB tier; tune to your plan
      max: 20,
      // Keep idle connections a bit longer to avoid frequent reconnects
      idleTimeoutMillis: 60000,
      // Allow a longer connection timeout for first-time connections
      connectionTimeoutMillis: 20000,
      // TCP keepalive, so a connection Neon or the network dropped silently is found and closed instead of
      // holding a pool slot with a query that never answers (the "timeout exceeded when trying to connect" hang).
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      // Replace connections after 30 minutes, so none outlives a Neon compute restart for long.
      maxLifetimeSeconds: 1800,
    };
    pool = new Pool(poolConfig);
    
    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
    
    // Test the connection
    console.log("Testing database connection...");
    const client = await pool.connect();
    client.release();
    console.log("Database connection test successful");
    
    db = drizzle(pool, { schema });
    console.log("Database connection pool created successfully");
    return db;
  } catch (error) {
    initializationError = error as Error;
    console.error("Failed to initialize database connection:", error);
    // Clean up the pool if it was created
    if (pool) {
      try {
        await pool.end();
      } catch (e) {
        // Ignore cleanup errors
      }
      pool = null;
    }
    return null;
  }
}

export function getDb(): NodePgDatabase<typeof schema> | null {
  return db;
}

export function getPool(): pg.Pool | null {
  return pool;
}

export function isDatabaseAvailable(): boolean {
  return db !== null;
}

// Export for backward compatibility
export { pool, db };
