import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { themeSnapshots } from "@shared/schema";
import type { ClusterId } from "../universe";
import { THEME_BUCKETS, bucketForTheme } from "./theme-buckets";
import type { CategorizedNewsItem, MacroNewsCategory } from "./macro-news";
import { macroLinkConfidence } from "./macro-news";
import type {
  BriefingStoryContext,
  BriefingThemeRow,
  CatalystConfidence,
  MarketDirection,
  StoryAtom,
  ThemeBriefingDossier,
} from "./types";

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function avgRank(themes: BriefingThemeRow[], bucketIds: ClusterId[]): number | null {
  const inBucket = themes.filter((t) => bucketIds.includes(t.id));
  if (!inBucket.length) return null;
  return inBucket.reduce((s, t) => s + t.rank, 0) / inBucket.length;
}

function avgMedian(themes: BriefingThemeRow[], bucketIds: ClusterId[]): number | null {
  const inBucket = themes.filter((t) => bucketIds.includes(t.id));
  if (!inBucket.length) return null;
  return inBucket.reduce((s, t) => s + t.medianPct, 0) / inBucket.length;
}

function topThemesInBucket(
  themes: BriefingThemeRow[],
  bucketIds: ClusterId[],
  n = 3
): BriefingThemeRow[] {
  return themes.filter((t) => bucketIds.includes(t.id)).sort((a, b) => a.rank - b.rank).slice(0, n);
}

function bottomThemesInBucket(
  themes: BriefingThemeRow[],
  bucketIds: ClusterId[],
  n = 3
): BriefingThemeRow[] {
  return themes
    .filter((t) => bucketIds.includes(t.id))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, n);
}

export function classifyMarketDirection(dossier: ThemeBriefingDossier): {
  direction: MarketDirection;
  label: string;
  confidence: CatalystConfidence;
} {
  const spy = dossier.benchmarks.find((b) => b.symbol === "SPY")?.changePct ?? 0;
  const qqq = dossier.benchmarks.find((b) => b.symbol === "QQQ")?.changePct ?? 0;
  const iwm = dossier.benchmarks.find((b) => b.symbol === "IWM")?.changePct ?? 0;

  const avgBench = (spy + qqq + iwm) / 3;
  const spreadGrowth = qqq - spy;
  const spreadSmall = iwm - qqq;

  if (spy <= -0.8 && qqq <= -0.8 && iwm <= -0.5) {
    return {
      direction: "risk_off",
      label: `Broad sell-off — SPY ${fmtPct(spy)}, QQQ ${fmtPct(qqq)}, IWM ${fmtPct(iwm)}.`,
      confidence: "high",
    };
  }
  if (spy >= 0.5 && qqq >= 0.5 && avgBench >= 0.4) {
    return {
      direction: "risk_on",
      label: `Risk-on bid — major indices green (SPY ${fmtPct(spy)}, QQQ ${fmtPct(qqq)}).`,
      confidence: "high",
    };
  }
  if (qqq <= -0.5 && spy >= -0.2 && spreadSmall > 0.8) {
    return {
      direction: "mixed",
      label: `Growth lagging while small caps hold up — QQQ ${fmtPct(qqq)} vs IWM ${fmtPct(iwm)} (spread ${fmtPct(spreadSmall)}).`,
      confidence: "medium",
    };
  }
  if (qqq <= -0.5 && spy > qqq + 0.3) {
    return {
      direction: "choppy_sell",
      label: `Selective sell-off in growth — QQQ ${fmtPct(qqq)} underperforming SPY ${fmtPct(spy)}.`,
      confidence: "medium",
    };
  }
  if (spy < -0.25 || qqq < -0.25) {
    return {
      direction: "risk_off",
      label: `Mild risk-off tone — SPY ${fmtPct(spy)}, QQQ ${fmtPct(qqq)}.`,
      confidence: "medium",
    };
  }
  if (spy > 0.2 && qqq > 0.2) {
    return {
      direction: "risk_on",
      label: `Constructive session — indices firm (SPY ${fmtPct(spy)}, QQQ ${fmtPct(qqq)}).`,
      confidence: "medium",
    };
  }
  return {
    direction: "mixed",
    label: `Mixed index action — SPY ${fmtPct(spy)}, QQQ ${fmtPct(qqq)}, IWM ${fmtPct(iwm)}.`,
    confidence: "low",
  };
}

