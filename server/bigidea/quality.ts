import { INDICATOR_LIBRARY } from "./indicators";

export interface QualityDimension {
  name: string;
  score: number;
  maxScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  details: string[];
  suggestions: string[];
}

export interface ScanQualityResult {
  overallScore: number;
  maxScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  dimensions: QualityDimension[];
}

type IdeaNode = {
  id: string;
  type: string;
  thoughtId?: number;
  thoughtName?: string;
  thoughtCategory?: string;
  thoughtCriteria?: Array<{
    indicatorId: string;
    label?: string;
    muted?: boolean;
    inverted?: boolean;
    params?: Array<{ name: string; value: any; autoLinked?: boolean }>;
  }>;
  isNot?: boolean;
  passCount?: number;
};

type IdeaEdge = {
  id: string;
  source: string;
  target: string;
  logicType: string;
};

function letterGrade(pct: number): "A" | "B" | "C" | "D" | "F" {
  if (pct >= 90) return "A";
  if (pct >= 75) return "B";
  if (pct >= 60) return "C";
  if (pct >= 40) return "D";
  return "F";
}

const ALL_CATEGORIES = new Set(["Moving Averages", "Volume", "Price Action", "Relative Strength", "Volatility"]);

function scoreDiversity(nodes: IdeaNode[]): QualityDimension {
  const maxScore = 25;
  const details: string[] = [];
  const suggestions: string[] = [];

  const thoughtNodes = nodes.filter((n) => n.type === "thought");
  const allCriteria = thoughtNodes.flatMap((n) => (n.thoughtCriteria || []).filter((c) => !c.muted));
  const usedCategories = new Set<string>();
  const usedIndicators = new Set<string>();

  for (const c of allCriteria) {
    usedIndicators.add(c.indicatorId);
    const ind = INDICATOR_LIBRARY.find((i) => i.id === c.indicatorId);
    if (ind) usedCategories.add(ind.category);
  }

  details.push(`${usedCategories.size}/5 categories used: ${Array.from(usedCategories).join(", ")}`);
  details.push(`${usedIndicators.size} unique indicators across ${allCriteria.length} criteria`);

  let score = 0;

  const catPct = usedCategories.size / 5;
  score += Math.round(catPct * 12);

  const indicatorVariety = Math.min(usedIndicators.size / 4, 1);
  score += Math.round(indicatorVariety * 8);

  if (allCriteria.length >= 3) score += 5;
  else if (allCriteria.length >= 2) score += 3;
  else score += 1;

  score = Math.min(score, maxScore);

  const missing = Array.from(ALL_CATEGORIES).filter((c) => !usedCategories.has(c));
  if (missing.length > 0) {
    suggestions.push(`Add ${missing.join(", ")} criteria for broader coverage`);
  }
  if (usedIndicators.size < 3) {
    suggestions.push("Use at least 3 different indicators to avoid single-signal dependency");
  }

  return { name: "Criteria Diversity", score, maxScore, grade: letterGrade((score / maxScore) * 100), details, suggestions };
}

function scoreFunnel(nodes: IdeaNode[], edges: IdeaEdge[]): QualityDimension {
  const maxScore = 20;
  const details: string[] = [];
  const suggestions: string[] = [];

  const thoughtNodes = nodes.filter((n) => n.type === "thought");
  const thoughtCount = thoughtNodes.length;

  details.push(`${thoughtCount} thought${thoughtCount !== 1 ? "s" : ""} in pipeline`);

  let score = 0;

  if (thoughtCount >= 3) score += 10;
  else if (thoughtCount >= 2) score += 7;
  else score += 3;

  const andEdges = edges.filter((e) => e.logicType === "AND").length;
  const orEdges = edges.filter((e) => e.logicType === "OR").length;
  details.push(`${andEdges} AND + ${orEdges} OR connections`);

  if (andEdges >= 2) score += 5;
  else if (andEdges >= 1) score += 3;

  const hasPassCounts = thoughtNodes.some((n) => n.passCount !== undefined && n.passCount !== null);
  if (hasPassCounts) {
    const counts = thoughtNodes
      .filter((n) => n.passCount !== undefined && n.passCount !== null)
      .map((n) => n.passCount!);
    if (counts.length >= 2) {
      const sorted = [...counts].sort((a, b) => b - a);
      const isNarrowing = sorted[0] > sorted[sorted.length - 1];
      if (isNarrowing) {
        score += 5;
        details.push(`Funnel narrows: ${sorted.join(" → ")}`);
      } else {
        details.push(`Pass counts: ${counts.join(", ")} — consider reordering for progressive filtering`);
        suggestions.push("Place broader filters first and narrower ones later for efficient scanning");
      }
    }
  } else {
    details.push("Run a scan to see funnel narrowing effectiveness");
  }

  score = Math.min(score, maxScore);

  if (thoughtCount < 2) {
    suggestions.push("Split criteria into multiple thoughts for better progressive filtering");
  }
  if (andEdges === 0 && thoughtCount > 1) {
    suggestions.push("Connect thoughts with AND logic for stricter filtering");
  }

  return { name: "Filter Funnel", score, maxScore, grade: letterGrade((score / maxScore) * 100), details, suggestions };
}

