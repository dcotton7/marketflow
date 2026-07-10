// ---------------------------------------------------------------------------
// Pipeline Router
//
// Matches incoming signals to registered pipelines, runs lens evaluation,
// applies qualify filters, and dispatches to reactions.
// ---------------------------------------------------------------------------

import type {
  Signal,
  PipelineDefinition,
  PipelinePriority,
  EnrichedSignal,
  LensId,
  LensResult,
  MarketSession,
  PeerVelocityResult,
  CrossThemeResult,
  FastestMoversResult,
  RelativeStrengthResult,
} from "@shared/scanner-types";
import { evaluateLenses, type LensContext } from "./lenses";
import { DEFAULT_PIPELINES } from "./default-pipelines";

// ── Pipeline registry ───────────────────────────────────────────────────────

let activePipelines: PipelineDefinition[] = [...DEFAULT_PIPELINES];

export function getActivePipelines(): PipelineDefinition[] {
  return activePipelines.filter((p) => p.enabled);
}

export function registerPipeline(pipeline: PipelineDefinition): void {
  const idx = activePipelines.findIndex((p) => p.id === pipeline.id);
  if (idx >= 0) activePipelines[idx] = pipeline;
  else activePipelines.push(pipeline);
}

export function setPipelineEnabled(pipelineId: string, enabled: boolean): void {
  const p = activePipelines.find((p) => p.id === pipelineId);
  if (p) p.enabled = enabled;
}

// ── Pipeline cooldowns (separate from signal cooldowns) ─────────────────────

const pipelineCooldowns = new Map<string, number>();

function isPipelineCooling(pipelineId: string, subject: string, cooldownMs: number): boolean {
  const key = `${pipelineId}:${subject}`;
  const last = pipelineCooldowns.get(key);
  return !!last && Date.now() - last < cooldownMs;
}

function markPipelineFired(pipelineId: string, subject: string): void {
  pipelineCooldowns.set(`${pipelineId}:${subject}`, Date.now());
}

// ── After-hours peer liquidity gate ─────────────────────────────────────────

const PEER_DEPENDENT_PIPELINES = new Set([
  "leadership_divergence",
  "volume_cluster",
  "strength_surge",
  "weakness_cascade",
]);

const MIN_ACTIVE_PEERS = 4;

function isExtendedHours(session?: MarketSession): boolean {
  return session === "after_hours" || session === "pre_market";
}

function peerLiquidityGate(
  pipelineId: string,
  context: Partial<Record<LensId, LensResult>>,
  session?: MarketSession
): boolean {
  if (!isExtendedHours(session)) return true;
  if (!PEER_DEPENDENT_PIPELINES.has(pipelineId)) return true;

  const pv = context.peer_velocity as PeerVelocityResult | undefined;
  if (!pv?.peers) return false;

  const activePeers = pv.peers.filter(
    (p) => Math.abs(p.changePct) > 0.01 || p.volumeRatio > 0
  ).length;

  return activePeers >= MIN_ACTIVE_PEERS;
}

// ── Qualify logic ───────────────────────────────────────────────────────────

/** Diminishing returns curve: raw → capped score. Reserves 90+ for exceptional events. */
function capScore(raw: number): number {
  if (raw <= 0) return 0;
  if (raw <= 40) return raw;
  if (raw <= 70) return 40 + (raw - 40) * 0.7; // 40–61
  if (raw <= 100) return 61 + (raw - 70) * 0.5; // 61–76
  // Above 100 raw → 76–89 range (diminishing)
  const excess = raw - 100;
  return Math.min(89, 76 + excess * 0.25);
  // 90+ is only awarded by explicit exceptional-event logic below
}

