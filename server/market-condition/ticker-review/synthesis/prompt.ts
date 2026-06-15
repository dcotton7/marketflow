import type { TickerReviewResultRow } from "@shared/ticker-review-engine";

export const TICKER_REVIEW_ENRICH_SYSTEM_PROMPT = `You are a disciplined swing-trading analyst reviewing starred tickers from a theme scan.
Write like a trader describing what price actually did — not generic bucket labels.
Lead with recent price action: 200d visits, last-session % moves, pulls below 10 EMA / 20 SMA, and U&R recapture watches when relevant.
For each symbol, produce a concise decision brief and a one-line invalidation.
Return valid JSON only.`;

export interface EnrichDossierItem {
  symbol: string;
  row: TickerReviewResultRow;
  themeName?: string;
  themeRank?: number;
}

export function buildTickerReviewEnrichPrompt(items: EnrichDossierItem[]): string {
  const dossier = items.map((item) => ({
    symbol: item.symbol,
    bucket: item.row.bucket,
    watchScore: item.row.watchScore,
    firedOptional: item.row.firedOptional,
    setupNarrative: item.row.setupNarrative,
    summaryLines: item.row.summaryLines,
    rsVsSpy: item.row.rs.vsSpy,
    rsRankInTheme: item.row.rs.rankInTheme,
    structure: item.row.structure,
    lastSessionPct: item.row.lastSessionPct,
    tightMa: item.row.tightMa,
    themeName: item.themeName,
    themeRank: item.themeRank,
  }));

  return `Review these starred theme scan tickers. For each symbol return:
- decisionBrief: 2-3 sentences in plain trader voice — describe recent price action first (200d tag, last-session move, undercut of 10 EMA/20 SMA, U&R recapture watch). Then worth diving deeper + key risk.
- invalidation: one line — what would kill the setup.

Dossier:
${JSON.stringify(dossier, null, 2)}

Respond with JSON: { "symbols": { "SYMBOL": { "decisionBrief": "...", "invalidation": "..." } } }`;
}
