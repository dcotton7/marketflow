import "dotenv/config";
import { fetchTechnicalData } from "../server/sentinel/technicals";
import * as alpaca from "../server/alpaca";

async function main() {
  const symbol = process.argv[2] || "CF";
  const tech = await fetchTechnicalData(symbol);
  if (!tech) {
    console.error("No technicals returned for", symbol);
    process.exit(1);
  }

  console.log("Symbol:", tech.symbol);
  console.log("Current:", tech.currentPrice);
  console.log("50SMA:", tech.sma50, "ADR20:", tech.adr20, "Ext(50/ADR):", tech.extensionFrom50dAdr);
  console.log("SwingHighs:");
  for (const sh of tech.swingHighs || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anySh = sh as any;
    console.log(
      `  - $${sh.price.toFixed(2)} daysAgo=${sh.daysAgo} date=${anySh.date ?? "?"} lastTouchedDaysAgo=${anySh.lastTouchedDaysAgo ?? "?"}`
    );
  }

  const targets = [99.42, 104.44];
  console.log("\nCheck targets:");
  for (const t of targets) {
    const found = (tech.swingHighs || []).find((sh) => Math.abs(sh.price - t) <= 0.05);
    console.log(`  - ${t.toFixed(2)}: ${found ? "FOUND" : "NOT_FOUND"}`);
  }

  // Deep check: look back further and see if daily highs ever approached these levels.
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 2000);
  const bars = await alpaca.fetchAlpacaDailyBars(symbol, startDate, endDate);
  const highs = bars.map((b) => b.high);
  const maxHigh = highs.length ? Math.max(...highs) : 0;
  console.log(`\nDeep daily bars (2000d) count=${bars.length} maxHigh=$${maxHigh.toFixed(2)}`);
  for (const t of targets) {
    const anyNear = bars.find((b) => Math.abs(b.high - t) / t <= 0.002);
    console.log(`  - any daily high within 0.2% of ${t.toFixed(2)}: ${anyNear ? `YES (${new Date(anyNear.date).toISOString().slice(0,10)} high=$${anyNear.high.toFixed(2)})` : "NO"}`);
    const anyCloseNear = bars.find((b) => Math.abs(b.close - t) / t <= 0.002);
    console.log(`  - any daily close within 0.2% of ${t.toFixed(2)}: ${anyCloseNear ? `YES (${new Date(anyCloseNear.date).toISOString().slice(0,10)} close=$${anyCloseNear.close.toFixed(2)})` : "NO"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

