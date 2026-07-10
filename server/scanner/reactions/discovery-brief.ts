// ---------------------------------------------------------------------------
// Reaction: Discovery Brief
// Builds a human-readable headline + narrative from an enriched signal.
// ---------------------------------------------------------------------------

import type {
  EnrichedSignal,
  DiscoveryCard,
  PeerVelocityResult,
  SectorFlowResult,
  RegimeContextResult,
  FastestMoversResult,
  CrossThemeResult,
  RelativeStrengthResult,
  ThemeMembershipResult,
  NewsResult,
  EarningsProximityResult,
} from "@shared/scanner-types";
import { getClusterById, type ClusterId } from "../../market-condition/universe";

let nextId = 1;

function sign(n: number): string {
  const r = n.toFixed(2);
  return n >= 0 ? `+${r}` : r;
}

function buildVolumeClusterBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const theme = es.context.theme_membership as ThemeMembershipResult | undefined;
  const pv = es.context.peer_velocity as PeerVelocityResult | undefined;
  const sf = es.context.sector_flow as SectorFlowResult | undefined;
  const news = es.context.news as NewsResult | undefined;
  const volRatio = (es.signal.meta?.volumeRatio as number) ?? es.signal.magnitude;

  const themeName = theme?.themeName ?? "Unknown";
  const headline = `${themeName} volume cluster — ${es.signal.subject} surging on ${volRatio.toFixed(1)}x vol`;

  const parts: string[] = [];
  parts.push(`${es.signal.subject} ${sign((es.signal.meta?.changePct as number) ?? 0)}% on ${volRatio.toFixed(1)}x avg volume.`);

  if (pv && pv.peers.length > 0) {
    const moving = pv.peers.filter((p) => Math.abs(p.changePct) >= 1.0).slice(0, 3);
    if (moving.length > 0) {
      parts.push(`Peers following: ${moving.map((p) => `${p.symbol} ${sign(p.changePct)}%`).join(", ")}.`);
    }
    parts.push(`Correlation: ${(pv.correlation * 100).toFixed(0)}% · ${pv.verdict}.`);
  }

  if (sf) {
    parts.push(`Theme ${sign(sf.themeChangePct)}%, accel ${sign(sf.acceleration)}, A/D ${sf.adRatio.up}/${sf.adRatio.down}.`);
  }

  if (news && news.headlines.length > 0) {
    const topHL = news.headlines[0]!;
    parts.push(`News: "${topHL.headline.slice(0, 80)}" (${topHL.source})${news.corroborated ? " — corroborated by both sources" : ""}.`);
  }

  const tickers = [es.signal.subject, ...(pv?.peers.map((p) => p.symbol) ?? [])];
  return { headline, narrative: parts.join(" "), tickers };
}

function buildWeaknessCascadeBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const fm = es.context.fastest_movers as FastestMoversResult | undefined;
  const ct = es.context.cross_theme as CrossThemeResult | undefined;
  const rc = es.context.regime_context as RegimeContextResult | undefined;

  const headline = ct?.interpretation === "risk_off_cascade"
    ? `Risk-off cascade — ${ct.contagion.length + 1} themes weakening`
    : `Weakness spreading — ${es.signal.subject.replace(/_/g, " ")}`;

  const parts: string[] = [];

  if (fm && fm.movers.length > 0) {
    const top3 = fm.movers.slice(0, 3);
    parts.push(`Fastest droppers: ${top3.map((m) => `${m.symbol} ${sign(m.changePct)}%`).join(", ")}.`);
    if (!fm.isBroadBased) {
      const topTheme = Object.entries(fm.themeConcentration).sort((a, b) => b[1] - a[1])[0];
      if (topTheme) parts.push(`Concentrated in ${topTheme[0].replace(/_/g, " ")} (${topTheme[1]} tickers).`);
    } else {
      parts.push("Broad-based across multiple themes.");
    }
  }

  if (ct && ct.contagion.length > 0) {
    parts.push(`Spreading to: ${ct.contagion.slice(0, 3).map((c) => `${c.themeId.replace(/_/g, " ")} ${sign(c.changePct)}%`).join(", ")}.`);
  }

  if (rc) {
    parts.push(`RAI ${rc.rai} (${sign(rc.raiDelta5min)} in 5min), ${rc.regime.replace(/_/g, " ")}.`);
  }

  const tickers = fm?.movers.map((m) => m.symbol) ?? [];
  return { headline, narrative: parts.join(" "), tickers };
}

function buildDivergenceBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const theme = es.context.theme_membership as ThemeMembershipResult | undefined;
  const rs = es.context.relative_strength as RelativeStrengthResult | undefined;

  const themeName = theme?.themeName ?? "its theme";
  const divType = rs?.divergenceType === "leader" ? "outperforming" : "lagging";

  const headline = `${es.signal.subject} diverging — ${divType} ${themeName}`;
  const parts: string[] = [];
  parts.push(`${es.signal.subject} ${sign(rs?.rsVsSpy ?? 0)}% vs SPY, ${sign(rs?.rsVsTheme ?? 0)}% vs theme.`);
  parts.push(`RS rank #${rs?.rsRank ?? "?"} in ${themeName}.`);

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

function buildLodBounceBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const tier = (es.signal.meta?.tier as number) ?? 1;
  const pctAbove = (es.signal.meta?.pctAboveLod as number) ?? es.signal.magnitude;
  const headline = `${es.signal.subject} LOD bounce — ${sign(pctAbove)}% off low${tier === 2 ? " (strong)" : ""}`;

  const parts: string[] = [];
  parts.push(`${es.signal.subject} is ${pctAbove.toFixed(1)}% above today's low.`);
  if (tier === 2) parts.push("Strong Tier 2 bounce (>2% from LOD).");

  const rc = es.context.regime_context as RegimeContextResult | undefined;
  if (rc) parts.push(`Market: RAI ${rc.rai}, ${rc.regime.replace(/_/g, " ")}.`);

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

function buildMaReclaimBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const maLevel = (es.signal.meta?.maLevel as string) ?? "?";
  const maValue = (es.signal.meta?.maValue as number) ?? 0;
  const headline = `${es.signal.subject} U&R — reclaiming ${maLevel} SMA`;

  const parts: string[] = [];
  parts.push(`${es.signal.subject} crossed above the ${maLevel} SMA ($${maValue.toFixed(2)}).`);
  parts.push("Was below within the past 2 days — first reclaim.");

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

function buildDayBreakBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const isShort = es.signal.direction === "down";
  const level = isShort
    ? (es.signal.meta?.prevDayLow as number) ?? 0
    : (es.signal.meta?.prevDayHigh as number) ?? 0;
  const label = isShort ? "prev day low" : "prev day high";
  const shortPriority = es.signal.meta?.shortPriority as string | undefined;

  let headline = `${es.signal.subject} breaking ${isShort ? "below" : "above"} ${label}`;
  if (shortPriority === "urgent") headline += " — URGENT short setup";
  else if (shortPriority === "high") headline += " — high priority short";

  const parts: string[] = [];
  parts.push(`${es.signal.subject} confirmed ${BREAK_HOLD_LABEL} at $${level.toFixed(2)} (${label}).`);
  if (isShort && es.signal.meta?.below200d) parts.push("Below 200d SMA.");
  if (isShort && es.signal.meta?.below50d) parts.push("Below 50d SMA.");

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

const BREAK_HOLD_LABEL = "5-frame hold";

function buildFiveDayBreakBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const isShort = es.signal.direction === "down";
  const level = isShort
    ? (es.signal.meta?.fiveDayLow as number) ?? 0
    : (es.signal.meta?.fiveDayHigh as number) ?? 0;
  const label = isShort ? "5-day low" : "5-day high";
  const shortPriority = es.signal.meta?.shortPriority as string | undefined;

  let headline = `${es.signal.subject} breaking ${isShort ? "below" : "above"} ${label}`;
  if (shortPriority === "urgent") headline += " — URGENT short setup";
  else if (shortPriority === "high") headline += " — high priority short";

  const parts: string[] = [];
  parts.push(`${es.signal.subject} confirmed ${BREAK_HOLD_LABEL} at $${level.toFixed(2)} (${label}).`);
  if (isShort && es.signal.meta?.below200d) parts.push("Below 200d SMA.");
  if (isShort && es.signal.meta?.below50d) parts.push("Below 50d SMA.");

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

function buildFailedBreakoutBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const levelType = (es.signal.meta?.levelType as string) ?? "prev day high";
  const failedLevel = (es.signal.meta?.failedLevel as number) ?? 0;
  const reversalPct = (es.signal.meta?.reversalPct as number) ?? es.signal.magnitude;

  let headline = `${es.signal.subject} failed breakout — reversed below ${levelType}`;
  if (es.signal.meta?.below200d && es.signal.meta?.below50d) headline += " (bearish structure)";

  const parts: string[] = [];
  parts.push(`${es.signal.subject} broke above ${levelType} ($${failedLevel.toFixed(2)}) but reversed ${reversalPct.toFixed(2)}% below.`);
  if (es.signal.meta?.below200d) parts.push("Below 200d SMA.");
  if (es.signal.meta?.below50d) parts.push("Below 50d SMA.");

  const rc = es.context.regime_context as RegimeContextResult | undefined;
  if (rc) parts.push(`Market: RAI ${rc.rai}, ${rc.regime.replace(/_/g, " ")}.`);

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

function buildHodFadeBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const hodPrice = (es.signal.meta?.hodPrice as number) ?? 0;
  const fadePct = (es.signal.meta?.fadeFromHodPct as number) ?? es.signal.magnitude;
  const framesSince = (es.signal.meta?.framesSinceHod as number) ?? 0;
  const minutesSince = Math.round(framesSince * 0.5);

  const headline = `${es.signal.subject} HOD fade — ${fadePct.toFixed(1)}% off high (${minutesSince}m ago)`;

  const parts: string[] = [];
  parts.push(`${es.signal.subject} hit HOD of $${hodPrice.toFixed(2)} ~${minutesSince} min ago and has faded ${fadePct.toFixed(1)}%.`);
  parts.push("Distribution pattern — early high followed by sustained selling.");
  if (es.signal.meta?.below200d) parts.push("Below 200d SMA.");
  if (es.signal.meta?.below50d) parts.push("Below 50d SMA.");

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

function buildGapDownContinuationBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const gapPct = (es.signal.meta?.gapPct as number) ?? 0;
  const fadeBelowOpen = (es.signal.meta?.fadeBelowOpenPct as number) ?? 0;

  const headline = `${es.signal.subject} gap down continuation — ${Math.abs(gapPct).toFixed(1)}% gap, now ${fadeBelowOpen.toFixed(1)}% below open`;

  const parts: string[] = [];
  parts.push(`${es.signal.subject} gapped down ${Math.abs(gapPct).toFixed(1)}% and continues lower — now ${fadeBelowOpen.toFixed(1)}% below today's open.`);
  parts.push("No bounce after 1st hour; sellers in control.");
  if (es.signal.meta?.below200d) parts.push("Below 200d SMA.");
  if (es.signal.meta?.below50d) parts.push("Below 50d SMA.");

  const news = es.context.news as NewsResult | undefined;
  if (news?.headlines.length) {
    parts.push(`News: "${news.headlines[0]!.headline.slice(0, 60)}" (${news.headlines[0]!.source}).`);
  }

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

function buildNewsAlertBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const severity = (es.signal.meta?.severity as number) ?? es.signal.magnitude;
  const newsHeadline = (es.signal.meta?.headline as string) ?? "News detected";
  const source = (es.signal.meta?.source as string) ?? "unknown";
  const corroborated = es.signal.meta?.corroborated as boolean ?? false;
  const totalHeadlines = (es.signal.meta?.totalHeadlines as number) ?? 1;
  const url = (es.signal.meta?.url as string) ?? "";
  const changePct = es.signal.meta?.changePct as number | null;
  const pctFromLod = es.signal.meta?.pctFromLod as number | null;

  const theme = es.context.theme_membership as ThemeMembershipResult | undefined;
  const themeName = theme?.themeName ?? "";

  const chgStr = changePct != null
    ? (changePct >= 0 ? `+${changePct.toFixed(2)}%` : `${changePct.toFixed(2)}%`)
    : null;
  const lodStr = pctFromLod != null ? `+${pctFromLod.toFixed(2)}%` : null;

  const priceParts: string[] = [];
  if (chgStr) priceParts.push(`${chgStr} today`);
  if (lodStr) priceParts.push(`${lodStr} from LOD`);
  const priceTag = priceParts.length > 0 ? ` ${priceParts.join(", ")} ` : " ";

  const headline = `${es.signal.subject}${priceTag}— ${newsHeadline.slice(0, 60)}`;

  const parts: string[] = [];
  parts.push(`"${newsHeadline.slice(0, 120)}" (${source}, severity ${severity}/10).`);
  if (chgStr || lodStr) {
    const statParts: string[] = [];
    if (chgStr) statParts.push(`${chgStr} today`);
    if (lodStr) statParts.push(`${lodStr} off LOD`);
    parts.push(`${es.signal.subject} is ${statParts.join(", ")}.`);
  }
  if (corroborated) parts.push("Corroborated by both Finnhub and FMP.");
  if (totalHeadlines > 1) parts.push(`${totalHeadlines} total headlines today.`);
  if (themeName) parts.push(`Theme: ${themeName}.`);

  // Stash URL in context so the card can render it as a real link
  if (url) {
    (es.context as any)._newsUrl = url;
    (es.context as any)._newsSource = source;
  }

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

interface TopMoverMeta {
  symbol: string;
  changePct: number;
  volumeRatio: number;
}

function resolveThemeName(themeId: string): string {
  const cluster = getClusterById(themeId as ClusterId);
  return cluster?.name ?? themeId.replace(/_/g, " ");
}

function formatMoverList(movers: TopMoverMeta[], includeVol = false): string {
  return movers
    .map((m) => {
      const pct = `${sign(m.changePct)}%`;
      return includeVol && m.volumeRatio > 0
        ? `${m.symbol} ${pct} (${m.volumeRatio.toFixed(1)}x vol)`
        : `${m.symbol} ${pct}`;
    })
    .join(", ");
}

function buildThemeAccelerationBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const rc = es.context.regime_context as RegimeContextResult | undefined;
  const scoreDelta = (es.signal.meta?.scoreDelta as number) ?? es.signal.magnitude;
  const currentScore = (es.signal.meta?.currentScore as number) ?? 0;
  const topMovers = (es.signal.meta?.topMovers as TopMoverMeta[] | undefined) ?? [];
  const themeName = resolveThemeName(es.signal.subject);
  const isUp = es.signal.direction === "up";
  const contradictory = (es.signal.meta?.contradictory as boolean) ?? false;

  // Pick an honest verb: "surging" only when actually strong, "bouncing" if still weak
  let verb: string;
  if (isUp) {
    verb = contradictory ? "bouncing" : "surging";
  } else {
    verb = contradictory ? "fading" : "weakening";
  }
  const moversSnippet = topMovers.length > 0
    ? ` — led by ${formatMoverList(topMovers.slice(0, 2))}`
    : "";
  const scoreLabel = contradictory
    ? ` (score: ${currentScore.toFixed(0)})`
    : "";
  const headline = `${themeName} ${verb}${moversSnippet}${scoreLabel}`;

  const parts: string[] = [];
  parts.push(`Theme score ${sign(scoreDelta)} to ${currentScore.toFixed(2)}.`);
  if (topMovers.length > 0) {
    parts.push(`Top movers: ${formatMoverList(topMovers, true)}.`);
  }
  if (rc) {
    parts.push(`Market: RAI ${rc.rai}, ${rc.regime.replace(/_/g, " ")}, ${rc.session.replace(/_/g, " ")}.`);
  }

  const tickers = topMovers.map((m) => m.symbol);
  return { headline, narrative: parts.join(" "), tickers };
}

function buildBreadthShiftBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const rc = es.context.regime_context as RegimeContextResult | undefined;
  const delta = (es.signal.meta?.delta as number) ?? 0;
  const currRatio = (es.signal.meta?.currRatio as number) ?? 0;
  const topMovers = (es.signal.meta?.topMovers as TopMoverMeta[] | undefined) ?? [];
  const themeName = resolveThemeName(es.signal.subject);
  const isUp = es.signal.direction === "up";

  const verb = isUp ? "breadth expanding" : "breadth contracting";
  const moversSnippet = topMovers.length > 0
    ? ` — ${formatMoverList(topMovers.slice(0, 2))}`
    : "";
  const headline = `${themeName} ${verb}${moversSnippet}`;

  const parts: string[] = [];
  const pctUp = Math.round(currRatio * 100);
  parts.push(`${pctUp}% of members green (shifted ${sign(Math.round(delta * 100))}%).`);
  if (topMovers.length > 0) {
    parts.push(`Top movers: ${formatMoverList(topMovers, true)}.`);
  }
  if (rc) {
    parts.push(`Market: RAI ${rc.rai}, ${rc.regime.replace(/_/g, " ")}, ${rc.session.replace(/_/g, " ")}.`);
  }

  const tickers = topMovers.map((m) => m.symbol);
  return { headline, narrative: parts.join(" "), tickers };
}

function buildPostEarningsReactionBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const gapPct = (es.signal.meta?.gapPct as number) ?? es.signal.magnitude;
  const epsActual = es.signal.meta?.epsActual as number | null;
  const epsEstimate = es.signal.meta?.epsEstimate as number | null;
  const epsSurprisePct = es.signal.meta?.epsSurprisePct as number | null;
  const revActual = es.signal.meta?.revenueActual as number | null;
  const revEstimate = es.signal.meta?.revenueEstimate as number | null;
  const revSurprisePct = es.signal.meta?.revenueSurprisePct as number | null;
  const earningsTime = (es.signal.meta?.earningsTime as string) ?? "";
  const timeLabel = earningsTime === "bmo" ? " BMO" : earningsTime === "amc" ? " AMC" : "";

  const beatMiss = epsActual != null && epsEstimate != null
    ? (epsActual > epsEstimate ? "beat" : epsActual < epsEstimate ? "miss" : "inline")
    : "reported";

  const headline = `${es.signal.subject} earnings ${beatMiss}${timeLabel} — ${sign(gapPct)}% reaction`;

  const parts: string[] = [];
  parts.push(`${es.signal.subject} ${sign(gapPct)}% after reporting earnings${timeLabel}.`);
  if (epsActual != null && epsEstimate != null) {
    parts.push(`EPS: $${epsActual.toFixed(2)} vs est $${epsEstimate.toFixed(2)} (${epsSurprisePct != null ? `${sign(epsSurprisePct)}%` : "N/A"}).`);
  }
  if (revActual != null && revEstimate != null) {
    const revActualM = revActual >= 1e9 ? `$${(revActual / 1e9).toFixed(2)}B` : `$${(revActual / 1e6).toFixed(1)}M`;
    const revEstM = revEstimate >= 1e9 ? `$${(revEstimate / 1e9).toFixed(2)}B` : `$${(revEstimate / 1e6).toFixed(1)}M`;
    parts.push(`Revenue: ${revActualM} vs est ${revEstM}${revSurprisePct != null ? ` (${sign(revSurprisePct)}%)` : ""}.`);
  }

  const rc = es.context.regime_context as RegimeContextResult | undefined;
  if (rc) parts.push(`Market: RAI ${rc.rai}, ${rc.regime.replace(/_/g, " ")}.`);

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

function buildThemeEarningsDensityBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const reportingTickers = (es.signal.meta?.reportingTickers as string[]) ?? [];
  const count = reportingTickers.length;
  const themeName = resolveThemeName(es.signal.subject);

  const headline = `${themeName} — ${count} tickers reporting earnings this week`;

  const parts: string[] = [];
  parts.push(`${count} members of ${themeName} have earnings within the next 5 trading days.`);
  if (reportingTickers.length > 0) {
    parts.push(`Reporting: ${reportingTickers.slice(0, 8).join(", ")}${reportingTickers.length > 8 ? ` (+${reportingTickers.length - 8} more)` : ""}.`);
  }
  parts.push("Watch for coordinated post-earnings moves in this group.");

  const rc = es.context.regime_context as RegimeContextResult | undefined;
  if (rc) parts.push(`Market: RAI ${rc.rai}, ${rc.regime.replace(/_/g, " ")}.`);

  return { headline, narrative: parts.join(" "), tickers: reportingTickers.slice(0, 10) };
}

function buildIpoDebutBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const company = (es.signal.meta?.company as string) ?? es.signal.subject;
  const exchange = (es.signal.meta?.exchange as string) ?? "Unknown";
  const priceRange = (es.signal.meta?.priceRange as string) ?? "";
  const shares = (es.signal.meta?.sharesOffered as number) ?? 0;
  const marketCapFormatted = (es.signal.meta?.marketCapFormatted as string) ?? "";
  const ipoDate = (es.signal.meta?.ipoDate as string) ?? "";
  const actionStatus = (es.signal.meta?.actionStatus as string) ?? "";

  const headline = `IPO: ${company} (${es.signal.subject}) debuts on ${exchange}`;

  const parts: string[] = [];
  if (priceRange) parts.push(`Priced at ${priceRange}, offering ${shares > 0 ? shares.toLocaleString() : "?"} shares.`);
  if (marketCapFormatted) parts.push(`Market cap ~${marketCapFormatted}.`);
  parts.push(`${exchange} listing.`);
  if (ipoDate) parts.push(`IPO date: ${ipoDate}.`);
  if (actionStatus) parts.push(`Status: ${actionStatus}.`);

  return { headline, narrative: parts.join(" "), tickers: [es.signal.subject] };
}

function buildGenericBrief(es: EnrichedSignal): { headline: string; narrative: string; tickers: string[] } {
  const rc = es.context.regime_context as RegimeContextResult | undefined;
  const news = es.context.news as NewsResult | undefined;

  switch (es.signal.type) {
    case "theme_acceleration":
      return buildThemeAccelerationBrief(es);
    case "breadth_shift":
      return buildBreadthShiftBrief(es);
  }

  let headline: string;
  switch (es.signal.type) {
    case "regime_change":
      headline = `Regime shift: ${(es.signal.meta?.from as string) ?? "?"} → ${(es.signal.meta?.to as string) ?? "?"}`;
      break;
    case "rai_shift":
      headline = `RAI moved ${sign(es.signal.magnitude)} to ${rc?.rai ?? "?"}`;
      break;
    case "gap": {
      const gapPct = (es.signal.meta?.gapPct as number) ?? es.signal.magnitude;
      const gapPrefix = gapPct >= 5 ? "🔥 " : "";
      headline = `${gapPrefix}${es.signal.subject} gapped ${sign(gapPct)}% at open`;
      break;
    }
    case "adr_blowout":
      headline = `${es.signal.subject} ADR blowout: ${es.signal.magnitude}x extended`;
      break;
    default:
      headline = `${es.pipelineName}: ${es.signal.subject} (${es.signal.type})`;
  }

  const parts: string[] = [headline + "."];
  if (rc) parts.push(`Market: RAI ${rc.rai}, ${rc.regime.replace(/_/g, " ")}, ${rc.session.replace(/_/g, " ")}.`);
  if (news?.headlines.length) {
    parts.push(`News: "${news.headlines[0]!.headline.slice(0, 60)}" (${news.headlines[0]!.source}).`);
  }

  const tickers = es.signal.subjectKind === "ticker" ? [es.signal.subject] : [];
  return { headline, narrative: parts.join(" "), tickers };
}

