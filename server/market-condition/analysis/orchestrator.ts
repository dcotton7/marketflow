/**
 * MarketFlow Analysis Orchestrator
 * Runs modules in parallel phases with dependency resolution
 */

import type { ModuleResponse, AnalysisResult, SetupDetectionData } from "./types";
import {
  runMarketContext,
  runKeyLevels,
  runVolume,
  runSetupDetection,
  runWyckoffStage,
  runNews,
  runEarnings,
  runRiskCalendar,
  runFundFlow,
  runSentiment,
  runPositionSizing,
} from "./modules";
import { runSynthesis } from "./synthesis/engine";

const VERSION = "v2.11";

interface OrchestratorOptions {
  skipSynthesis?: boolean;
  timeout?: number;
}

/**
 * Run full analysis for a symbol
 * Phase 1 (parallel, no deps): marketContext, news, earnings, volume, riskCalendar, sentiment
 * Phase 2 (after price data): keyLevels, setupDetection
 * Phase 3 (after setup): fundFlow, positionSizing
 * Phase 4 (all complete): AI synthesis
 */
export async function runAnalysis(
  symbol: string,
  options: OrchestratorOptions = {}
): Promise<AnalysisResult> {
  const start = Date.now();
  const timeout = options.timeout ?? 30000;
  const moduleResponses: ModuleResponse[] = [];

  const upper = symbol.toUpperCase();

  // Phase 1: Independent modules (no dependencies)
  console.log(`[Orchestrator] Phase 1: Running independent modules for ${upper}`);
  const phase1Results = await runWithTimeout(
    Promise.allSettled([
      runMarketContext(upper),
      runNews(upper),
      runEarnings(upper),
      runVolume(upper),
      runRiskCalendar(upper),
      runSentiment(upper),
    ]),
    timeout,
    "Phase 1"
  );

  for (const result of phase1Results) {
    if (result.status === "fulfilled") {
      moduleResponses.push(result.value);
    } else {
      console.error(`[Orchestrator] Phase 1 module failed:`, result.reason);
    }
  }

  // Phase 2: Depends on price data (keyLevels, setupDetection, wyckoffStage)
  console.log(`[Orchestrator] Phase 2: Running price-dependent modules for ${upper}`);
  const phase2Results = await runWithTimeout(
    Promise.allSettled([
      runKeyLevels(upper),
      runSetupDetection(upper),
      runWyckoffStage(upper),
    ]),
    timeout,
    "Phase 2"
  );

  let setupData: SetupDetectionData | undefined;
  for (const result of phase2Results) {
    if (result.status === "fulfilled") {
      moduleResponses.push(result.value);
      if (result.value.module_id === "setupDetection") {
        setupData = result.value.data as SetupDetectionData;
      }
    } else {
      console.error(`[Orchestrator] Phase 2 module failed:`, result.reason);
    }
  }

  // Phase 3: Depends on setup detection (fundFlow, positionSizing)
  console.log(`[Orchestrator] Phase 3: Running setup-dependent modules for ${upper}`);
  const phase3Results = await runWithTimeout(
    Promise.allSettled([
      runFundFlow(upper),
      runPositionSizing(upper, setupData),
    ]),
    timeout,
    "Phase 3"
  );

  for (const result of phase3Results) {
    if (result.status === "fulfilled") {
      moduleResponses.push(result.value);
    } else {
      console.error(`[Orchestrator] Phase 3 module failed:`, result.reason);
    }
  }

  // Phase 4: AI Synthesis
  let synthesis;
  if (options.skipSynthesis) {
    console.log(`[Orchestrator] Skipping synthesis (skipSynthesis=true)`);
    synthesis = createFallbackSynthesis(upper, moduleResponses);
  } else {
    console.log(`[Orchestrator] Phase 4: Running AI synthesis for ${upper}`);
    try {
      synthesis = await runWithTimeout(
        runSynthesis(upper, moduleResponses),
        timeout,
        "Synthesis"
      );
    } catch (error) {
      console.error(`[Orchestrator] Synthesis failed, using fallback:`, error);
      synthesis = createFallbackSynthesis(upper, moduleResponses);
    }
  }

  const executionMs = Date.now() - start;
  console.log(`[Orchestrator] Analysis complete for ${upper} in ${executionMs}ms`);

  return {
    symbol: upper,
    moduleResponses,
    synthesis,
    generated_at: new Date().toISOString(),
    execution_ms: executionMs,
    version: VERSION,
  };
}

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

