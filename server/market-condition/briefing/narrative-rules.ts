import type {
  BriefingNarrative,
  BriefingStoryContext,
  StoryAtom,
  ThemeBriefingDossier,
} from "./types";
import { macroNewsByCategory } from "./macro-news";

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function atomsByCategory(atoms: StoryAtom[], category: StoryAtom["category"]): StoryAtom[] {
  return atoms.filter((a) => a.category === category);
}

function formatAtomBlock(atoms: StoryAtom[]): string {
  if (!atoms.length) return "No strong signal on this dimension.";
  return atoms
    .map((a) => {
      const conf = a.confidence.toUpperCase();
      const ev = a.evidence.length ? `\n  _Evidence: ${a.evidence.join("; ")}_` : "";
      return `**[${conf}]** ${a.headline}\n${a.detail}${ev}`;
    })
    .join("\n\n");
}

function formatMacroNewsSection(ctx: BriefingStoryContext): string {
  const byCat = macroNewsByCategory(ctx.macroNews);
  const lines: string[] = [];

  const labels: Record<string, string> = {
    presidential: "Presidential / policy",
    geopolitical: "World / geopolitical",
    economic: "Economic / Fed",
    defense: "Defense / military",
    general: "General market",
  };

  for (const [cat, label] of Object.entries(labels)) {
    const items = byCat[cat as keyof typeof byCat];
    if (!items?.length) continue;
    lines.push(`**${label}**`);
    for (const item of items.slice(0, 3)) {
      lines.push(`• ${item.headline} _(${item.source})_`);
    }
    lines.push("");
  }

  return lines.length ? lines.join("\n").trim() : "No categorized macro headlines available.";
}

function buildWatchListFromContext(
  dossier: ThemeBriefingDossier,
  ctx: BriefingStoryContext
) {
  const list: Array<{ themeId: string; themeName: string; reason: string }> = [];
  for (const t of dossier.leaders.slice(0, 3)) {
    list.push({
      themeId: t.id,
      themeName: t.name,
      reason: t.isNarrowLeadership
        ? `#${t.rank} leader — narrow; confirm breadth.`
        : `#${t.rank} leader — RS ${fmtPct(t.rsVsBenchmark)} vs SPY.`,
    });
  }
  for (const t of dossier.lateRotators.filter((x) => x.deltaRankLate >= 4).slice(0, 2)) {
    list.push({
      themeId: t.id,
      themeName: t.name,
      reason: `Late gainer Δ rank +${t.deltaRankLate}.`,
    });
  }
  if (ctx.marketDirection === "risk_off") {
    const haven = dossier.themes.find(
      (t) => t.id === "DEFENSE" || t.id === "PRECIOUS_METALS"
    );
    if (haven && !list.some((l) => l.themeId === haven.id)) {
      list.push({
        themeId: haven.id,
        themeName: haven.name,
        reason: `Haven theme in risk-off tape (#${haven.rank}).`,
      });
    }
  }
  return list.slice(0, 6);
}

/**
 * Rule-based narrative — correlates story atoms into readable sections.
 * Used as fallback when LLM synthesis is unavailable.
 */
