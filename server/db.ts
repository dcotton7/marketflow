import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;
let initializationAttempted = false;
let initializationError: Error | null = null;

export async function initializeDatabase(): Promise<NodePgDatabase<typeof schema> | null> {
  if (db) return db;
  if (initializationAttempted) {
    if (initializationError) {
      console.warn("Database initialization previously failed:", initializationError.message);
    }
    return null;
  }
  
  initializationAttempted = true;
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.warn("DATABASE_URL is not set. Database features will be unavailable.");
    return null;
  }
  
  try {
    console.log("Initializing database connection...");
    pool = new Pool({ 
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    
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
