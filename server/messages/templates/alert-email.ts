interface EmailAlertMatch {
  symbol: string;
  triggerPrice: number | null;
  triggeredClauses: string[];
}

export function buildAlertEmailSubject(alertName: string, matchCount: number): string {
  return matchCount === 1
    ? `MarketFlow Alert: ${alertName} (1 match)`
    : `MarketFlow Alert: ${alertName} (${matchCount} matches)`;
}

export function buildAlertEmailBody(alertName: string, matches: EmailAlertMatch[]): string {
  const header = [`Alert: ${alertName}`, `Matches: ${matches.length}`, ""];
  const rows = matches.map((match, index) => {
    const priceText = match.triggerPrice != null && Number.isFinite(match.triggerPrice)
      ? match.triggerPrice.toFixed(2)
      : "n/a";
    const clauses = match.triggeredClauses.length > 0 ? match.triggeredClauses.join("; ") : "condition matched";
    return `${index + 1}. ${match.symbol.toUpperCase()} @ ${priceText} — ${clauses}`;
  });

  return [...header, ...rows].join("\n");
}
