import { fetchChartData } from "./server/sentinel/chartDataEngine.js";

async function testGaps() {
  console.log("Testing gaps calculation for AAPL...\n");
  
  const data = await fetchChartData("AAPL", "daily", 90);
  
  if (!data) {
    console.error("Failed to fetch chart data");
    return;
  }
  
  console.log(`Ticker: ${data.ticker}`);
  console.log(`Timeframe: ${data.timeframe}`);
  console.log(`Total candles: ${data.candles.length}`);
  console.log(`Has gaps: ${!!data.gaps}`);
  
  if (data.gaps) {
    console.log(`\nTotal gaps detected: ${data.gaps.length}`);
    console.log("\nGap Details:");
    console.log("─".repeat(80));
    
    data.gaps.slice(0, 10).forEach((gap, i) => {
      const type = gap.isUp ? "GAP UP (Support)" : "GAP DOWN (Resistance)";
      const status = gap.isFilled ? "FILLED" : gap.isTouched ? "TOUCHED" : "ACTIVE";
      const gapDate = data.candles[gap.index]?.date || "unknown";
      
      console.log(`\n${i + 1}. ${type} - ${status}`);
      console.log(`   Date: ${gapDate}`);
      console.log(`   Original: $${gap.originalBottom.toFixed(2)} - $${gap.originalTop.toFixed(2)}`);
      console.log(`   Current:  $${gap.currentBottom.toFixed(2)} - $${gap.currentTop.toFixed(2)}`);
      console.log(`   Size: $${(gap.currentTop - gap.currentBottom).toFixed(2)}`);
      if (gap.isFilled && gap.filledBarIndex !== null) {
        console.log(`   Filled on: ${data.candles[gap.filledBarIndex]?.date || "unknown"}`);
      }
    });
    
    // Summary stats
    const gapUpCount = data.gaps.filter(g => g.isUp).length;
    const gapDownCount = data.gaps.filter(g => !g.isUp).length;
    const filledCount = data.gaps.filter(g => g.isFilled).length;
    const touchedCount = data.gaps.filter(g => g.isTouched && !g.isFilled).length;
    const activeCount = data.gaps.filter(g => !g.isTouched && !g.isFilled).length;
    
    console.log("\n" + "─".repeat(80));
    console.log("\nSummary:");
    console.log(`  Gap Up (Support):       ${gapUpCount}`);
    console.log(`  Gap Down (Resistance):  ${gapDownCount}`);
    console.log(`  Filled:                 ${filledCount}`);
    console.log(`  Touched (not filled):   ${touchedCount}`);
    console.log(`  Active (untouched):     ${activeCount}`);
  } else {
    console.log("\nNo gaps property in response");
  }
}

testGaps().catch(console.error);
