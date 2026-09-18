// ---------------------------------------------------------------------------
// Scanner Evidence Service — episode-deduped cohort aggregates for Signals Lab
// and live rank-only badges. Uses SQL aggregation (no full-row materialization).
// ---------------------------------------------------------------------------

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  OUTCOME_CONTRACT_V3,
  classifyEvidenceTier,
  sampleConfidence,
  shrinkRate,
  type EvidenceTier,
  type OutcomeWindowKey,
} from "@shared/scanner-outcome-v3";
import {
  PROVISIONAL_CANDIDATE_COHORTS,
  evaluateCostSensitivity,
  summarizeHoldout,
  type CostSensitivityResult,
  type HoldoutSummary,
  type HoldoutWeek,
} from "@shared/scanner-evidence-holdout";
import {
  lowestThemePercentileCap,
  lowestThemeRankFloor,
  parseThemeRankCut,
  parseThemeRankN,
  type ThemeRankCut,
} from "@shared/scanner-theme-rank-filter";

export type EvidenceTrust = "trusted" | "provisional";

export type EvidenceQuery = {
  from: string;
  to: string;
  window: OutcomeWindowKey;
  hitThreshold: number;
  minEpisodes: number;
  session?: string;
  subjectKind?: "ticker" | "theme" | "market" | "all";
  trust?: "auto" | "trusted" | "provisional" | "all";
  /** Heavy breakdown query — skip for fast Lab table loads. Default true. */
  includeCohorts?: boolean;
  /** Rank at fire: leading = rank 1..N, lowest = bottom N Flow themes. */
  themeRankCut?: ThemeRankCut;
  themeRankN?: number;
};

export type SignalTypeEvidence = {
  signalType: string;
  trust: EvidenceTrust;
  totalFired: number;
  episodes: number;
  tracked: number;
  coverage: number;
  hitRate: number | null;
  hitRateShrunk: number | null;
  avgMove: number | null;
  medianMove: number | null;
  avgPeakMove: number | null;
  avgGiveback: number | null;
  failRate: number | null;
  reversalRate: number | null;
  mfe3Rate: number | null;
  mae3Rate: number | null;
  confidence: number;
  tier: EvidenceTier;
  preferredWindow: OutcomeWindowKey;
};

export type CohortBreakdownRow = {
  signalType: string;
  dimension: string;
  bucket: string;
  episodes: number;
  tracked: number;
  hitRate: number | null;
  avgMove: number | null;
  confidence: number;
  tier: EvidenceTier;
};

export type EvidenceSnapshot = {
  signalTypes: SignalTypeEvidence[];
  cohorts: CohortBreakdownRow[];
  dateRange: { from: string; to: string };
  window: OutcomeWindowKey;
  hitThreshold: number;
  trustUsed: EvidenceTrust | "mixed";
  qualityWarnings: string[];
  generatedAt: string;
};

const WINDOW_MOVE_SQL: Record<OutcomeWindowKey, string> = {
  "15m": "move_15m",
  "30m": "move_30m",
  "1hr": "move_1hr",
  "4hr": "move_4hr",
  d1_close: "move_d1_close",
  d2_open: "move_d2_open",
  d2_close: "move_d2_close",
  "1w": "move_1w",
  "1mo": "move_1mo",
};

export function themeRankSqlPredicate(cut: ThemeRankCut, n: number) {
  if (cut === "all") return sql`TRUE`;
  const rankExpr = sql`COALESCE(
    NULLIF(context_json->'discovery_filters'->>'themeRank','')::int,
    NULLIF(context_json->'theme_membership'->>'themeRank','')::int
  )`;
  if (cut === "leading") {
    return sql`(${rankExpr}) IS NOT NULL AND (${rankExpr}) >= 1 AND (${rankExpr}) <= ${n}`;
  }
  const floorRank = lowestThemeRankFloor(n);
  const pctCap = lowestThemePercentileCap(n);
  const pctExpr = sql`COALESCE(
    NULLIF(context_json->'discovery_filters'->>'themePercentile','')::float8,
    NULLIF(context_json->'theme_membership'->>'themePercentile','')::float8
  )`;
  return sql`(
    ((${rankExpr}) IS NOT NULL AND (${rankExpr}) >= ${floorRank})
    OR ((${pctExpr}) IS NOT NULL AND (${pctExpr}) > 0 AND (${pctExpr}) <= ${pctCap})
  )`;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: EvidenceSnapshot }>();

