/**
 * Market Leaders universe: S&P 500 names plus theme stocks, funds that represent a theme,
 * and the extra theme-slice funds. Inverse, leveraged, and broad-market funds stay out.
 */

import { getUniverseTickers } from "../bigidea/universes";
import { CLUSTERS, OVERLAYS, SIZE_FILTER_BENCHMARKS } from "../market-condition/universe";

/** One representative fund per theme, then the slice funds kept in the default. */
export const LEADERS_THEME_FUNDS = [
  "SMH", "AIIQ", "IGV", "CIBR", "FOTO", "XLI", "ITA", "XLF", "IPAY", "XLE",
  "XLY", "XLP", "XLV", "XLB", "IYT", "ITB", "IBIT", "URA", "UFO", "QTUM",
  "REMX", "GDX", "XBI", "TAN", "BJK", "PEJ", "KIE", "DRIV", "XLC",
  "SOXX", "DRAM", "WCLD", "HACK", "XAR", "KBE", "XOP", "XME", "XTN", "XHB",
  "BITO", "URNM", "ARKX", "GLD", "SLV", "GDXJ", "IBB", "ICLN", "BETZ", "CARZ",
] as const;

const BENCHMARKS = ["SPY", "QQQ", "IWM", "IWO", "SLY", "ARKK", "RSP", "UVXY", "MGK", "MDY", "IWC"];

function excludedFunds(): Set<string> {
  const etf = new Set<string>([...BENCHMARKS, ...Object.values(SIZE_FILTER_BENCHMARKS), "GBTC", "ETHE", "BITI"]);
  for (const cluster of CLUSTERS) {
    for (const proxy of cluster.etfProxies) etf.add(proxy.symbol.toUpperCase());
  }
  return etf;
}

export function getLeadersUniverseTickers(): string[] {
  const etf = excludedFunds();
  const names = new Set<string>(getUniverseTickers("sp500").map((symbol) => symbol.toUpperCase()));
  for (const cluster of CLUSTERS) {
    for (const symbol of cluster.core) names.add(symbol.toUpperCase());
    for (const symbol of cluster.candidates) names.add(symbol.toUpperCase());
  }
  for (const overlay of OVERLAYS) {
    for (const symbol of overlay.defaultTickers ?? []) names.add(symbol.toUpperCase());
  }
  const out = new Set<string>();
  for (const symbol of names) {
    if (!etf.has(symbol)) out.add(symbol);
  }
  for (const symbol of LEADERS_THEME_FUNDS) out.add(symbol);
  return [...out].sort();
}
