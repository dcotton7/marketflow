/**
 * Options Module (Options Pulse v0)
 * P/C volume, call vs put premium, volume vs OI, ATM IV and straddle expected move.
 * Live from Alpaca OPRA, memory-cached only — routes strip this module before the DB analysis cache.
 */

import type { ModuleResponse, OptionsPulseData } from "../types";
import { getOptionsPulse } from "../../options/provider";

function fmtMoney(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export async function runOptions(symbol: string): Promise<ModuleResponse<OptionsPulseData>> {
  const start = Date.now();
  const { pulse, error } = await getOptionsPulse(symbol).catch((err: Error) => ({
    pulse: null,
    error: err.message,
    apiCalls: { data: 0, trading: 0 },
  }));

  if (!pulse) {
    return {
      module_id: "options",
      ticker: symbol,
      signal: "informational",
      summary: `Options data unavailable for ${symbol}${error ? ` (${error})` : ""}.`,
      confidence: 0,
      flags: ["OPTIONS_UNAVAILABLE"],
      executionMs: Date.now() - start,
      data: { pulse: null, error: error ?? "No data" },
    };
  }

  const flags: string[] = [];
  const parts: string[] = [];
  if (pulse.scope.contracts === 0) {
    parts.push(`No listed options found for ${symbol} within ${pulse.scope.maxDte} days / ±${pulse.scope.strikeBandPct}% strikes.`);
    flags.push("NO_OPTIONS_IN_SCOPE");
  } else {
    parts.push(
      pulse.pcVolumeRatio != null
        ? `P/C volume ${pulse.pcVolumeRatio.toFixed(2)} (${pulse.callVolume.toLocaleString()} calls / ${pulse.putVolume.toLocaleString()} puts).`
        : `No call volume yet (${pulse.putVolume.toLocaleString()} puts).`
    );
    if (pulse.callPremiumSharePct != null) {
      parts.push(
        `Premium: calls ${fmtMoney(pulse.callPremium)} vs puts ${fmtMoney(pulse.putPremium)} (${pulse.callPremiumSharePct.toFixed(0)}% calls).`
      );
    }
    if (pulse.atm.iv != null) {
      parts.push(`ATM IV ${(pulse.atm.iv * 100).toFixed(1)}% (${pulse.atm.expiration}).`);
    } else {
      parts.push("ATM IV n/a.");
    }
    if (pulse.atm.expectedMovePct != null && pulse.atm.expectedMove != null) {
      parts.push(
        `Expected move ±$${pulse.atm.expectedMove.toFixed(2)} (±${pulse.atm.expectedMovePct.toFixed(1)}%) by ${pulse.atm.expiration}.`
      );
    }
    if (pulse.volumeVsOi != null && pulse.openInterest) {
      parts.push(`Volume is ${pulse.volumeVsOi.toFixed(2)}× open interest (${pulse.openInterest.label}).`);
      if (pulse.volumeVsOi >= 1) flags.push("OPTIONS_VOLUME_ABOVE_OI");
    }
    if (pulse.scope.truncated) flags.push("OPTIONS_SCOPE_TRUNCATED");
  }

  // Coverage-based confidence only; this module makes no bullish/bearish call.
  const confidence = Math.round(
    Math.min(100, (pulse.scope.contracts > 0 ? 40 : 0) + pulse.ivCoveragePct * 0.3 + (pulse.openInterest?.coveragePct ?? 0) * 0.3)
  );

  return {
    module_id: "options",
    ticker: symbol,
    signal: "informational",
    summary: parts.join(" "),
    confidence,
    flags,
    executionMs: Date.now() - start,
    data: { pulse, error: null },
  };
}