function cacheKey(q: EvidenceQuery): string {
  return JSON.stringify(q);
}

function round3(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

async function countTrustedRows(from: string, to: string): Promise<number> {
  if (!db) return 0;
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM scanner_discoveries
    WHERE created_at >= ${from + "T00:00:00Z"}::timestamptz
      AND created_at <= ${to + "T23:59:59Z"}::timestamptz
      AND outcome_contract_version = ${OUTCOME_CONTRACT_V3}
  `);
  const rows = (r as any).rows ?? r;
  return Number(rows[0]?.n ?? 0);
}

export async function getEvidenceSnapshot(queryIn: EvidenceQuery): Promise<EvidenceSnapshot> {
  const themeRankCut = parseThemeRankCut(queryIn.themeRankCut);
  const themeRankN = parseThemeRankN(queryIn.themeRankN);
  const query: EvidenceQuery = { ...queryIn, themeRankCut, themeRankN };

  if (!db) {
    return {
      signalTypes: [],
      cohorts: [],
      dateRange: { from: query.from, to: query.to },
      window: query.window,
      hitThreshold: query.hitThreshold,
      trustUsed: "provisional",
      qualityWarnings: ["Database not available"],
      generatedAt: new Date().toISOString(),
    };
  }

  const key = cacheKey(query);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const warnings: string[] = [];
  let trustFilter = query.trust ?? "auto";
  let trustUsed: EvidenceTrust | "mixed" = "provisional";
  let trustedCount = 0;

  // Skip the extra COUNT when caller already pinned trust mode.
  if (trustFilter === "auto" || trustFilter === "trusted") {
    trustedCount = await countTrustedRows(query.from, query.to);
  }

  if (trustFilter === "auto") {
    if (trustedCount >= Math.max(query.minEpisodes * 5, 50)) {
      trustFilter = "trusted";
      trustUsed = "trusted";
    } else {
      trustFilter = "provisional";
      trustUsed = "provisional";
      warnings.push(
        `Only ${trustedCount} V3-trusted outcomes in range — showing provisional/legacy stats (label, do not treat as production truth).`
      );
    }
  } else if (trustFilter === "trusted") {
    trustUsed = "trusted";
    if (trustedCount < query.minEpisodes) {
      warnings.push("Trusted V3 sample is thin; rankings will mostly be unknown.");
    }
  } else if (trustFilter === "provisional") {
    trustUsed = "provisional";
    warnings.push("Provisional legacy outcomes use V2 live-print clocks — treat as research only.");
  } else {
    trustUsed = "mixed";
    warnings.push("Mixed trust mode includes legacy and V3 rows.");
  }

  if (themeRankCut === "leading") {
    warnings.push(`Theme cut: leading ${themeRankN} (rank 1–${themeRankN} at fire). Unknown rank excluded.`);
  } else if (themeRankCut === "lowest") {
    warnings.push(
      `Theme cut: lowest ${themeRankN} (rank ≥${lowestThemeRankFloor(themeRankN)} or percentile ≤${lowestThemePercentileCap(themeRankN)}). Unknown rank excluded unless percentile matches.`
    );
  }

  const moveCol = WINDOW_MOVE_SQL[query.window] ?? "move_1hr";
  const fromTs = `${query.from}T00:00:00Z`;
  const toTs = `${query.to}T23:59:59Z`;
  const session = query.session && query.session !== "all" ? query.session : null;
  const subjectKind = query.subjectKind && query.subjectKind !== "all" ? query.subjectKind : null;

  const aggResult = await db.execute(sql`
    WITH base AS (
      SELECT
        id,
        signal_type,
        subject,
        subject_kind,
        direction,
        qualify_score,
        session_at_signal,
        regime_at_signal,
        outcome_status,
        outcome_failed,
        peak_move,
        worst_drawdown,
        giveback_pct,
        outcome_contract_version,
        created_at,
        context_json,
        ${sql.raw(moveCol)} AS move_raw,
        CASE
          WHEN direction = 'down' THEN -(${sql.raw(moveCol)})
          WHEN direction = 'up' THEN ${sql.raw(moveCol)}
          ELSE ABS(${sql.raw(moveCol)})
        END AS move_adj,
        NULLIF(context_json->'discovery_filters'->>'themePercentile','')::float8 AS theme_pct,
        context_json->'ma_structure'->>'maStack' AS ma_stack,
        NULLIF(context_json->'discovery_filters'->>'priorDayDollarVol','')::float8 AS prior_dv
      FROM scanner_discoveries
      WHERE created_at >= ${fromTs}::timestamptz
        AND created_at <= ${toTs}::timestamptz
        AND (${session}::text IS NULL OR session_at_signal = ${session})
        AND (${subjectKind}::text IS NULL OR subject_kind = ${subjectKind})
        AND (
          ${trustFilter}::text = 'all'
          OR (${trustFilter}::text = 'trusted' AND outcome_contract_version = 'v3')
          OR (${trustFilter}::text = 'provisional' AND (outcome_contract_version IS NULL OR outcome_contract_version <> 'v3'))
        )
        AND ${themeRankSqlPredicate(themeRankCut, themeRankN)}
    ),
    fired AS (
      SELECT signal_type, COUNT(*)::int AS total_fired
      FROM base
      GROUP BY signal_type
    ),
    episodes AS (
      SELECT DISTINCT ON (signal_type, subject, (created_at AT TIME ZONE 'America/New_York')::date)
        *
      FROM base
      WHERE direction IN ('up', 'down')
      ORDER BY signal_type, subject, (created_at AT TIME ZONE 'America/New_York')::date, created_at ASC
    )
    SELECT
      e.signal_type AS "signalType",
      COUNT(*)::int AS episodes,
      COUNT(e.move_raw)::int AS tracked,
      ROUND(AVG(CASE WHEN e.move_adj >= ${query.hitThreshold} THEN 1 ELSE 0 END) FILTER (WHERE e.move_raw IS NOT NULL)::numeric, 4) AS "hitRate",
      ROUND(AVG(e.move_adj) FILTER (WHERE e.move_raw IS NOT NULL)::numeric, 4) AS "avgMove",
      NULL::numeric AS "medianMove",
      ROUND(AVG(e.peak_move) FILTER (WHERE e.peak_move IS NOT NULL)::numeric, 3) AS "avgPeakMove",
      ROUND(AVG(e.giveback_pct) FILTER (WHERE e.giveback_pct IS NOT NULL)::numeric, 3) AS "avgGiveback",
      ROUND(AVG(CASE WHEN e.outcome_failed THEN 1 ELSE 0 END)::numeric, 4) AS "failRate",
      ROUND(AVG(CASE WHEN e.outcome_status = 'reversed' THEN 1 ELSE 0 END)::numeric, 4) AS "reversalRate",
      ROUND(AVG(CASE WHEN e.peak_move >= 3 THEN 1 ELSE 0 END) FILTER (WHERE e.peak_move IS NOT NULL)::numeric, 4) AS "mfe3Rate",
      ROUND(AVG(CASE WHEN e.worst_drawdown <= -3 THEN 1 ELSE 0 END) FILTER (WHERE e.worst_drawdown IS NOT NULL)::numeric, 4) AS "mae3Rate",
      MAX(f.total_fired)::int AS "totalFired"
    FROM episodes e
    JOIN fired f ON f.signal_type = e.signal_type
    GROUP BY e.signal_type
    ORDER BY MAX(f.total_fired) DESC
  `);

  const aggRows = ((aggResult as any).rows ?? aggResult) as any[];

  const signalTypes: SignalTypeEvidence[] = [];
  for (const row of aggRows) {
    const episodes = Number(row.episodes ?? 0);
    const tracked = Number(row.tracked ?? 0);
    const totalFired = Number(row.totalFired ?? 0);
    const coverage = episodes > 0 ? tracked / episodes : 0;
    const hitRate = row.hitRate != null ? Number(row.hitRate) : null;
    const avgMove = row.avgMove != null ? Number(row.avgMove) : null;

    if (tracked < query.minEpisodes) {
      signalTypes.push({
        signalType: row.signalType,
        trust: trustUsed === "trusted" ? "trusted" : "provisional",
        totalFired,
        episodes,
        tracked,
        coverage: round3(coverage) ?? 0,
        hitRate: null,
        hitRateShrunk: null,
        avgMove: null,
        medianMove: null,
        avgPeakMove: null,
        avgGiveback: null,
        failRate: null,
        reversalRate: null,
        mfe3Rate: null,
        mae3Rate: null,
        confidence: sampleConfidence(tracked),
        tier: "unknown",
        preferredWindow: query.window,
      });
      continue;
    }

    const hits = hitRate != null ? Math.round(hitRate * tracked) : 0;
    const shrunk = hitRate != null ? shrinkRate(hits, tracked) : null;
    const confidence = sampleConfidence(tracked);
    const tier = classifyEvidenceTier({
      episodes: tracked,
      hitRate,
      edgePct: avgMove,
      confidence,
    });

    signalTypes.push({
      signalType: row.signalType,
      trust: trustUsed === "trusted" ? "trusted" : "provisional",
      totalFired,
      episodes,
      tracked,
      coverage: round3(coverage) ?? 0,
      hitRate: round3(hitRate),
      hitRateShrunk: round3(shrunk),
      avgMove: round3(avgMove),
      medianMove: round3(row.medianMove != null ? Number(row.medianMove) : null),
      avgPeakMove: round3(row.avgPeakMove != null ? Number(row.avgPeakMove) : null),
      avgGiveback: round3(row.avgGiveback != null ? Number(row.avgGiveback) : null),
      failRate: round3(row.failRate != null ? Number(row.failRate) : null),
      reversalRate: round3(row.reversalRate != null ? Number(row.reversalRate) : null),
      mfe3Rate: round3(row.mfe3Rate != null ? Number(row.mfe3Rate) : null),
      mae3Rate: round3(row.mae3Rate != null ? Number(row.mae3Rate) : null),
      confidence: round3(confidence) ?? 0,
      tier,
      preferredWindow: query.window,
    });
  }

  const includeCohorts = query.includeCohorts !== false;
  let cohorts: CohortBreakdownRow[] = [];

  if (includeCohorts) {
  const cohortResult = await db.execute(sql`
    WITH base AS (
      SELECT
        signal_type,
        subject,
        direction,
        qualify_score,
        session_at_signal,
        regime_at_signal,
        created_at,
        ${sql.raw(moveCol)} AS move_raw,
        CASE
          WHEN direction = 'down' THEN -(${sql.raw(moveCol)})
          WHEN direction = 'up' THEN ${sql.raw(moveCol)}
          ELSE ABS(${sql.raw(moveCol)})
        END AS move_adj,
        NULLIF(context_json->'discovery_filters'->>'themePercentile','')::float8 AS theme_pct,
        context_json->'ma_structure'->>'maStack' AS ma_stack,
        NULLIF(context_json->'discovery_filters'->>'priorDayDollarVol','')::float8 AS prior_dv,
        outcome_contract_version
      FROM scanner_discoveries
      WHERE created_at >= ${fromTs}::timestamptz
        AND created_at <= ${toTs}::timestamptz
        AND direction IN ('up', 'down')
        AND (${session}::text IS NULL OR session_at_signal = ${session})
        AND (${subjectKind}::text IS NULL OR subject_kind = ${subjectKind})
        AND (
          ${trustFilter}::text = 'all'
          OR (${trustFilter}::text = 'trusted' AND outcome_contract_version = 'v3')
          OR (${trustFilter}::text = 'provisional' AND (outcome_contract_version IS NULL OR outcome_contract_version <> 'v3'))
        )
        AND ${themeRankSqlPredicate(themeRankCut, themeRankN)}
    ),
    episodes AS (
      SELECT DISTINCT ON (signal_type, subject, (created_at AT TIME ZONE 'America/New_York')::date)
        *
      FROM base
      ORDER BY signal_type, subject, (created_at AT TIME ZONE 'America/New_York')::date, created_at ASC
    ),
    labeled AS (
      SELECT
        signal_type,
        move_raw,
        move_adj,
        COALESCE(session_at_signal, 'unknown') AS session_bucket,
        CASE
          WHEN qualify_score < 40 THEN '<40'
          WHEN qualify_score < 60 THEN '40-59'
          WHEN qualify_score < 75 THEN '60-74'
          ELSE '75+'
        END AS score_bucket,
        CASE
          WHEN theme_pct IS NULL THEN 'unknown'
          WHEN (direction = 'up' AND theme_pct >= 67) OR (direction = 'down' AND theme_pct <= 33) THEN 'aligned'
          WHEN (direction = 'up' AND theme_pct <= 33) OR (direction = 'down' AND theme_pct >= 67) THEN 'opposed'
          ELSE 'middle'
        END AS theme_bucket,
        CASE
          WHEN ma_stack IS NULL THEN 'unknown'
          WHEN (direction = 'up' AND ma_stack = 'bullish') OR (direction = 'down' AND ma_stack = 'bearish') THEN 'aligned'
          WHEN (direction = 'up' AND ma_stack = 'bearish') OR (direction = 'down' AND ma_stack = 'bullish') THEN 'opposed'
          ELSE 'mixed'
        END AS ma_bucket,
        COALESCE(regime_at_signal, 'unknown') AS regime_bucket,
        CASE
          WHEN prior_dv IS NULL THEN 'unknown'
          WHEN prior_dv >= 100000000 THEN 'high'
          WHEN prior_dv >= 10000000 THEN 'mid'
          ELSE 'low'
        END AS liq_bucket
      FROM episodes
    ),
    unpivoted AS (
      SELECT signal_type, 'session' AS dimension, session_bucket AS bucket, move_raw, move_adj FROM labeled
      UNION ALL
      SELECT signal_type, 'score', score_bucket, move_raw, move_adj FROM labeled
      UNION ALL
      SELECT signal_type, 'theme', theme_bucket, move_raw, move_adj FROM labeled
      UNION ALL
      SELECT signal_type, 'ma', ma_bucket, move_raw, move_adj FROM labeled
      UNION ALL
      SELECT signal_type, 'regime', regime_bucket, move_raw, move_adj FROM labeled
      UNION ALL
      SELECT signal_type, 'liquidity', liq_bucket, move_raw, move_adj FROM labeled
    )
    SELECT
      signal_type AS "signalType",
      dimension,
      bucket,
      COUNT(*)::int AS episodes,
      COUNT(move_raw)::int AS tracked,
      ROUND(AVG(CASE WHEN move_adj >= ${query.hitThreshold} THEN 1 ELSE 0 END) FILTER (WHERE move_raw IS NOT NULL)::numeric, 4) AS "hitRate",
      ROUND(AVG(move_adj) FILTER (WHERE move_raw IS NOT NULL)::numeric, 4) AS "avgMove"
    FROM unpivoted
    GROUP BY signal_type, dimension, bucket
    HAVING COUNT(move_raw) >= ${Math.max(8, Math.floor(query.minEpisodes / 2))}
    ORDER BY signal_type, dimension, COUNT(*) DESC
  `);

  const cohortRows = ((cohortResult as any).rows ?? cohortResult) as any[];
  cohorts = cohortRows.map((r) => {
    const tracked = Number(r.tracked ?? 0);
    const hitRate = r.hitRate != null ? Number(r.hitRate) : null;
    const avgMove = r.avgMove != null ? Number(r.avgMove) : null;
    const confidence = sampleConfidence(tracked);
    return {
      signalType: r.signalType,
      dimension: r.dimension,
      bucket: r.bucket,
      episodes: Number(r.episodes ?? 0),
      tracked,
      hitRate: round3(hitRate),
      avgMove: round3(avgMove),
      confidence: round3(confidence) ?? 0,
      tier: classifyEvidenceTier({
        episodes: tracked,
        hitRate,
        edgePct: avgMove,
        confidence,
      }),
    };
  });
  }

  for (const s of signalTypes) {
    if (s.totalFired > 1000 && s.episodes > 0 && s.totalFired / s.episodes > 8) {
      warnings.push(
        `${s.signalType}: high repeat fire rate (${(s.totalFired / s.episodes).toFixed(1)}x per episode) — episode dedupe is required for ranking.`
      );
    }
    if (s.coverage < 0.5 && s.episodes >= query.minEpisodes) {
      warnings.push(`${s.signalType}: only ${Math.round(s.coverage * 100)}% episode coverage at ${query.window}.`);
    }
  }

  const snapshot: EvidenceSnapshot = {
    signalTypes,
    cohorts,
    dateRange: { from: query.from, to: query.to },
    window: query.window,
    hitThreshold: query.hitThreshold,
    trustUsed,
    qualityWarnings: Array.from(new Set(warnings)).slice(0, 12),
    generatedAt: new Date().toISOString(),
  };

  cache.set(key, { at: Date.now(), value: snapshot });
  return snapshot;
}

/** Live feed lookup: best known evidence tier per signal type for current session. */
export async function getLiveEvidenceIndex(opts?: {
  session?: string;
  lookbackDays?: number;
}): Promise<
  Map<
    string,
    {
      tier: EvidenceTier;
      hitRate: number | null;
      episodes: number;
      trust: EvidenceTrust;
      window: OutcomeWindowKey;
    }
  >
> {
  const lookbackDays = opts?.lookbackDays ?? 21;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const snap = await getEvidenceSnapshot({
    from,
    to,
    window: "1hr",
    hitThreshold: 0.5,
    minEpisodes: 15,
    session: opts?.session,
    subjectKind: "ticker",
    trust: "auto",
  });
  const map = new Map<
    string,
    {
      tier: EvidenceTier;
      hitRate: number | null;
      episodes: number;
      trust: EvidenceTrust;
      window: OutcomeWindowKey;
    }
  >();
  for (const s of snap.signalTypes) {
    map.set(s.signalType, {
      tier: s.tier,
      hitRate: s.hitRateShrunk ?? s.hitRate,
      episodes: s.tracked,
      trust: s.trust,
      window: s.preferredWindow,
    });
  }
  return map;
}

export function clearEvidenceCache(): void {
  cache.clear();
}

export type SignalHoldoutReport = {
  signalType: string;
  window: OutcomeWindowKey;
  trust: EvidenceTrust | "mixed";
  summary: HoldoutSummary;
  costCheck: CostSensitivityResult;
  weeks: HoldoutWeek[];
  provisionalCandidate: boolean;
  readyForStrongRank: boolean;
};

/**
 * Chronological weekly holdout for a signal type, plus cost/liquidity sensitivity.
 * Uses episode dedupe. Does not rewrite data.
 */
export async function evaluateSignalHoldout(opts: {
  signalType: string;
  from: string;
  to: string;
  window?: OutcomeWindowKey;
  hitThreshold?: number;
  trust?: "auto" | "trusted" | "provisional" | "all";
  roundTripCostPct?: number;
  minLiquidity?: number;
}): Promise<SignalHoldoutReport | null> {
  if (!db) return null;

  const window = opts.window ?? "1hr";
  const hitThreshold = opts.hitThreshold ?? 0.5;
  const moveCol = WINDOW_MOVE_SQL[window] ?? "move_1hr";
  const fromTs = `${opts.from}T00:00:00Z`;
  const toTs = `${opts.to}T23:59:59Z`;

  const trustedCount = await countTrustedRows(opts.from, opts.to);
  let trustFilter = opts.trust ?? "auto";
  let trustUsed: EvidenceTrust | "mixed" = "provisional";
  if (trustFilter === "auto") {
    trustFilter = trustedCount >= 50 ? "trusted" : "provisional";
    trustUsed = trustFilter;
  } else if (trustFilter === "trusted") trustUsed = "trusted";
  else if (trustFilter === "provisional") trustUsed = "provisional";
  else trustUsed = "mixed";

  const result = await db.execute(sql`
    WITH base AS (
      SELECT
        subject,
        direction,
        created_at,
        ${sql.raw(moveCol)} AS move_raw,
        CASE
          WHEN direction = 'down' THEN -(${sql.raw(moveCol)})
          WHEN direction = 'up' THEN ${sql.raw(moveCol)}
          ELSE ABS(${sql.raw(moveCol)})
        END AS move_adj,
        NULLIF(context_json->'discovery_filters'->>'priorDayDollarVol','')::float8 AS prior_dv
      FROM scanner_discoveries
      WHERE signal_type = ${opts.signalType}
        AND created_at >= ${fromTs}::timestamptz
        AND created_at <= ${toTs}::timestamptz
        AND direction IN ('up', 'down')
        AND subject_kind = 'ticker'
        AND (
          ${trustFilter}::text = 'all'
          OR (${trustFilter}::text = 'trusted' AND outcome_contract_version = 'v3')
          OR (${trustFilter}::text = 'provisional' AND (outcome_contract_version IS NULL OR outcome_contract_version <> 'v3'))
        )
    ),
    episodes AS (
      SELECT DISTINCT ON (subject, (created_at AT TIME ZONE 'America/New_York')::date)
        *
      FROM base
      ORDER BY subject, (created_at AT TIME ZONE 'America/New_York')::date, created_at ASC
    )
    SELECT
      to_char(date_trunc('week', created_at AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD') AS week,
      COUNT(*) FILTER (WHERE move_raw IS NOT NULL)::int AS episodes,
      COUNT(*) FILTER (WHERE move_raw IS NOT NULL AND move_adj >= ${hitThreshold})::int AS hits,
      COALESCE(SUM(move_adj) FILTER (WHERE move_raw IS NOT NULL), 0)::float8 AS "edgeSum",
      AVG(prior_dv) FILTER (WHERE prior_dv IS NOT NULL)::float8 AS "avgPriorDv"
    FROM episodes
    GROUP BY 1
    ORDER BY 1
  `);

  const rows = ((result as any).rows ?? result) as any[];
  const weeks: HoldoutWeek[] = rows
    .filter((r) => Number(r.episodes ?? 0) > 0)
    .map((r) => ({
      week: String(r.week),
      episodes: Number(r.episodes),
      hits: Number(r.hits),
      edgeSum: Number(r.edgeSum),
    }));

  const summary = summarizeHoldout(weeks);
  const avgPriorDv =
    rows.reduce((s, r) => s + (r.avgPriorDv != null ? Number(r.avgPriorDv) : 0), 0) /
    Math.max(1, rows.filter((r) => r.avgPriorDv != null).length);

  const costCheck = evaluateCostSensitivity({
    edgePct: summary.edgePct ?? 0,
    roundTripCostPct: opts.roundTripCostPct ?? 0.12,
    priorDayDollarVol: Number.isFinite(avgPriorDv) && avgPriorDv > 0 ? avgPriorDv : null,
    minLiquidity: opts.minLiquidity,
  });

  const provisionalCandidate = PROVISIONAL_CANDIDATE_COHORTS.some(
    (c) => c.signalType === opts.signalType
  );

  return {
    signalType: opts.signalType,
    window,
    trust: trustUsed,
    summary,
    costCheck,
    weeks,
    provisionalCandidate,
    readyForStrongRank:
      summary.stable && costCheck.passes && trustUsed === "trusted" && summary.tier === "strong",
  };
}