function scoreDataLinks(nodes: IdeaNode[], edges: IdeaEdge[]): QualityDimension {
  const maxScore = 20;
  const details: string[] = [];
  const suggestions: string[] = [];

  const thoughtNodes = nodes.filter((n) => n.type === "thought");
  const allCriteria = thoughtNodes.flatMap((n) => (n.thoughtCriteria || []).filter((c) => !c.muted));

  const providerIds = new Set<string>();
  const consumerIds = new Set<string>();

  for (const c of allCriteria) {
    const ind = INDICATOR_LIBRARY.find((i) => i.id === c.indicatorId);
    if (!ind) continue;
    if (ind.provides && ind.provides.length > 0) providerIds.add(c.indicatorId);
    if (ind.consumes && ind.consumes.length > 0) consumerIds.add(c.indicatorId);
  }

  const hasProviders = providerIds.size > 0;
  const hasConsumers = consumerIds.size > 0;
  const hasActiveLinks = hasProviders && hasConsumers;

  let score = 0;

  if (hasActiveLinks) {
    score += 14;
    details.push(`Provider(s): ${Array.from(providerIds).join(", ")} → Consumer(s): ${Array.from(consumerIds).join(", ")}`);

    const autoLinked = allCriteria.some((c) =>
      c.params?.some((p) => p.autoLinked === true)
    );
    if (autoLinked) {
      score += 6;
      details.push("Auto-linked params active — consumers adapt per-stock");
    } else {
      score += 2;
      details.push("Providers and consumers present but no auto-linking detected");
      suggestions.push("Enable auto-link on consumer params to use per-stock detected values");
    }
  } else if (hasProviders && !hasConsumers) {
    score += 4;
    details.push(`Provider(s) present (${Array.from(providerIds).join(", ")}) but no consumers connected`);
    suggestions.push("Add consumer indicators (PA-12 through PA-16) in a downstream thought to use detected base data");
  } else if (!hasProviders && hasConsumers) {
    score += 2;
    details.push(`Consumer(s) present (${Array.from(consumerIds).join(", ")}) but no upstream provider`);
    suggestions.push("Add a provider indicator (PA-3 or PA-7) in an upstream thought to supply base period data");
  } else {
    details.push("No data-linking indicators used");
    suggestions.push("Consider using PA-3 (Base Detection) with downstream consumers like PA-14 (Tightness), PA-16 (Volume Fade) for context-aware scanning");
  }

  const providerConsumerSameThought = thoughtNodes.some((n) => {
    const criteria = (n.thoughtCriteria || []).filter((c) => !c.muted);
    const hasP = criteria.some((c) => {
      const ind = INDICATOR_LIBRARY.find((i) => i.id === c.indicatorId);
      return ind?.provides && ind.provides.length > 0;
    });
    const hasC = criteria.some((c) => {
      const ind = INDICATOR_LIBRARY.find((i) => i.id === c.indicatorId);
      return ind?.consumes && ind.consumes.length > 0;
    });
    return hasP && hasC;
  });

  if (providerConsumerSameThought) {
    score = Math.max(score - 5, 0);
    details.push("WARNING: Provider and consumer in same thought — data-linking won't work");
    suggestions.push("Move consumer indicators to a separate downstream thought connected by an edge");
  }

  score = Math.min(score, maxScore);
  return { name: "Data Linking", score, maxScore, grade: letterGrade((score / maxScore) * 100), details, suggestions };
}