function qualifySignal(
  pipeline: PipelineDefinition,
  signal: Signal,
  context: Partial<Record<LensId, LensResult>>,
  session?: MarketSession
): { qualified: boolean; score: number; priorityOverride?: PipelinePriority } {
  if (!peerLiquidityGate(pipeline.id, context, session)) {
    return { qualified: false, score: 0 };
  }

  let raw = 0;

  // Base score from signal magnitude (diminished)
  raw += Math.min(25, signal.magnitude * 8);

  switch (pipeline.id) {
    case "volume_cluster": {
      const pv = context.peer_velocity as PeerVelocityResult | undefined;
      if (!pv || pv.movingCount < 2) return { qualified: false, score: 0 };
      raw += pv.movingCount * 12;
      raw += pv.correlation * 15;
      if (pv.verdict === "sector_wide") raw += 20;
      return { qualified: true, score: capScore(raw) };
    }

    case "weakness_cascade": {
      const ct = context.cross_theme as CrossThemeResult | undefined;
      const fm = context.fastest_movers as FastestMoversResult | undefined;
      const themesMoving = ct?.contagion.length ?? 0;
      if (themesMoving < 3 && signal.type !== "broad_weakness") {
        return { qualified: false, score: 0 };
      }
      raw += themesMoving * 8;
      if (fm?.movers.length) raw += Math.min(15, fm.movers.length * 3);
      if (ct?.interpretation === "risk_off_cascade") raw += 20;
      // Real price validation: check if movers are actually down on the day
      const actuallyDown = fm?.movers.filter(m => m.changePct < 0).length ?? 0;
      if (fm?.movers.length && actuallyDown < fm.movers.length * 0.5) {
        return { qualified: false, score: 0 };
      }
      return { qualified: true, score: capScore(raw) };
    }

    case "strength_surge": {
      const fm = context.fastest_movers as FastestMoversResult | undefined;
      if (!fm || fm.movers.length < 3) return { qualified: false, score: 0 };
      // Real price validation: movers must actually be up on the day
      const actuallyUp = fm.movers.filter(m => m.changePct > 0).length;
      if (actuallyUp < fm.movers.length * 0.5) return { qualified: false, score: 0 };
      raw += fm.movers.length * 4;
      return { qualified: true, score: capScore(raw) };
    }

    case "leadership_divergence": {
      const rs = context.relative_strength as RelativeStrengthResult | undefined;
      if (!rs?.isDiverging) return { qualified: false, score: 0 };
      raw += Math.abs(rs.rsVsTheme) * 8;
      if (rs.divergenceType === "leader") raw += 12;
      return { qualified: true, score: capScore(raw) };
    }

    case "gap_morning_scan": {
      raw += signal.magnitude * 5;
      const gapPct = (signal.meta?.gapPct as number) ?? signal.magnitude;
      if (gapPct >= 5) raw += 20;
      const volRatio = signal.meta?.volumeRatio as number | undefined;
      if (volRatio != null && volRatio > 2) raw += 10;
      const gapScore = capScore(raw);
      return {
        qualified: true,
        score: gapScore,
        priorityOverride: gapScore >= 70 ? "urgent" : undefined,
      };
    }

    case "regime_shift":
      return { qualified: true, score: 90 };

    case "adr_blowout_watch":
      raw += signal.magnitude * 6;
      return { qualified: true, score: capScore(raw) };

    case "news_alert_scan": {
      const severity = (signal.meta?.severity as number) ?? signal.magnitude;
      const corroborated = signal.meta?.corroborated as boolean ?? false;
      raw += severity * 8;
      if (corroborated) raw += 15;
      if (severity >= 8) raw += 10;
      return { qualified: true, score: capScore(raw) };
    }

    // ── New intraday trade setup pipelines ──────────────────────────────

    case "lod_bounce_scan": {
      const tier = (signal.meta?.tier as number) ?? 1;
      raw += tier === 2 ? 20 : 10;
      raw += signal.magnitude * 5;
      return { qualified: true, score: capScore(raw) };
    }

    case "ma_reclaim_scan": {
      const priority = signal.magnitude; // 3=200d, 2=50d, 1=20d
      raw += priority * 15;
      return { qualified: true, score: capScore(raw) };
    }

    case "prev_day_break_scan": {
      raw += 20;
      const shortPriority = signal.meta?.shortPriority as string | undefined;
      if (shortPriority === "urgent") raw += 25;
      else if (shortPriority === "high") raw += 15;
      else if (shortPriority === "elevated") raw += 10;
      raw += signal.magnitude * 3;
      return { qualified: true, score: capScore(raw) };
    }

    case "five_day_break_scan": {
      raw += 25;
      const shortPriority = signal.meta?.shortPriority as string | undefined;
      if (shortPriority === "urgent") raw += 30;
      else if (shortPriority === "high") raw += 20;
      else if (shortPriority === "elevated") raw += 12;
      raw += signal.magnitude * 3;
      return { qualified: true, score: capScore(raw) };
    }

    case "failed_breakout_scan": {
      raw += 25;
      if (signal.meta?.below200d) raw += 15;
      if (signal.meta?.below50d) raw += 10;
      raw += signal.magnitude * 3;
      const fbScore = capScore(raw);
      return {
        qualified: true,
        score: fbScore,
        priorityOverride: (signal.meta?.below200d && signal.meta?.below50d) ? "urgent" : undefined,
      };
    }

    case "hod_fade_scan": {
      raw += 20;
      const fadePct = (signal.meta?.fadeFromHodPct as number) ?? signal.magnitude;
      raw += Math.min(20, fadePct * 5);
      if (signal.meta?.below200d) raw += 12;
      if (signal.meta?.below50d) raw += 8;
      return { qualified: true, score: capScore(raw) };
    }

    case "gap_down_continuation_scan": {
      raw += 20;
      const gapMag = signal.magnitude;
      raw += Math.min(20, gapMag * 4);
      if (signal.meta?.below200d) raw += 12;
      if (signal.meta?.below50d) raw += 8;
      return { qualified: true, score: capScore(raw) };
    }

    case "post_earnings_scan": {
      const gapPctER = Math.abs((signal.meta?.gapPct as number) ?? signal.magnitude);
      raw += Math.min(30, gapPctER * 5);
      const surprisePct = signal.meta?.epsSurprisePct as number | undefined;
      if (surprisePct != null && Math.abs(surprisePct) > 10) raw += 15;
      if (gapPctER >= 5) raw += 15;
      const erScore = capScore(raw);
      return {
        qualified: true,
        score: erScore,
        priorityOverride: erScore >= 60 ? "urgent" : undefined,
      };
    }

    case "theme_earnings_density_scan": {
      const count = (signal.meta?.count as number) ?? signal.magnitude;
      raw += count * 10;
      if (count >= 5) raw += 15;
      return { qualified: true, score: capScore(raw) };
    }

    case "ipo_debut_scan": {
      const marketCap = (signal.meta?.marketCap as number) ?? 0;
      const capM = marketCap / 1e6;
      raw += Math.min(30, capM / 100);
      const exchange = (signal.meta?.exchange as string) ?? "";
      if (exchange === "NASDAQ" || exchange === "NYSE") raw += 15;
      if (capM >= 1000) raw += 20;
      if (capM >= 5000) raw += 15;
      const ipoScore = capScore(raw);
      return {
        qualified: true,
        score: ipoScore,
        priorityOverride: capM >= 1000 ? "urgent" : undefined,
      };
    }

    default:
      return { qualified: true, score: capScore(raw) };
  }
}

