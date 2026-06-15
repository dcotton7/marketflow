import type { ClusterId } from "../universe";
import type { TickerMetrics } from "../engine/theme-score";
import { runTickerReviewScan } from "@shared/ticker-review-engine";
import { enrichTickerReviewMember, normalizeSetupBars } from "@shared/setup-detectors";
import type {
  OptionalCriterionId,
  RaiLabel,
  RequiredCriterionId,
  TickerReviewMember,
  TickerReviewScanMode,
} from "@shared/ticker-review-types";
import { getMarketSession } from "../universe";

export interface ThemeTickerReviewRequest {
  mode?: TickerReviewScanMode;
  enabledRequired?: RequiredCriterionId[];
  enabledOptional?: OptionalCriterionId[];
  raiLabel?: RaiLabel;
  themeRank?: number;
  themeMedianPct?: number;
  maxResults?: number;
  scope?: "theme" | "leaders";
}

function toReviewMember(m: TickerMetrics, accDistDays: number): TickerReviewMember {
  return {
    symbol: m.symbol,
    pct: m.pctChange,
    rsVsSpy: m.rsVsBenchmark,
    volExp: m.volExp,
    prevDayVolExp: m.prevDayVolExp,
    accDistDays,
    trendState: m.trendState,
    rsRank: m.rsRank,
    pctVsEma10d: m.pctVsEma10d,
    pctVsSma20d: m.pctVsSma20d,
    pctVsSma50d: m.pctVsSma50d,
    pctVsSma200d: m.pctVsSma200d,
  };
}

function sortDailyBars(raw: unknown[]) {
  const bars = normalizeSetupBars(raw);
  return [...bars].sort(
    (a, b) => new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime()
  );
}

async function fetchIntradayForOrb(symbol: string) {
  try {
    const { getIntradayBars } = await import("../../data-layer/intraday-bars");
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const bars = await getIntradayBars(symbol, "1Min", start, end, false);
    return normalizeSetupBars(
      bars.map((b) => ({
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        timestamp: b.timestamp,
      }))
    );
  } catch {
    return undefined;
  }
}

export async function runThemeTickerReview(
  themeId: ClusterId,
  members: TickerMetrics[],
  leaderSymbols: Set<string>,
  accDistMap: Map<string, number>,
  options: ThemeTickerReviewRequest
) {
  const scope = options.scope ?? "theme";
  const scoped =
    scope === "leaders"
      ? members.filter((m) => leaderSymbols.has(m.symbol.toUpperCase()))
      : members;

  const symbols = scoped.map((m) => m.symbol);
  const enabledOptional = options.enabledOptional ?? [];
  const wantsOrb = enabledOptional.includes("O9");
  const session = getMarketSession();
  const orbSessionActive = wantsOrb && (session === "MARKET_HOURS" || session === "AFTER_HOURS");

  const dailyBySymbol = new Map<string, ReturnType<typeof sortDailyBars>>();
  let barsEnriched = false;

  if (symbols.length > 0) {
    try {
      const { getAlpacaProvider } = await import("../providers/alpaca");
      const provider = getAlpacaProvider();
      const barsMap = await provider.getMultiSymbolBars(symbols, 120);
      for (const sym of symbols) {
        const raw = barsMap.get(sym) || [];
        dailyBySymbol.set(sym.toUpperCase(), sortDailyBars(raw));
      }
      barsEnriched = dailyBySymbol.size > 0;
    } catch (err) {
      console.warn("[TickerReview] Daily bar fetch skipped:", err);
    }
  }

  const intradayBySymbol = new Map<string, ReturnType<typeof normalizeSetupBars>>();
  if (orbSessionActive) {
    const orbFetches = await Promise.all(
      scoped.map(async (m) => {
        const bars = await fetchIntradayForOrb(m.symbol);
        return [m.symbol.toUpperCase(), bars] as const;
      })
    );
    for (const [sym, bars] of orbFetches) {
      if (bars?.length) intradayBySymbol.set(sym, bars);
    }
  }

  const reviewMembers: TickerReviewMember[] = [];
  for (const m of scoped) {
    const sym = m.symbol.toUpperCase();
    let member = toReviewMember(m, accDistMap.get(sym) ?? 0);
    const daily = dailyBySymbol.get(sym);
    const intraday = intradayBySymbol.get(sym);

    if (daily) {
      member = enrichTickerReviewMember(member, { dailyBars: daily, intradayBars: intraday });
    }
    reviewMembers.push(member);
  }

  const scan = runTickerReviewScan({
    tickers: reviewMembers,
    themeMedianPct: options.themeMedianPct ?? 0,
    mode: options.mode ?? "auto",
    enabledRequired: options.enabledRequired ?? ["R3", "R4", "R5", "R6"],
    enabledOptional,
    raiLabel: options.raiLabel,
    themeRank: options.themeRank,
    maxResults: options.maxResults ?? 10,
  });

  const warnings: string[] = [];
  if (!barsEnriched) warnings.push("Pattern detection used metric fallbacks — daily bars unavailable");
  else warnings.push("Bar-backed setup detection active (U&R, VCP, G&G, HVC, breakout)");
  if (wantsOrb && !orbSessionActive) warnings.push("ORB requires market-hours intraday session");
  if (wantsOrb && orbSessionActive) warnings.push("ORB uses 1m opening range (30 min max, early trigger)");

  return {
    themeId,
    scanMode: scan.effectiveMode,
    memberCount: scoped.length,
    patternEnriched: barsEnriched,
    hvcEnriched: barsEnriched,
    warnings,
    ...scan,
  };
}
