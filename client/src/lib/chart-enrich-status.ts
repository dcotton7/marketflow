import type { ChartSetupEnrichDossier } from "@shared/chart-setup-enrich";

/** Status lines shown while enrich runs — mirrors client dossier build + server pipeline. */
export function buildChartEnrichStatusSteps(dossier: ChartSetupEnrichDossier): string[] {
  const sym = dossier.symbol.toUpperCase();
  const daily = dossier.dailyBars.length;
  const intra = dossier.intradayBars.length;
  const tf = dossier.intradayTimeframe;

  const steps: string[] = [
    `Packaging dossier for ${sym} — ${daily} daily bars, ${intra} ${tf} bars`,
  ];

  if (dossier.baseMeta?.detected) {
    const b = dossier.baseMeta;
    steps.push(
      `Long base detected — ${b.baseDays ?? "?"}d since ${b.gapDate ?? "gap"} (+${b.gapPct != null ? b.gapPct.toFixed(1) : "?"}%)`
    );
  } else {
    steps.push("Scanning full daily history for gap-forward long bases…");
  }

  if (dossier.urMeta?.buyableNow) {
    steps.push(
      `${dossier.urMeta.maLabel ?? "MA"} U&R — short PB undercut reclaimed on last bar (buyable)`
    );
  } else if (dossier.urMeta?.detected) {
    steps.push(`${dossier.urMeta.maLabel ?? "MA"} U&R pattern detected`);
  } else {
    steps.push("Checking 20/21/50d undercut-and-rally on full daily history…");
  }

  const m = dossier.metrics;
  if (m) {
    const parts: string[] = [];
    if (typeof m.extensionFrom50dPct === "number") {
      parts.push(`${m.extensionFrom50dPct >= 0 ? "+" : ""}${m.extensionFrom50dPct.toFixed(1)}% vs 50d`);
    }
    if (typeof m.rsVsSpy === "number") {
      parts.push(`RS vs SPY ${m.rsVsSpy >= 0 ? "+" : ""}${m.rsVsSpy.toFixed(1)}%`);
    }
    if (m.themeRank != null) parts.push(`theme #${m.themeRank}`);
    if (parts.length) steps.push(`Attaching structure metrics — ${parts.join(", ")}`);
  }

  const scan = dossier.scanRow;
  if (scan) {
    const n = scan.firedOptional?.length ?? 0;
    steps.push(
      n > 0
        ? `Merging scan analysis — ${n} optional criteria signals`
        : `Merging scan narrative into dossier`
    );
  } else {
    steps.push("Chart-only enrich — no Ticker Review scan row attached");
  }

  if (dossier.themeId) {
    steps.push(
      `Linking theme context — ${dossier.themeId}${
        dossier.themeRank != null ? ` (rank #${dossier.themeRank})` : ""
      }`
    );
  }

  if (dossier.includeVisual) {
    steps.push("Including visual read in dossier payload");
  }

  steps.push(
    "Querying your saved setup models…",
    "Ranking similar corrected setups for this structure…",
    "Calling GPT-4.1-mini — lifecycle stage + pattern classification…",
    "Writing recommendation and invalidation in trader voice…",
    "Persisting enrich run for feedback and models…"
  );

  return steps;
}