const THEME_IDS = new Set([
  "SEMIS", "AI_INFRA", "STORAGE", "ENTERPRISE_SOFT", "CYBER", "FIBER_OPTICAL",
  "DATA_CENTER_REITS", "INDUSTRIAL_INFRA", "DEFENSE", "FINANCIAL_CORE",
  "PAYMENTS_FINTECH", "ENERGY", "CONSUMER_DISC", "CONSUMER_STAPLES",
  "HEALTHCARE", "MATERIALS_METALS", "TRANSPORTS", "HOMEBUILDERS", "CRYPTO_EQ",
  "NUCLEAR_URANIUM", "SPACE_FRONTIER", "QUANTUM", "RARE_EARTH",
  "PRECIOUS_METALS", "BIOTECH", "SOLAR", "GAMING_CASINOS", "HOSPITALITY_LEISURE",
  "MARKET",
]);

function filterToRealTickers(tickers: string[]): string[] {
  return [...new Set(tickers)].filter((t) => !THEME_IDS.has(t));
}

export function buildDiscoveryCard(es: EnrichedSignal): DiscoveryCard {
  let brief: { headline: string; narrative: string; tickers: string[] };

  switch (es.pipelineId) {
    case "volume_cluster":
      brief = buildVolumeClusterBrief(es);
      break;
    case "weakness_cascade":
      brief = buildWeaknessCascadeBrief(es);
      break;
    case "leadership_divergence":
      brief = buildDivergenceBrief(es);
      break;
    case "lod_bounce_scan":
      brief = buildLodBounceBrief(es);
      break;
    case "ma_reclaim_scan":
      brief = buildMaReclaimBrief(es);
      break;
    case "prev_day_break_scan":
      brief = buildDayBreakBrief(es);
      break;
    case "five_day_break_scan":
      brief = buildFiveDayBreakBrief(es);
      break;
    case "failed_breakout_scan":
      brief = buildFailedBreakoutBrief(es);
      break;
    case "hod_fade_scan":
      brief = buildHodFadeBrief(es);
      break;
    case "gap_down_continuation_scan":
      brief = buildGapDownContinuationBrief(es);
      break;
    case "news_alert_scan":
      brief = buildNewsAlertBrief(es);
      break;
    case "post_earnings_scan":
      brief = buildPostEarningsReactionBrief(es);
      break;
    case "theme_earnings_density_scan":
      brief = buildThemeEarningsDensityBrief(es);
      break;
    case "ipo_debut_scan":
      brief = buildIpoDebutBrief(es);
      break;
    default:
      brief = buildGenericBrief(es);
  }

  const theme = es.context.theme_membership as ThemeMembershipResult | undefined;

  return {
    id: nextId++,
    pipelineId: es.pipelineId,
    pipelineName: es.pipelineName,
    signalType: es.signal.type,
    subject: es.signal.subject,
    subjectKind: es.signal.subjectKind,
    direction: es.signal.direction,
    magnitude: es.signal.magnitude,
    priority: es.priority,
    headline: brief.headline,
    narrative: brief.narrative,
    tickers: filterToRealTickers(brief.tickers),
    themeId: theme?.themeId
      ?? (es.signal.subjectKind === "theme" ? es.signal.subject : null),
    context: es.context,
    qualifyScore: es.qualifyScore,
    createdAt: new Date().toISOString(),
  };
}
