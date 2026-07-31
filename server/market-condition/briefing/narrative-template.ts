import type { ThemeBriefingDossier, BriefingNarrative, BriefingThemeRow } from "./types";
import { themeReviewSessionLabel } from "./naming";

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatThemeList(themes: BriefingThemeRow[], max = 5): string {
  return themes
    .slice(0, max)
    .map((t) => `${t.name} (#${t.rank}, ${fmtPct(t.medianPct)} median)`)
    .join("; ");
}

function formatBenchmarkLine(dossier: ThemeBriefingDossier): string {
  return dossier.benchmarks
    .map((b) => `${b.symbol} ${fmtPct(b.changePct)}`)
    .join(" · ");
}

export function buildTemplateNarrative(dossier: ThemeBriefingDossier): BriefingNarrative {
  const modeLabel = themeReviewSessionLabel(dossier.mode);
  const sessionLabel = dossier.referenceSession;

  const execParts: string[] = [];
  execParts.push(
    `${modeLabel} for ${sessionLabel}. ${formatBenchmarkLine(dossier)}.`
  );
  if (dossier.leaders.length) {
    execParts.push(`Leaders: ${formatThemeList(dossier.leaders, 3)}.`);
  }
  if (dossier.laggards.length) {
    const worst = dossier.laggards[0];
    execParts.push(`Weakest theme: ${worst.name} (#${worst.rank}).`);
  }

  const sections: BriefingNarrative["sections"] = [];

  sections.push({
    id: "benchmarks",
    title: "Index context",
    body: `${formatBenchmarkLine(dossier)}. Character: ${dossier.rotationCharacter.replace(/_/g, " ")}.`,
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
              }${t.breakdownTier && t.breakdownTier !== "none" ? ` · ${t.breakdownTier}` : ""}.`
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

  if (dossier.mode === "pre" && dossier.openRotators.some((t) => Math.abs(t.deltaRankFromOpen) >= 3)) {
    const gainers = dossier.openRotators.filter((t) => t.deltaRankFromOpen >= 3).slice(0, 5);
    const faders = [...dossier.openRotators].filter((t) => t.deltaRankFromOpen <= -3).slice(0, 5);
    sections.push({
      id: "overnight_rotation",
      title: "Overnight rotation vs prior close",
      body: [
        gainers.length ? `Re-ranked higher overnight: ${gainers.map((t) => `${t.name} (Δ rank +${t.deltaRankFromOpen})`).join(", ")}.` : "",
        faders.length ? `Lost rank overnight: ${faders.map((t) => `${t.name} (Δ rank ${t.deltaRankFromOpen})`).join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } else if (dossier.mode === "post" && dossier.openRotators.some((t) => Math.abs(t.deltaRankFromOpen) >= 3)) {
    const gainers = dossier.openRotators.filter((t) => t.deltaRankFromOpen >= 3).slice(0, 5);
    const faders = [...dossier.openRotators].filter((t) => t.deltaRankFromOpen <= -3).slice(0, 5);
    sections.push({
      id: "open_rotation",
      title: "Open → close rotation",
      body: [
        gainers.length ? `Improved vs open: ${gainers.map((t) => `${t.name} (Δ rank +${t.deltaRankFromOpen})`).join(", ")}.` : "",
        faders.length ? `Faded vs open: ${faders.map((t) => `${t.name} (Δ rank ${t.deltaRankFromOpen})`).join(", ")}.` : "",
        dossier.comparisonTimeOpen ? `Open baseline: ${new Date(dossier.comparisonTimeOpen).toLocaleString("en-US", { timeZone: "America/New_York" })} ET.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  if (dossier.lateRotators.some((t) => Math.abs(t.deltaRankLate) >= 3)) {
    const lateUp = dossier.lateRotators.filter((t) => t.deltaRankLate >= 3).slice(0, 5);
    const lateDown = [...dossier.lateRotators].filter((t) => t.deltaRankLate <= -3).slice(0, 5);
    sections.push({
      id: "late_rotation",
      title: "Late session rotation (~3:45 PM ET → close)",
      body: [
        lateUp.length ? `Into the close: ${lateUp.map((t) => `${t.name} (+${t.deltaRankLate})`).join(", ")}.` : "",
        lateDown.length ? `Late fade: ${lateDown.map((t) => `${t.name} (${t.deltaRankLate})`).join(", ")}.` : "",
        dossier.comparisonTimeLate
          ? `Late baseline: ${new Date(dossier.comparisonTimeLate).toLocaleString("en-US", { timeZone: "America/New_York" })} ET.`
          : "Late baseline unavailable — using last stored intraday snapshot if any.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  if (dossier.topMembers.length) {
    sections.push({
      id: "members",
      title: dossier.mode === "pre" ? "Notable overnight movers" : "Notable movers (story themes)",
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

  if (dossier.catalysts.length) {
    sections.push({
      id: "catalysts",
      title: "Catalyst correlation",
      body: dossier.catalysts
        .map((c) => `[${c.confidence}] ${c.themeName}: ${c.headline}`)
        .join("\n"),
    });
  }

  const dq = dossier.dataQuality;
  const limitationLines = [
    ...dq.warnings,
    `Intraday slots: ${dq.intradaySlots.available}/${dq.intradaySlots.expected}.`,
    !dq.intradaySlots.available
      ? "No stored intraday tape for this session — rotation sections omitted."
      : "",
  ].filter(Boolean);

  sections.push({
    id: "data_quality",
    title: "Data limitations",
    body: limitationLines.join("\n"),
  });

  const watchList = buildWatchListFromDossier(dossier);

  return {
    executiveSummary: execParts.join(" "),
    sections,
    watchList,
    source: "template",
  };
}

function buildWatchListFromDossier(
  dossier: ThemeBriefingDossier
): Array<{ themeId: string; themeName: string; reason: string }> {
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
  for (const t of dossier.lateRotators.filter((x) => x.deltaRankLate <= -6).slice(0, 2)) {
    list.push({
      themeId: t.id,
      themeName: t.name,
      reason: `Late fade Δ rank ${t.deltaRankLate}.`,
    });
  }
  return list.slice(0, 6);
}