// ── Router ──────────────────────────────────────────────────────────────────

function matchesTrigger(pipeline: PipelineDefinition, signal: Signal): boolean {
  const t = pipeline.trigger;

  if (!t.signalTypes.includes(signal.type)) return false;
  if (t.subjectKind && t.subjectKind !== signal.subjectKind) return false;
  if (t.minMagnitude != null && signal.magnitude < t.minMagnitude) return false;
  if (t.direction && t.direction !== signal.direction) return false;

  return true;
}

/**
 * Route a batch of signals through all active pipelines.
 * Returns enriched signals that qualified.
 */
export async function routeSignals(
  signals: Signal[],
  lensCtx: LensContext,
  session?: MarketSession
): Promise<EnrichedSignal[]> {
  const pipelines = getActivePipelines();
  const enriched: EnrichedSignal[] = [];

  for (const signal of signals) {
    for (const pipeline of pipelines) {
      if (!matchesTrigger(pipeline, signal)) continue;
      if (isPipelineCooling(pipeline.id, signal.subject, pipeline.cooldownMs)) continue;

      const context = await evaluateLenses(pipeline.lensIds, signal, lensCtx);
      const { qualified, score, priorityOverride } = qualifySignal(pipeline, signal, context, session);

      if (!qualified) continue;

      markPipelineFired(pipeline.id, signal.subject);

      enriched.push({
        signal,
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        context,
        qualified: true,
        qualifyScore: score,
        priority: priorityOverride ?? pipeline.priority,
        timestamp: new Date(),
      });
    }
  }

  return enriched;
}
