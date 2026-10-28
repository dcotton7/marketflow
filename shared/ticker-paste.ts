/**
 * Tickers out of a pasted table or list (docs/specs/alerts-and-watchlists.md, "Schwab paste"): Schwab.com
 * positions/watchlist tables (tabs), Schwab's CSV export, thinkorswim watchlist copies, and plain lists.
 */
export const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

export interface PastedTicker {
  symbol: string;
  /** The option it came from, when the row was an option (the underlying is what's added). */
  option: string | null;
  shares: number | null;
  /** Cost per share: the average price, else the cost basis over the quantity. */
  entry: number | null;
}

export interface PasteSkip {
  text: string;
  why: "header" | "total or cash" | "not a ticker" | "duplicate";
}

export interface PasteResult {
  tickers: PastedTicker[];
  skipped: PasteSkip[];
}

const HEADER_CELLS = new Set([
  "SYMBOL", "DESCRIPTION", "QTY", "QUANTITY", "PRICE", "LAST", "MKT VAL", "MARKET VALUE", "COST BASIS", "NAME",
  "DAY CHNG $", "DAY CHNG %", "GAIN $", "GAIN %", "% OF ACCT", "SECURITY TYPE", "MARK", "NET CHNG", "BID", "ASK",
]);
const TOTAL_ROW = /^(cash\b|cash & cash investments|account total|positions total|total\b|margin\b|futures cash)/i;
const TITLE_ROW = /^"?(positions for|watchlist\b)/i;
const SCHWAB_OPTION = /^([A-Z]{1,5}(?:[./ -][A-Z])?)\s+\d{2}\/\d{2}\/\d{4}\s+\$?[\d,.]+\s+[CP]$/i;
const TOS_OPTION = /^[.-]?([A-Z]{1,6})(\d{6})([CP])(\d+(?:\.\d+)?)$/i;
const OCC_OPTION = /^([A-Z]{1,6})\s*\d{6}[CP]\d{8}$/i;

function csvCells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cell);
      cell = "";
    } else cell += c;
  }
  out.push(cell);
  return out.map((s) => s.trim());
}

/** Unquoted commas only separate cells after a comma-separated header: "$18,120.00" in a space-separated row and
 *  "AAPL, MSFT" are words. */
function cellsOf(line: string, csv: boolean): { cells: string[]; table: boolean } {
  if (line.includes("\t")) return { cells: line.split("\t").map((s) => s.trim()), table: true };
  if (line.includes('"') || (csv && line.includes(","))) return { cells: csvCells(line), table: true };
  const words = line.trim().split(/[\s,]+/).filter(Boolean);
  if (words.length === 2 && /^[A-Z]{1,4}$/i.test(words[0]) && /^[A-Z]$/i.test(words[1])) {
    return { cells: [words.join(" ")], table: false };
  }
  return { cells: words, table: false };
}

/** "BRK/B", "BRK B", "brk-b", "$NVDA" → "BRK.B", "NVDA"; options → their underlying. */
export function cleanSymbol(raw: string): { symbol: string; option: string | null } {
  const text = raw.trim().replace(/^\$/, "").replace(/\*+$/, "").trim();
  const opt = SCHWAB_OPTION.exec(text) ?? TOS_OPTION.exec(text) ?? OCC_OPTION.exec(text);
  const base = opt ? opt[1] : text;
  const symbol = base.toUpperCase().replace(/^([A-Z]{1,4})[/ -]([A-Z])$/, "$1.$2");
  return { symbol, option: opt ? text : null };
}