function scoreParams(nodes: IdeaNode[]): QualityDimension {
  const maxScore = 15;
  const details: string[] = [];
  const suggestions: string[] = [];

  const thoughtNodes = nodes.filter((n) => n.type === "thought");
  const allCriteria = thoughtNodes.flatMap((n) => (n.thoughtCriteria || []).filter((c) => !c.muted));

  let score = maxScore;
  let issueCount = 0;

  for (const c of allCriteria) {
    const ind = INDICATOR_LIBRARY.find((i) => i.id === c.indicatorId);
    if (!ind || !c.params) continue;

    for (const p of c.params) {
      const meta = ind.params.find((mp) => mp.name === p.name);
      if (!meta) continue;

      if (meta.type === "number" && typeof p.value === "number") {
        if (meta.min !== undefined && p.value < meta.min) {
          score -= 2;
          issueCount++;
          details.push(`${c.label || ind.name}: ${meta.label} = ${p.value} is below minimum ${meta.min}`);
        }
        if (meta.max !== undefined && p.value > meta.max) {
          score -= 2;
          issueCount++;
          details.push(`${c.label || ind.name}: ${meta.label} = ${p.value} exceeds maximum ${meta.max}`);
        }
      }
    }
  }

  if (issueCount === 0) {
    details.push("All parameters within valid ranges");
  } else {
    suggestions.push("Adjust out-of-range parameters to improve scan reliability");
  }

  const mutedCount = thoughtNodes
    .flatMap((n) => n.thoughtCriteria || [])
    .filter((c) => c.muted).length;
  if (mutedCount > 0) {
    details.push(`${mutedCount} criterion/criteria muted`);
    if (mutedCount > allCriteria.length) {
      score -= 3;
      suggestions.push("More criteria are muted than active — consider removing unused criteria");
    }
  }

  const invertedCount = allCriteria.filter((c) => c.inverted).length;
  if (invertedCount > 0) {
    details.push(`${invertedCount} inverted criterion/criteria (screening for absence)`);
  }

  score = Math.max(Math.min(score, maxScore), 0);
  return { name: "Parameter Quality", score, maxScore, grade: letterGrade((score / maxScore) * 100), details, suggestions };
}

function scoreCoverage(nodes: IdeaNode[]): QualityDimension {
  const maxScore = 20;
  const details: string[] = [];
  const suggestions: string[] = [];

  const thoughtNodes = nodes.filter((n) => n.type === "thought");
  const allCriteria = thoughtNodes.flatMap((n) => (n.thoughtCriteria || []).filter((c) => !c.muted));

  const hasTrend = allCriteria.some((c) => c.indicatorId.startsWith("MA-"));
  const hasVolume = allCriteria.some((c) => c.indicatorId.startsWith("VOL-") || c.indicatorId === "PA-16");
  const hasPriceAction = allCriteria.some((c) => c.indicatorId.startsWith("PA-"));
  const hasRS = allCriteria.some((c) => c.indicatorId.startsWith("RS-"));
  const hasVolatility = allCriteria.some((c) => c.indicatorId.startsWith("VX-"));

  const pillars: { name: string; present: boolean; hint: string }[] = [
    { name: "Trend", present: hasTrend, hint: "Add a moving average filter (MA-1: Price vs SMA, MA-8: MA Cross)" },
    { name: "Volume", present: hasVolume, hint: "Add volume confirmation (VOL-1: Volume Surge, PA-16: Volume Fade)" },
    { name: "Price Action", present: hasPriceAction, hint: "Add structure analysis (PA-3: Base Detection, PA-7: Breakout)" },
    { name: "Relative Strength", present: hasRS, hint: "Add RS-1 or RS-2 to filter for market leaders" },
  ];

  let pillarsHit = 0;
  for (const p of pillars) {
    if (p.present) {
      pillarsHit++;
      details.push(`${p.name}: covered`);
    } else {
      suggestions.push(`${p.name}: ${p.hint}`);
    }
  }

  let score = 0;
  score += Math.round((pillarsHit / 4) * 14);

  if (allCriteria.length >= 4) score += 6;
  else if (allCriteria.length >= 3) score += 4;
  else if (allCriteria.length >= 2) score += 2;

  details.push(`${pillarsHit}/4 key pillars covered with ${allCriteria.length} active criteria`);

  if (hasVolatility) {
    details.push("Volatility filter included — bonus coverage");
  }

  score = Math.min(score, maxScore);
  return { name: "Signal Coverage", score, maxScore, grade: letterGrade((score / maxScore) * 100), details, suggestions };
}

export function evaluateScanQuality(nodes: IdeaNode[], edges: IdeaEdge[]): ScanQualityResult {
  const dimensions = [
    scoreDiversity(nodes),
    scoreFunnel(nodes, edges),
    scoreDataLinks(nodes, edges),
    scoreParams(nodes),
    scoreCoverage(nodes),
  ];

  const overallScore = dimensions.reduce((sum, d) => sum + d.score, 0);
  const maxScore = dimensions.reduce((sum, d) => sum + d.maxScore, 0);
  const grade = letterGrade((overallScore / maxScore) * 100);

  return { overallScore, maxScore, grade, dimensions };
}
