import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

function initializeDatabase() {
  if (db) return db;
  
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Database features will be unavailable.");
    return null;
  }
  
  try {
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
    console.log("Database connection initialized successfully");
    return db;
  } catch (error) {
    console.error("Failed to initialize database connection:", error);
    return null;
  }
}

export function getDb() {
  if (!db) {
    return initializeDatabase();
  }
  return db;
}

export function getPool() {
  if (!pool) {
    initializeDatabase();
  }
  return pool;
}

// For backward compatibility - lazy initialization
export { pool, db };

// Initialize on first import
initializeDatabase();