function createFallbackSynthesis(symbol: string, modules: ModuleResponse[]) {
  // Build a basic synthesis from module signals
  const signals = modules.map((m) => m.signal);
  const bullishCount = signals.filter((s) => s === "bullish").length;
  const bearishCount = signals.filter((s) => s === "bearish").length;
  const warningCount = signals.filter((s) => s === "warning").length;

  let action: "strong_buy" | "buy" | "watch" | "avoid" | "short" = "watch";
  if (bullishCount >= 5 && bearishCount === 0) action = "strong_buy";
  else if (bullishCount >= 3 && bearishCount <= 1) action = "buy";
  else if (bearishCount >= 3) action = "avoid";
  else if (bearishCount >= 5) action = "short";

  const conviction = Math.round(
    50 + bullishCount * 8 - bearishCount * 10 - warningCount * 3
  );

  // Collect flags
  const allFlags = modules.flatMap((m) => m.flags ?? []);
  const bullishFlags = allFlags.filter((f) =>
    f.includes("BULLISH") || f.includes("WYCKOFF_ACCUMULATION") || f.includes("WYCKOFF_MARKUP") ||
    f.includes("ACCUMULATION") || f.includes("INFLOW") || f.includes("HIGH_VOLUME_UP") ||
    f.includes("SPRING_DETECTED") || f.includes("SOS_DETECTED")
  );
  const bearishFlags = allFlags.filter((f) =>
    f.includes("BEARISH") || f.includes("WYCKOFF_DISTRIBUTION") || f.includes("WYCKOFF_MARKDOWN") ||
    f.includes("DISTRIBUTION") || f.includes("OUTFLOW") || f.includes("RISK_OFF") ||
    f.includes("UPTHRUST_DETECTED") || f.includes("SOW_DETECTED")
  );

  // Build summary
  const summaryParts: string[] = [];
  const marketContext = modules.find((m) => m.module_id === "marketContext");
  const setupModule = modules.find((m) => m.module_id === "setupDetection");
  const volumeModule = modules.find((m) => m.module_id === "volume");

  // Extract company info for fallback description
  const contextData = marketContext?.data as { companyName?: string; sector?: string; industry?: string } | undefined;
  const companyName = contextData?.companyName || symbol;
  const sector = contextData?.sector || "Unknown";
  const industry = contextData?.industry || "Unknown";

  if (marketContext) {
    summaryParts.push(marketContext.summary);
  }
  if (setupModule) {
    summaryParts.push(setupModule.summary);
  }
  if (volumeModule && volumeModule.signal !== "neutral") {
    summaryParts.push(volumeModule.summary);
  }

  return {
    company_description: `${companyName} operates in the ${sector} sector (${industry}).`,
    executive_summary: summaryParts.join(" ") || `Analysis complete for ${symbol}.`,
    conviction_score: Math.max(0, Math.min(100, conviction)),
    action,
    action_rationale: `Based on ${bullishCount} bullish, ${bearishCount} bearish, ${warningCount} warning signals.`,
    key_bullish: bullishFlags.slice(0, 5),
    key_bearish: bearishFlags.slice(0, 5),
    conflicts: findConflicts(modules),
    rubric_autofill: extractRubricAutofill(modules),
    model_used: "fallback",
  };
}

function findConflicts(modules: ModuleResponse[]): string[] {
  const conflicts: string[] = [];

  // Check for conflicting signals
  const marketContext = modules.find((m) => m.module_id === "marketContext");
  const volume = modules.find((m) => m.module_id === "volume");
  const setup = modules.find((m) => m.module_id === "setupDetection");
  const sentiment = modules.find((m) => m.module_id === "sentiment");
  const wyckoff = modules.find((m) => m.module_id === "wyckoffStage");

  if (marketContext?.signal === "bearish" && setup?.signal === "bullish") {
    conflicts.push("Setup is bullish but market regime is risk-off");
  }

  if (volume?.signal === "bearish" && setup?.signal === "bullish") {
    conflicts.push("Setup is bullish but volume is showing distribution");
  }

  if (sentiment?.signal === "bearish" && setup?.signal === "bullish") {
    conflicts.push("Setup is bullish but analyst sentiment is negative");
  }

  // Wyckoff conflicts
  if (wyckoff?.signal === "bearish" && setup?.signal === "bullish") {
    conflicts.push("Setup is bullish but Wyckoff shows distribution/markdown");
  }

  if (wyckoff?.signal === "bullish" && marketContext?.signal === "bearish") {
    conflicts.push("Wyckoff shows accumulation but market regime is risk-off");
  }

  return conflicts;
}

function extractRubricAutofill(modules: ModuleResponse[]): Record<string, unknown> {
  const setup = modules.find((m) => m.module_id === "setupDetection");
  if (setup?.data && typeof setup.data === "object" && "rubricAutofill" in setup.data) {
    return (setup.data as { rubricAutofill: Record<string, unknown> }).rubricAutofill;
  }
  return {};
}