export function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t || /^-+$/.test(t) || /^n\/?a$/i.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const n = Number(t.replace(/[()$,%+\s-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

interface Columns {
  symbol: number;
  qty: number;
  avg: number;
  basis: number;
}

function headerColumns(cells: string[]): Columns | null {
  const up = cells.map((c) => c.toUpperCase().replace(/\s+/g, " ").trim());
  const symbol = up.findIndex((c) => c === "SYMBOL" || c === "TICKER");
  if (symbol < 0) return null;
  const find = (...names: RegExp[]) => up.findIndex((c) => names.some((n) => n.test(c)));
  return {
    symbol,
    qty: find(/^QTY\b/, /^QUANTITY\b/, /^SHARES$/),
    avg: find(/^AVG\.? ?(PRICE|COST)/, /^AVERAGE (PRICE|COST)/, /^COST\/SHARE$/, /^COST PER SHARE$/),
    basis: find(/^COST BASIS$/),
  };
}

function isHeaderRow(cells: string[]): boolean {
  const named = cells.filter((c) => HEADER_CELLS.has(c.toUpperCase().replace(/\s+/g, " ").trim())).length;
  return named >= 1 && named >= Math.min(2, cells.filter(Boolean).length);
}

export function parseTickerPaste(text: string): PasteResult {
  const tickers: PastedTicker[] = [];
  const skipped: PasteSkip[] = [];
  const seen = new Set<string>();
  let cols: Columns | null = null;
  let csv = false;

  const add = (raw: string, cells: string[] | null) => {
    const { symbol, option } = cleanSymbol(raw);
    if (!TICKER_RE.test(symbol)) {
      skipped.push({ text: raw, why: "not a ticker" });
      return;
    }
    if (seen.has(symbol)) {
      skipped.push({ text: raw, why: "duplicate" });
      return;
    }
    seen.add(symbol);
    let shares: number | null = null;
    let entry: number | null = null;
    if (cells && cols && !option) {
      const qty = cols.qty >= 0 ? parseNumber(cells[cols.qty]) : null;
      shares = qty != null && qty > 0 ? qty : null;
      const avg = cols.avg >= 0 ? parseNumber(cells[cols.avg]) : null;
      const basis = cols.basis >= 0 ? parseNumber(cells[cols.basis]) : null;
      entry = avg != null && avg > 0 ? avg : basis != null && basis > 0 && shares ? basis / shares : null;
      if (entry != null) entry = Math.round(entry * 10000) / 10000;
    }
    tickers.push({ symbol, option, shares, entry });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const commaHeader = !line.includes("\t") && line.includes(",") ? headerColumns(csvCells(line)) : null;
    const { cells, table } = cellsOf(line, csv);
    const head = commaHeader ?? headerColumns(cells);
    if (head) {
      cols = head;
      csv = !!commaHeader;
      skipped.push({ text: line, why: "header" });
      continue;
    }
    const first = cells[cols ? cols.symbol : 0] ?? "";
    if (TOTAL_ROW.test(first) || TOTAL_ROW.test(line)) {
      skipped.push({ text: line, why: "total or cash" });
      continue;
    }
    if (TITLE_ROW.test(line) || isHeaderRow(cells)) {
      skipped.push({ text: line, why: "header" });
      continue;
    }
    if (SCHWAB_OPTION.test(line) && !table) {
      add(line, null);
      continue;
    }
    if (cols || (table && !cells.every((c) => TICKER_RE.test(cleanSymbol(c).symbol) || !c))) {
      add(first, cells);
      continue;
    }
    const list = cells.filter(Boolean);
    if (!table && !list.every((c) => TICKER_RE.test(cleanSymbol(c).symbol))) {
      add(list[0], null);
      continue;
    }
    for (const c of list) add(c, null);
  }
  return { tickers, skipped };
}

export function pastePreview(r: PasteResult): string {
  const found = `${r.tickers.length} found`;
  const opts = r.tickers.filter((t) => t.option).length;
  const why = new Map<string, number>();
  for (const s of r.skipped) why.set(s.why, (why.get(s.why) ?? 0) + 1);
  const skipped = r.skipped.length
    ? `, ${r.skipped.length} skipped (${[...why].map(([w, n]) => `${n} ${w}`).join(", ")})`
    : "";
  return found + (opts ? ` (${opts} from options)` : "") + skipped;
}