export function buildRulesNarrative(
  dossier: ThemeBriefingDossier,
  ctx: BriefingStoryContext
): BriefingNarrative {
  const modeLabel = dossier.mode === "pre" ? "Pre-market" : "Post-market";
  const benchLine = dossier.benchmarks.map((b) => `${b.symbol} ${fmtPct(b.changePct)}`).join(" · ");

  const execParts = [
    `${modeLabel} briefing for ${dossier.referenceSession}. ${ctx.directionLabel}`,
    ctx.rotationSummary,
  ];
  if (dossier.leaders[0]) {
    execParts.push(
      `Theme leader: ${dossier.leaders[0].name} (#${dossier.leaders[0].rank}, ${fmtPct(dossier.leaders[0].medianPct)} median).`
    );
  }

  const sections: BriefingNarrative["sections"] = [];

  sections.push({
    id: "why_market",
    title: dossier.mode === "pre" ? "What moved overnight" : "Why the market moved",
    body: formatAtomBlock(atomsByCategory(ctx.atoms, "market_direction")),
  });

  sections.push({
    id: "why_rotation",
    title: dossier.mode === "pre" ? "Overnight theme rotation" : "Why this rotation",
    body: formatAtomBlock([
      ...atomsByCategory(ctx.atoms, "rotation_why"),
      ...atomsByCategory(ctx.atoms, "theme_pattern"),
    ]),
  });

  sections.push({
    id: "session_arc",
    title: dossier.mode === "pre" ? "Overnight arc vs prior close" : "Session arc (open → late → close)",
    body: formatAtomBlock(atomsByCategory(ctx.atoms, "session_arc")),
  });

  sections.push({
    id: "macro_context",
    title: "Macro & news context",
    body: [
      formatMacroNewsSection(ctx),
      "",
      "**Correlated headlines (rule-matched)**",
      formatAtomBlock(atomsByCategory(ctx.atoms, "macro_link")),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  sections.push({
    id: "leaders",
    title: "Theme leaders",
    body: dossier.leaders.length
      ? dossier.leaders
          .map(
            (t) =>
              `**${t.name}** (#${t.rank}) — score ${t.score.toFixed(1)}, RS ${fmtPct(t.rsVsBenchmark)}, breadth ${t.breadthPct.toFixed(0)}% green${
                t.isNarrowLeadership ? " · ⚠ narrow leadership" : ""
              }.`
          )
          .join("\n")
      : "No leader data available.",
  });

  sections.push({
    id: "laggards",
    title: "Theme laggards",
    body: dossier.laggards.length
      ? dossier.laggards
          .map(
            (t) =>
              `**${t.name}** (#${t.rank}) — median ${fmtPct(t.medianPct)}, RS ${fmtPct(t.rsVsBenchmark)}.`
          )
          .join("\n")
      : "No laggard data available.",
  });

  if (dossier.topMembers.length) {
    sections.push({
      id: "members",
      title: dossier.mode === "pre" ? "Notable overnight movers" : "Notable movers",
      body: dossier.topMembers
        .slice(0, 10)
        .map(
          (m) =>
            `${m.symbol} (${m.themeName}) ${fmtPct(m.pctChange)} · RS ${fmtPct(m.rsVsBenchmark)}${
              m.volExp !== undefined ? ` · volume ${m.volExp.toFixed(2)}x avg` : ""
            } · ${m.role}`
        )
        .join("\n"),
    });
  }

  // Scanner intelligence: catalyst watch section
  const catalystAtoms = atomsByCategory(ctx.atoms, "catalyst_watch");
  if (catalystAtoms.length) {
    sections.push({
      id: "catalyst_watch",
      title: "Catalyst watch — delayed reaction setups",
      body: formatAtomBlock(catalystAtoms),
    });
  }

  // Scanner intelligence: session structure patterns
  const patternAtoms = atomsByCategory(ctx.atoms, "session_pattern");
  if (patternAtoms.length) {
    sections.push({
      id: "session_structure",
      title: "Recent session structure",
      body: formatAtomBlock(patternAtoms),
    });
  }

  const cautionAtoms = atomsByCategory(ctx.atoms, "caution");
  if (cautionAtoms.length) {
    sections.push({
      id: "caution",
      title: "Caution flags",
      body: formatAtomBlock(cautionAtoms),
    });
  }

  const dq = dossier.dataQuality;
  sections.push({
    id: "data_quality",
    title: "Data limitations",
    body: [
      ...dq.warnings,
      `Intraday slots: ${dq.intradaySlots.available}/${dq.intradaySlots.expected}.`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  return {
    executiveSummary: execParts.join(" "),
    sections,
    watchList: buildWatchListFromContext(dossier, ctx),
    source: "template",
  };
}
