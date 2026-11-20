/**
 * Fill a portfolio list's shares and cost from a paste: lines of `TICKER shares cost` (tabs, commas or spaces; a
 * header row ignored), or a broker export whose columns ticker-paste can recognise. Cost is per share; a broker's
 * Cost Basis column is divided by the quantity. Nothing is invented: a row without a usable share count is not saved.
 */
import { cleanSymbol, parseNumber, parseTickerPaste, TICKER_RE } from "./ticker-paste";

export type PositionRowStatus = "ok" | "not in list" | "bad number" | "no shares";

export interface PositionPasteRow {
  symbol: string;
  shares: number | null;
  /** Cost per share, if given. */
  entry: number | null;
  short: boolean;
  status: PositionRowStatus;
  /** The line it came from, for "bad number" rows. */
  text: string;
}

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
  // Commas separate cells when there is no other whitespace ("AAPL,100,150") or one follows a comma ("AAPL, 100, 150");
  // otherwise "1,000" is a number and spaces separate.
  if (!/\s/.test(line) || /,\s/.test(line)) return line.split(",").map((s) => s.trim());
  return line.trim().split(/\s+/);
}

export function parsePositionPaste(text: string, listSymbols: Iterable<string>): { rows: PositionPasteRow[]; skipped: number } {
  const inList = new Set([...listSymbols].map((s) => s.trim().toUpperCase()));
  const rows: PositionPasteRow[] = [];
  const seen = new Set<string>();
  const finish = (symbol: string, shares: number | null, entry: number | null, short: boolean, line: string, bad = false) => {
    if (seen.has(symbol)) return;
    seen.add(symbol);
    const status: PositionRowStatus = !inList.has(symbol)
      ? "not in list"
      : bad || (entry != null && !(entry > 0))
        ? "bad number"
        : shares == null || !(shares > 0)
          ? "no shares"
          : "ok";
    rows.push({ symbol, shares, entry, short, status, text: line });
  };

  // A broker export (a header with an Avg Price or Cost Basis column) is read by the paste parser's column rules.
  const broker = parseTickerPaste(text);
  if (broker.skipped.some((s) => s.why === "header") && broker.tickers.some((t) => t.shares != null && t.entry != null)) {
    for (const t of broker.tickers) {
      if (t.option) continue;
      finish(t.symbol, t.shares, t.entry, t.short === true, t.symbol);
    }
    return { rows, skipped: broker.skipped.length };
  }

  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = splitLine(line).filter((c) => c !== "");
    // "BRK B 10 400": a single letter after the ticker is its class, not a number.
    if (cells.length > 1 && /^[A-Z]{1,4}$/i.test(cells[0]) && /^[A-Z]$/i.test(cells[1])) cells.splice(0, 2, `${cells[0]}.${cells[1]}`);
    const { symbol } = cleanSymbol(cells[0] ?? "");
    const rest = cells.slice(1);
    // A header row (Ticker, Shares, Cost ...) or a line that is not a ticker is skipped, not saved.
    if (!TICKER_RE.test(symbol) || /^(SYMBOL|TICKER)$/i.test(cells[0])) {
      skipped++;
      continue;
    }
    const qty = parseNumber(rest[0]);
    const cost = rest.length > 1 ? parseNumber(rest[1]) : null;
    const bad = (rest[0] != null && qty == null) || (rest.length > 1 && cost == null) || qty === 0 || rest.length > 2;
    finish(symbol, qty != null ? Math.abs(qty) : null, cost, qty != null && qty < 0, line, bad);
  }
  return { rows, skipped };
}

export function positionPreview(rows: PositionPasteRow[]): string {
  const n = (s: PositionRowStatus) => rows.filter((r) => r.status === s).length;
  const parts = [`${n("ok")} to save`];
  for (const s of ["not in list", "bad number", "no shares"] as const) if (n(s)) parts.push(`${n(s)} ${s}`);
  return parts.join(", ");
}
