import {
  getThemeChartSymbolCandidates,
  SUBTHEME_PRIMARY_CHART_ETF,
} from "@/lib/theme-chart-symbols";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function testMemorySubthemeUsesDramFirst() {
  const candidates = getThemeChartSymbolCandidates(
    {
      etfProxies: [
        { symbol: "SMH", name: "SMH", proxyType: "direct" },
        { symbol: "DRAM", name: "DRAM", proxyType: "direct" },
      ],
    },
    { subthemeId: "SEMIS_MEMORY" }
  );
  assert(candidates[0] === "DRAM", "memory subtheme prefers DRAM");
  assert(candidates.includes("SMH"), "falls back to theme direct ETFs");
}

function testMemberFallbackAfterEtfs() {
  const candidates = getThemeChartSymbolCandidates(
    {
      etfProxies: [{ symbol: "SMH", name: "SMH", proxyType: "direct" }],
    },
    { memberSymbols: ["NVDA", "AMD"] }
  );
  assert(candidates[0] === "SMH", "ETF before members");
  assert(candidates[candidates.length - 1] === "AMD", "members after ETFs");
}

function testSubthemeConstant() {
  assert(SUBTHEME_PRIMARY_CHART_ETF.SEMIS_MEMORY === "DRAM", "SEMIS_MEMORY maps to DRAM");
}

function run() {
  testMemorySubthemeUsesDramFirst();
  testMemberFallbackAfterEtfs();
  testSubthemeConstant();
  console.log("theme-chart-symbols.test.ts: all passed");
}

run();
