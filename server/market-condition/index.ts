/**
 * Market Condition Module
 * 
 * Capital Narrative & Risk Engine for the Market Condition Terminal.
 * 
 * Usage:
 * ```typescript
 * import { initMarketCondition, getMarketRegimeForScanner } from './market-condition';
 * 
 * // Initialize on server startup
 * await initMarketCondition();
 * 
 * // Use in Scanner for regime-aware position sizing
 * const regime = getMarketRegimeForScanner();
 * ```
 */

// Re-export everything
export * from "./universe";
export * from "./providers";
export * from "./engine";
export * from "./exports";

// Import for initialization
import { startPolling, stopPolling, getPollingStatus } from "./engine/snapshot";
import { db } from "../db";
import { tnnSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

// =============================================================================
// Module Initialization
// =============================================================================

let isInitialized = false;

/**
 * Initialize the Market Condition module
 * Call this on server startup
 */
export async function initMarketCondition(): Promise<void> {
  if (isInitialized) {
    console.log("[MarketCondition] Already initialized");
    return;
  }
  
  console.log("[MarketCondition] Initializing...");
  
  try {
    // Load settings from database
    let config: Record<string, any> = {};
    if (db) {
      const [settings] = await db
        .select()
        .from(tnnSettings)
        .where(eq(tnnSettings.settingKey, "market_condition"))
        .limit(1);
      
      if (settings?.settingValue) {
        try {
          config = JSON.parse(settings.settingValue);
        } catch {
          config = {};
        }
      }
    }
    const autoStart = config.autoStartPolling ?? true;
    const pollInterval = config.marketHoursPollIntervalMs ?? config.pollIntervalMs ?? 60000;
    
    if (autoStart) {
      console.log(`[MarketCondition] Auto-starting polling with ${pollInterval}ms interval`);
      startPolling(pollInterval);
    } else {
      console.log("[MarketCondition] Auto-start disabled, polling not started");
    }
    
    isInitialized = true;
    console.log("[MarketCondition] Initialization complete");
    
  } catch (error) {
    console.error("[MarketCondition] Initialization failed:", error);
    // Don't throw - allow server to continue even if MC fails
  }
}

/**
 * Shutdown the Market Condition module
 * Call this on server shutdown
 */
export function shutdownMarketCondition(): void {
  if (!isInitialized) return;
  
  console.log("[MarketCondition] Shutting down...");
  stopPolling();
  isInitialized = false;
}

/**
 * Check if module is initialized and polling
 */
export function isMarketConditionActive(): boolean {
  const status = getPollingStatus();
  return isInitialized && status.isPolling;
}