async function loadPriorRanks(
  priorSession: string | null
): Promise<Map<ClusterId, number> | null> {
  if (!priorSession) return null;
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select({ themeId: themeSnapshots.themeId, rank: themeSnapshots.rank })
    .from(themeSnapshots)
    .where(
      and(
        eq(themeSnapshots.snapshotType, "daily_close"),
        eq(themeSnapshots.marketDate, priorSession)
      )
    );
  if (!rows.length) return null;
  const map = new Map<ClusterId, number>();
  for (const r of rows) map.set(r.themeId as ClusterId, r.rank);
  return map;
}

function buildRotationAtoms(
  dossier: ThemeBriefingDossier,
  direction: MarketDirection
): StoryAtom[] {
  const atoms: StoryAtom[] = [];
  const themes = dossier.themes;
  const defAvg = avgRank(themes, THEME_BUCKETS.defensive);
  const growthAvg = avgRank(themes, THEME_BUCKETS.growth);
  const cyclicalAvg = avgRank(themes, THEME_BUCKETS.cyclical);
  const havenAvg = avgRank(themes, THEME_BUCKETS.risk_off_haven);
  const defMed = avgMedian(themes, THEME_BUCKETS.defensive);
  const growthMed = avgMedian(themes, THEME_BUCKETS.growth);

  const topDef = topThemesInBucket(themes, THEME_BUCKETS.defensive, 2);
  const botGrowth = bottomThemesInBucket(themes, THEME_BUCKETS.growth, 3);

  if (
    defAvg !== null &&
    growthAvg !== null &&
    defAvg <= 8 &&
    growthAvg >= 18 &&
    (direction === "risk_off" || direction === "choppy_sell" || direction === "mixed")
  ) {
    atoms.push({
      id: "defensive_rotation",
      category: "rotation_why",
      headline: "Defensive rotation — staples/healthcare leading, growth complexes lagging.",
      detail: `Defensive bucket avg rank #${defAvg.toFixed(0)} vs growth avg #${growthAvg.toFixed(0)}. Leaders include ${topDef.map((t) => t.name).join(", ") || "n/a"}.`,
      confidence: defMed !== null && growthMed !== null && defMed > growthMed + 0.5 ? "high" : "medium",
      evidence: [
        `Defensive median ${defMed !== null ? fmtPct(defMed) : "n/a"}`,
        `Growth median ${growthMed !== null ? fmtPct(growthMed) : "n/a"}`,
        dossier.leaders[0] ? `Session leader: ${dossier.leaders[0].name} (#${dossier.leaders[0].rank})` : "",
      ].filter(Boolean),
    });
  }

  if (havenAvg !== null && havenAvg <= 10 && direction === "risk_off") {
    const haven = topThemesInBucket(themes, THEME_BUCKETS.risk_off_haven, 2);
    atoms.push({
      id: "haven_bid",
      category: "rotation_why",
      headline: "Haven bid — defense and precious metals themes firm in a risk-off tape.",
      detail: `${haven.map((t) => `${t.name} (#${t.rank})`).join(", ")}.`,
      confidence: "medium",
      evidence: haven.map((t) => `${t.name} RS ${fmtPct(t.rsVsBenchmark)} vs SPY`),
    });
  }

  if (growthAvg !== null && growthAvg <= 10 && direction === "risk_on") {
    atoms.push({
      id: "growth_leadership",
      category: "rotation_why",
      headline: "Growth leadership — semis/AI/software complexes leading the session.",
      detail: `Growth bucket avg rank #${growthAvg.toFixed(0)}.`,
      confidence: "medium",
      evidence: topThemesInBucket(themes, THEME_BUCKETS.growth, 3).map(
        (t) => `${t.name} #${t.rank}, median ${fmtPct(t.medianPct)}`
      ),
    });
  }

  if (cyclicalAvg !== null && cyclicalAvg <= 10 && defAvg !== null && defAvg > cyclicalAvg + 8) {
    atoms.push({
      id: "cyclical_lead",
      category: "rotation_why",
      headline: "Cyclicals outperforming defensives — reflation / recovery tone.",
      detail: `Cyclical avg rank #${cyclicalAvg.toFixed(0)} vs defensive #${defAvg.toFixed(0)}.`,
      confidence: "medium",
      evidence: topThemesInBucket(themes, THEME_BUCKETS.cyclical, 2).map((t) => t.name),
    });
  }

  const narrowLeaders = dossier.leaders.filter((t) => t.isNarrowLeadership);
  if (narrowLeaders.length) {
    atoms.push({
      id: "narrow_leadership",
      category: "caution",
      headline: `${narrowLeaders[0].name} leadership may be narrow — confirm breadth before leaning in.`,
      detail: "Top names driving a disproportionate share of theme performance.",
      confidence: "medium",
      evidence: narrowLeaders.map((t) => `${t.name} breadth ${t.breadthPct.toFixed(0)}% green`),
    });
  }

  const broadLeader = dossier.leaders.find((t) => t.breadthPct >= 75);
  if (broadLeader && broadLeader.rank <= 3) {
    atoms.push({
      id: "broad_leadership",
      category: "theme_pattern",
      headline: `${broadLeader.name} showing broad participation (${broadLeader.breadthPct.toFixed(0)}% green).`,
      detail: "Leadership is theme-wide, not a single-name squeeze.",
      confidence: "high",
      evidence: [
        `#${broadLeader.rank} rank`,
        `median ${fmtPct(broadLeader.medianPct)}`,
        `RS ${fmtPct(broadLeader.rsVsBenchmark)}`,
      ],
    });
  }

  if (botGrowth.length && direction !== "risk_on") {
    atoms.push({
      id: "growth_laggards",
      category: "rotation_why",
      headline: `Growth unwind — ${botGrowth.map((t) => t.name).join(", ")} in bottom tier.`,
      detail: "Tech/growth complexes underperforming on a relative basis.",
      confidence: "medium",
      evidence: botGrowth.map((t) => `${t.name} #${t.rank}, RS ${fmtPct(t.rsVsBenchmark)}`),
    });
  }

  const char = dossier.rotationCharacter.replace(/_/g, " ");
  atoms.push({
    id: "index_character",
    category: "market_direction",
    headline: `Index character: ${char}.`,
    detail: dossier.benchmarks.map((b) => `${b.symbol} ${fmtPct(b.changePct)}`).join(" · "),
    confidence: "high",
    evidence: [char],
  });

  return atoms;
}

function buildSessionArcAtoms(dossier: ThemeBriefingDossier): StoryAtom[] {
  const atoms: StoryAtom[] = [];
  const lateUp = dossier.lateRotators.filter((t) => t.deltaRankLate >= 4).slice(0, 3);
  const lateDown = dossier.lateRotators.filter((t) => t.deltaRankLate <= -4).slice(0, 3);
  const openUp = dossier.openRotators.filter((t) => t.deltaRankFromOpen >= 4).slice(0, 3);
  const openDown = dossier.openRotators.filter((t) => t.deltaRankFromOpen <= -4).slice(0, 3);

  if (dossier.mode === "pre") {
    if (openUp.length) {
      atoms.push({
        id: "overnight_rank_gain",
        category: "session_arc",
        headline: `Re-ranked higher overnight: ${openUp.map((t) => t.name).join(", ")}.`,
        detail: "Live pre-market ranks versus the prior RTH close.",
        confidence: dossier.dataQuality.extendedQuotesAvailable ? "high" : "low",
        evidence: openUp.map((t) => `${t.name} overnight Δ rank +${t.deltaRankFromOpen}`),
      });
    }
    if (openDown.length) {
      atoms.push({
        id: "overnight_rank_loss",
        category: "session_arc",
        headline: `Lost ground overnight: ${openDown.map((t) => t.name).join(", ")}.`,
        detail: "Live pre-market ranks versus the prior RTH close.",
        confidence: dossier.dataQuality.extendedQuotesAvailable ? "high" : "low",
        evidence: openDown.map((t) => `${t.name} overnight Δ rank ${t.deltaRankFromOpen}`),
      });
    }
    return atoms;
  }

  if (lateUp.length) {
    atoms.push({
      id: "late_rally",
      category: "session_arc",
      headline: `Late-session bid into the close: ${lateUp.map((t) => t.name).join(", ")}.`,
      detail: "Themes that improved rank from ~3:45 PM ET baseline to close.",
      confidence: dossier.dataQuality.lateBaselineAvailable ? "high" : "low",
      evidence: lateUp.map((t) => `${t.name} Δ rank +${t.deltaRankLate}`),
    });
  }
  if (lateDown.length) {
    atoms.push({
      id: "late_fade",
      category: "session_arc",
      headline: `Late fade into the close: ${lateDown.map((t) => t.name).join(", ")}.`,
      detail: "Themes that lost ground in the final hour.",
      confidence: dossier.dataQuality.lateBaselineAvailable ? "high" : "low",
      evidence: lateDown.map((t) => `${t.name} Δ rank ${t.deltaRankLate}`),
    });
  }
  if (openUp.length && !lateUp.some((u) => openDown.some((d) => d.id === u.id))) {
    atoms.push({
      id: "open_strength",
      category: "session_arc",
      headline: `Sustained from the open: ${openUp.map((t) => t.name).join(", ")}.`,
      detail: "Themes that improved rank from 9:30 ET open baseline through the close.",
      confidence: dossier.dataQuality.openBaselineAvailable ? "high" : "medium",
      evidence: openUp.map((t) => `${t.name} Δ rank +${t.deltaRankFromOpen}`),
    });
  }
  if (openDown.length && lateDown.length) {
    const overlap = openDown.filter((o) => lateDown.some((l) => l.id === o.id));
    if (overlap.length) {
      atoms.push({
        id: "all_day_weakness",
        category: "session_arc",
        headline: `All-day weakness: ${overlap.map((t) => t.name).join(", ")}.`,
        detail: "Themes weak from open through the close — not just a late fade.",
        confidence: "medium",
        evidence: overlap.map((t) => `${t.name} open Δ ${t.deltaRankFromOpen}, late Δ ${t.deltaRankLate}`),
      });
    }
  }

  return atoms;
}

function buildMacroLinkAtoms(
  direction: MarketDirection,
  macroNews: CategorizedNewsItem[]
): StoryAtom[] {
  const atoms: StoryAtom[] = [];
  const byCat = new Map<MacroNewsCategory, CategorizedNewsItem[]>();
  for (const item of macroNews) {
    const list = byCat.get(item.category) || [];
    list.push(item);
    byCat.set(item.category, list);
  }

  const linkCategories: MacroNewsCategory[] = [
    "geopolitical",
    "presidential",
    "economic",
    "defense",
  ];

  for (const cat of linkCategories) {
    const items = byCat.get(cat);
    if (!items?.length) continue;
    const top = items[0];
    const conf = macroLinkConfidence(direction, cat);
    if (conf === "low" && direction === "mixed") continue;

    atoms.push({
      id: `macro_${cat}`,
      category: "macro_link",
      headline: `[${cat}] ${top.headline}`,
      detail: top.summary.slice(0, 200) || "Headline-only context from market news feed.",
      confidence: conf,
      evidence: [`Source: ${top.source}`, `Category: ${cat}`],
    });
  }

  return atoms.slice(0, 6);
}

async function buildPersistenceAtoms(
  dossier: ThemeBriefingDossier
): Promise<StoryAtom[]> {
  const prior = await loadPriorRanks(dossier.priorSession);
  if (!prior) return [];

  const atoms: StoryAtom[] = [];
  for (const t of dossier.leaders.slice(0, 3)) {
    const priorRank = prior.get(t.id);
    if (priorRank === undefined) continue;
    const delta = priorRank - t.rank;
    if (delta >= 3) {
      atoms.push({
        id: `persist_${t.id}`,
        category: "theme_pattern",
        headline: `${t.name} improving — up ${delta} ranks vs prior session (#${priorRank} → #${t.rank}).`,
        detail: `Multi-session momentum into ${dossier.referenceSession}.`,
        confidence: "medium",
        evidence: [`Prior session: ${dossier.priorSession}`],
      });
    }
  }
  return atoms;
}

export async function buildStoryContext(
  dossier: ThemeBriefingDossier,
  macroNews: CategorizedNewsItem[]
): Promise<BriefingStoryContext> {
  const { direction, label, confidence } = classifyMarketDirection(dossier);

  const rotationAtoms = buildRotationAtoms(dossier, direction);
  const sessionAtoms = buildSessionArcAtoms(dossier);
  const macroAtoms = buildMacroLinkAtoms(direction, macroNews);
  const persistenceAtoms = await buildPersistenceAtoms(dossier);

  // Scanner intelligence: load active catalysts and session patterns
  let catalystAtoms: StoryAtom[] = [];
  let sessionPatternAtoms: StoryAtom[] = [];
  let activeCatalysts: import("@shared/catalyst-types").CatalystEntry[] = [];
  let sessionPatterns: import("@shared/catalyst-types").SessionPattern[] = [];

  try {
    const catalystModule = await import("../../scanner/catalyst");
    await catalystModule.ensureSynced();
    activeCatalysts = catalystModule.getAllActiveCatalysts();

    if (activeCatalysts.length > 0) {
      const topCatalysts = activeCatalysts
        .sort((a, b) => b.decayWeight - a.decayWeight)
        .slice(0, 5);

      for (const cat of topCatalysts) {
        catalystAtoms.push({
          id: `catalyst_${cat.id}`,
          category: "catalyst_watch",
          headline: `[Catalyst] ${cat.subject} — ${cat.catalystType.replace(/_/g, " ")}: ${cat.headline.slice(0, 80)}`,
          detail:
            `Fired ${new Date(cat.firedAt).toLocaleDateString()}, ` +
            `decay weight ${cat.decayWeight.toFixed(2)}, ` +
            `initial reaction: ${cat.initialReaction}, ` +
            `expected: ${cat.expectedDirection}.`,
          confidence: cat.decayWeight >= 0.7 ? "high" : cat.decayWeight >= 0.4 ? "medium" : "low",
          evidence: [
            `Type: ${cat.catalystType}`,
            `Source: ${cat.source}`,
            `Expires: ${new Date(cat.expiresAt).toLocaleDateString()}`,
          ],
        });
      }
    }
  } catch {
    // Scanner not initialized yet — skip catalyst injection
  }

  try {
    const { detectSessionPatterns } = await import("../../scanner/session-patterns");
    sessionPatterns = await detectSessionPatterns(10);

    for (const pat of sessionPatterns) {
      sessionPatternAtoms.push({
        id: `session_pattern_${pat.pattern}`,
        category: "session_pattern",
        headline: pat.description,
        detail:
          `Pattern frequency: ${(pat.frequency * 100).toFixed(0)}% ` +
          `(${pat.occurrences}/${pat.totalDays} days). ` +
          `Last seen: ${pat.lastOccurrence}.`,
        confidence: pat.confidence,
        evidence: [
          `Pattern: ${pat.pattern}`,
          pat.avgMagnitude ? `Avg magnitude: ${pat.avgMagnitude.toFixed(2)}%` : "",
        ].filter(Boolean),
      });
    }
  } catch {
    // Session patterns not available yet — skip
  }

  const rotationWhy = rotationAtoms
    .filter((a) => a.category === "rotation_why" || a.category === "theme_pattern")
    .map((a) => a.headline)
    .join(" ");

  const atoms: StoryAtom[] = [
    {
      id: "market_direction",
      category: "market_direction",
      headline: label,
      detail:
        direction === "risk_off"
          ? "Tape favors capital preservation — watch defensive/haven themes and avoid chasing laggards catching a falling knife."
          : direction === "risk_on"
            ? "Tape supports risk-taking — leadership themes with broad breadth deserve focus."
            : "No clean one-way read — rotation matters more than index direction.",
      confidence,
      evidence: dossier.benchmarks.map((b) => `${b.symbol} ${fmtPct(b.changePct)}`),
    },
    ...rotationAtoms,
    ...sessionAtoms,
    ...persistenceAtoms,
    ...macroAtoms,
    ...catalystAtoms,
    ...sessionPatternAtoms,
  ];

  for (const t of dossier.leaders.slice(0, 3)) {
    const buckets = bucketForTheme(t.id);
    if (buckets.length && !atoms.some((a) => a.id === `leader_${t.id}`)) {
      atoms.push({
        id: `leader_${t.id}`,
        category: "theme_pattern",
        headline: `${t.name} leads (#${t.rank}) — ${buckets.join("/")} bucket.`,
        detail: `Score ${t.score.toFixed(1)}, breadth ${t.breadthPct.toFixed(0)}%, RS ${fmtPct(t.rsVsBenchmark)}.`,
        confidence: t.breadthPct >= 60 ? "medium" : "low",
        evidence: [t.trendState !== "Transition" ? `Trend: ${t.trendState}` : ""].filter(Boolean),
      });
    }
  }

  return {
    marketDirection: direction,
    directionLabel: label,
    rotationSummary: rotationWhy || "Rotation drivers unclear from theme spread alone — see macro context.",
    atoms,
    macroNews,
    activeCatalysts: activeCatalysts.length > 0 ? activeCatalysts : undefined,
    sessionPatterns: sessionPatterns.length > 0 ? sessionPatterns : undefined,
  };
}
