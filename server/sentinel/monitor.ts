import { sentinelModels } from "./models";

let monitoringInterval: NodeJS.Timeout | null = null;

async function checkActiveTrades() {
  try {
    const activeTrades = await sentinelModels.getActiveTrades();
    
    for (const trade of activeTrades) {
      if (trade.stopPrice || trade.targetPrice) {
        console.log(`[Sentinel Monitor] Checking ${trade.symbol} - Entry: $${trade.entryPrice}`);
      }
    }
  } catch (error) {
    console.error("[Sentinel Monitor] Error checking trades:", error);
  }
}

export function startMonitoring(intervalMs: number = 60000) {
  if (monitoringInterval) {
    console.log("[Sentinel Monitor] Already running");
    return;
  }

  console.log(`[Sentinel Monitor] Starting with ${intervalMs}ms interval`);
  monitoringInterval = setInterval(checkActiveTrades, intervalMs);
  
  checkActiveTrades();
}

export function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.log("[Sentinel Monitor] Stopped");
  }
}
