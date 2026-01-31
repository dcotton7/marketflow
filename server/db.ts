import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;
let initializationAttempted = false;

function initializeDatabase(): NodePgDatabase<typeof schema> | null {
  if (db) return db;
  if (initializationAttempted) return null;
  
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
    
    db = drizzle(pool, { schema });
    console.log("Database connection pool created successfully");
    return db;
  } catch (error) {
    console.error("Failed to initialize database connection:", error);
    return null;
  }
}

export function getDb(): NodePgDatabase<typeof schema> | null {
  if (!db && !initializationAttempted) {
    return initializeDatabase();
  }
  return db;
}

export function getPool(): pg.Pool | null {
  if (!pool && !initializationAttempted) {
    initializeDatabase();
  }
  return pool;
}

// Export for backward compatibility - these will be null until getDb() is called
export { pool, db };
