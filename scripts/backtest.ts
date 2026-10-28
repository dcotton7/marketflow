/**
 * Strategy research backtest (docs/specs/strategy-research-loop.md). Runs on Don's PC only, never on Render.
 * Reads Alpaca bars with the app's client and .env keys, caches them under .research-cache/, and writes the decision
 * log and report under research-results/<label>/. No database access.
 *
 *   npx tsx scripts/backtest.ts                       # pilot: 150 most liquid names, 2026-01-02 to the latest close
 *   npx tsx scripts/backtest.ts --universe full       # every Nasdaq common stock + S&P 500, liquidity floor per date
 *   npx tsx scripts/backtest.ts --top 200 --no-minute --versions kell-lib-v0,kell-lib-v0-baseline
 *   npx tsx scripts/backtest.ts --symbols NVDA,AAPL,MSFT --label spot-check
 *
 * Options: --start YYYY-MM-DD (trade window start, default 2026-01-02), --end YYYY-MM-DD (default latest completed
 * session), --warmup YYYY-MM-DD (default 2024-12-01), --rank-date YYYY-MM-DD (liquidity rank date, default 2025-12-31),
 * --universe liquid|full, --top N, --versions a,b, --symbols A,B, --no-minute, --label name.
 */
import "dotenv/config";
import { runBacktest } from "../server/research/engine";
import { STRATEGY_VERSIONS } from "../server/research/strategy";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) {
    console.error("ALPACA_API_KEY / ALPACA_API_SECRET are not set (.env).");
    process.exit(1);
  }
  const universe = (arg("universe") ?? "liquid") as "liquid" | "full";
  if (universe !== "liquid" && universe !== "full") throw new Error("--universe must be liquid or full");
  const res = await runBacktest({
    tradeStart: arg("start") ?? "2026-01-02",
    tradeEnd: arg("end"),
    warmupStart: arg("warmup") ?? "2024-12-01",
    universe,
    topN: Number(arg("top") ?? 150),
    rankDate: arg("rank-date") ?? "2025-12-31",
    versions: (arg("versions") ?? STRATEGY_VERSIONS.map((v) => v.id).join(",")).split(","),
    minute: !process.argv.includes("--no-minute"),
    label: arg("label"),
    symbols: arg("symbols")?.split(",").map((s) => s.trim().toUpperCase()),
  });
  console.log(`Report: ${res.outDir}\\report.md`);
  console.log(`Fingerprint: ${res.fingerprint} (identical inputs give an identical fingerprint)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
