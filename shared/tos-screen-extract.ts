/**
 * Shared shapes for Thinkorswim screen-grab extraction.
 * Missing cells stay null — never coerced to 0.
 */

export type TosScreenPositionRow = {
  symbol: string;
  avgCost: number | null;
  posQty: number | null;
  lastPrice: number | null;
  hasPosition: boolean;
};

export type TosScreenExtractResult = {
  model: "tos";
  reviewOnly: true;
  layout: "tos_watchlist" | "tos_positions" | "ticker_list" | "unknown";
  tickers: string[];
  positions: TosScreenPositionRow[];
};

const STOP = new Set([
  "NASDAQ",
  "NYSE",
  "AMEX",
  "OTC",
  "LAST",
  "BID",
  "ASK",
  "VOL",
  "VOLUME",
  "CHANGE",
  "CHG",
  "PRICE",
  "OPEN",
  "HIGH",
  "LOW",
  "CLOSE",
  "NET",
  "THE",
  "AND",
  "FOR",
  "FROM",
  "WITH",
  "THIS",
  "THAT",
  "CALL",
  "PUT",
  "DATE",
  "TIME",
  "TODAY",
  "TOTAL",
  "CASH",
  "PNL",
  "AVG",
  "SMA",
  "EMA",
  "RSI",
  "MACD",
  "USD",
  "QTY",
  "SIZE",
  "MARK",
  "WATCHLIST",
  "TICKER",
  "SYMBOL",
  "STOCK",
  "STOCKS",
  "CHART",
  "CHARTS",
  "COST",
  "POS",
]);

const TOKEN = /^[A-Z]{1,5}([./][A-Z])?$/;

export function parseWatchlistTickers(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const tokens = raw
    .toUpperCase()
    .replace(/\$/g, " ")
    .split(/[^A-Z0-9./]+/);
  for (const token of tokens) {
    const s = token.replace(/^\./, "").replace(/\.$/, "");
    if (!TOKEN.test(s)) continue;
    if (STOP.has(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function formatTickersCsv(tickers: string[]): string {
  return tickers.join(", ");
}

function asFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t || t === "-" || t.toUpperCase() === "N/A") return null;
  const neg = t.includes("(") && t.includes(")");
  const cleaned = t.replace(/[$,()\s]/g, "").replace(/^[+]/, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

function asSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.toUpperCase().trim().replace(/^\$/, "");
  if (!TOKEN.test(s) || STOP.has(s)) return null;
  return s;
}

export function normalizeTosScreenExtract(raw: unknown): TosScreenExtractResult {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const layoutRaw = String(obj.layout ?? "unknown");
  const layout: TosScreenExtractResult["layout"] =
    layoutRaw === "tos_watchlist" ||
    layoutRaw === "tos_positions" ||
    layoutRaw === "ticker_list" ||
    layoutRaw === "unknown"
      ? layoutRaw
      : "unknown";

  const positions: TosScreenPositionRow[] = [];
  const seen = new Set<string>();
  const rows = Array.isArray(obj.positions)
    ? obj.positions
    : Array.isArray(obj.rows)
      ? obj.rows
      : [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const symbol = asSymbol(r.symbol);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const avgCost = asFiniteNumber(r.avgCost ?? r.avg_cost);
    const posQty = asFiniteNumber(r.posQty ?? r.qty ?? r.quantity);
    const lastPrice = asFiniteNumber(r.lastPrice ?? r.last);
    const hasPosition = r.hasPosition === true || (posQty != null && posQty !== 0);
    positions.push({
      symbol,
      avgCost,
      posQty: hasPosition ? posQty : null,
      lastPrice,
      hasPosition,
    });
  }

  const fromCsv = parseWatchlistTickers(String(obj.tickers ?? obj.tickerCsv ?? ""));
  for (const t of fromCsv) {
    if (seen.has(t)) continue;
    seen.add(t);
    positions.push({
      symbol: t,
      avgCost: null,
      posQty: null,
      lastPrice: null,
      hasPosition: false,
    });
  }

  return {
    model: "tos",
    reviewOnly: true,
    layout,
    tickers: positions.map((p) => p.symbol),
    positions,
  };
}
