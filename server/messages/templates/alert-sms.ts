export function buildAlertSmsBody(symbol: string, triggerPrice: number | null): string {
  if (triggerPrice != null && Number.isFinite(triggerPrice)) {
    return `MarketFlow ALERT: ${symbol.toUpperCase()}, ${triggerPrice.toFixed(2)}`;
  }

  return `MarketFlow ALERT: ${symbol.toUpperCase()}`;
}
