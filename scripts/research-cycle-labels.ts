/**
 * Prints the Kell cycle label changes for symbols from the local bar cache (run scripts/backtest.ts first), so labels
 * can be checked against charts.  npx tsx scripts/research-cycle-labels.ts NVDA AAPL [--from 2026-01-01]
 */
import { classifyCycle } from "../server/research/cycle";
import { readDailyBars } from "../server/research/data/daily-bars";
import { computeFacts } from "../server/research/facts";
import { weinsteinStages } from "../server/research/weinstein";

const args = process.argv.slice(2);
const fi = args.indexOf("--from");
const from = fi >= 0 ? args[fi + 1] : "2026-01-01";
const symbols = args.filter((a, i) => !a.startsWith("--") && (fi < 0 || i !== fi + 1));
const spy = readDailyBars("SPY");
const qqq = readDailyBars("QQQ");
const index = { spy: new Map(spy.map((b) => [b.date, b.close])), qqq: new Map(qqq.map((b) => [b.date, b.close])) };

for (const s of symbols) {
  const bars = readDailyBars(s.toUpperCase());
  if (!bars.length) {
    console.log(`${s}: no cached bars`);
    continue;
  }
  const f = computeFacts(bars, index);
  const st = classifyCycle(f);
  const w = weinsteinStages(bars);
  const parts: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].date < from || st[i] === prev) continue;
    prev = st[i];
    parts.push(`${bars[i].date} ${st[i]} @${bars[i].close.toFixed(2)} (W${w[i] ?? "?"})`);
  }
  console.log(`${s.toUpperCase()}:\n  ${parts.join("\n  ")}`);
}
