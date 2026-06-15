export type SchwabCsvType = "TRANSACTIONS" | "REALIZED_GAIN_LOSS" | "UNKNOWN";

export const SCHWAB_CSV_LABELS: Record<SchwabCsvType, string> = {
  TRANSACTIONS: "Transactions",
  REALIZED_GAIN_LOSS: "Realized Gain/Loss",
  UNKNOWN: "Unknown",
};

function normalizeCsvText(csvContent: string): string {
  let text = csvContent.replace(/^\uFEFF/, "");
  if (text.includes("\u0000")) {
    text = text.replace(/\u0000/g, "");
  }
  return text;
}

/** Schwab History → Export transactions CSV. */
export function detectSchwabCsvType(csvContent: string): SchwabCsvType {
  const text = normalizeCsvText(csvContent);
  if (
    /Date,Action,Symbol,Description,Quantity,Price,/i.test(text) ||
    (/Transactions for account/i.test(text) && /Date,Action,Symbol/i.test(text))
  ) {
    return "TRANSACTIONS";
  }
  if (
    /Realized Gain/i.test(text) ||
    /Realized Details/i.test(text) ||
    /GainLoss/i.test(text) ||
    /Cost Basis \(CB\)/i.test(text) ||
    /Total Proceeds/i.test(text) ||
    /Realized \$ P&L/i.test(text) ||
    (/Closed Date/i.test(text) && /Gain\/Loss|P&L/i.test(text)) ||
    (/Symbol/i.test(text) && /Cost Basis/i.test(text) && /Date (Acquired|Sold)|Closed Date|Opened Date/i.test(text))
  ) {
    return "REALIZED_GAIN_LOSS";
  }
  return "UNKNOWN";
}

function parseCsvRow(row: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseDelimitedRow(row: string): string[] {
  const tabCount = (row.match(/\t/g) ?? []).length;
  const commaCount = (row.match(/,/g) ?? []).length;
  const cells =
    tabCount > commaCount
      ? row.split("\t")
      : parseCsvRow(row);
  return cells.map((c) => c.replace(/^"|"$/g, "").trim());
}

function splitCsvLines(csvText: string): string[] {
  return normalizeCsvText(csvText)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function parseMoney(raw: string): number {
  const cleaned = raw.replace(/[",+$\s]/g, "");
  if (!cleaned || cleaned === "--" || cleaned === "N/A") return 0;
  return Math.abs(parseFloat(cleaned.replace(/[()]/g, "")));
}

function parseSignedMoney(raw: string): number {
  const trimmed = raw.trim().replace(/^"|"$/g, "");
  if (!trimmed || trimmed === "--" || trimmed === "N/A") return 0;
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith("-");
  const amount = parseMoney(trimmed);
  return negative ? -amount : amount;
}

function colExact(lower: string[], ...candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate);
    if (idx >= 0) return idx;
  }
  return -1;
}

function colFuzzy(lower: string[], ...candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = lower.findIndex((h) => h === candidate || h.includes(candidate));
    if (idx >= 0) return idx;
  }
  return -1;
}

interface SchwabRglHeader {
  headerIndex: number;
  symbolIdx: number;
  qtyIdx: number;
  acquiredIdx: number;
  soldIdx: number;
  costIdx: number;
  proceedsIdx: number;
  gainIdx: number;
}

function resolveHeaderIndices(lower: string[]): Omit<SchwabRglHeader, "headerIndex"> | null {
  const sym = colExact(lower, "symbol", "ticker") >= 0
    ? colExact(lower, "symbol", "ticker")
    : colFuzzy(lower, "security");
  const qty = colExact(lower, "quantity", "qty", "shares") >= 0
    ? colExact(lower, "quantity", "qty", "shares")
    : colFuzzy(lower, "# shares", "number of shares");
  const acquired = colExact(
    lower,
    "opened date",
    "date acquired",
    "acquired date",
    "purchase date"
  );
  const acquiredFuzzy = acquired >= 0
    ? acquired
    : colFuzzy(lower, "acquired/opened date", "open date", "buy date");
  const sold = colExact(
    lower,
    "closed date",
    "date sold",
    "sale date",
    "sell date",
    "transaction closed date"
  );
  const soldFuzzy = sold >= 0
    ? sold
    : colFuzzy(lower, "closed date/time", "date closed", "closing date");
  const cost = colExact(lower, "cost basis (cb)", "cost basis", "total cost");
  const costFuzzy = cost >= 0 ? cost : colFuzzy(lower, "unadjusted cost basis", "transaction cost basis", "$ cost", "basis");
  const proceeds = colExact(lower, "proceeds", "total proceeds", "sales proceeds");
  const proceedsFuzzy = proceeds >= 0
    ? proceeds
    : colFuzzy(lower, "sale proceeds", "amount realized");
  const gain = colExact(
    lower,
    "gain/loss ($)",
    "total transaction gain/loss ($)",
    "realized $ p&l",
    "realized $ p/l"
  );
  const gainFuzzy = gain >= 0
    ? gain
    : colFuzzy(lower, "gain/loss", "total g/l", "$ total g/l", "profit/loss", "g/l");

  const soldIdx = sold >= 0 ? sold : soldFuzzy;
  const costIdx = cost >= 0 ? cost : costFuzzy;
  const proceedsIdx = proceeds >= 0 ? proceeds : proceedsFuzzy;
  const gainIdx = gain >= 0 ? gain : gainFuzzy;

  if (sym < 0 || qty < 0 || soldIdx < 0) return null;
  if (costIdx < 0 && proceedsIdx < 0 && gainIdx < 0) return null;

  return {
    symbolIdx: sym,
    qtyIdx: qty,
    acquiredIdx: acquired >= 0 ? acquired : acquiredFuzzy,
    soldIdx,
    costIdx,
    proceedsIdx,
    gainIdx,
  };
}

function scoreHeaderRow(lower: string[]): number {
  let score = 0;
  if (colExact(lower, "symbol", "ticker") >= 0 || colFuzzy(lower, "security") >= 0) score += 3;
  if (colExact(lower, "quantity", "qty", "shares") >= 0) score += 2;
  if (colFuzzy(lower, "closed", "sold", "sale date") >= 0) score += 3;
  if (colFuzzy(lower, "proceeds", "cost", "gain", "p&l", "basis") >= 0) score += 2;
  return score;
}

function findSchwabRglHeader(lines: string[]): SchwabRglHeader | null {
  let best: SchwabRglHeader | null = null;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const cols = parseDelimitedRow(lines[i]!);
    const lower = cols.map((c) => c.toLowerCase());
    const resolved = resolveHeaderIndices(lower);
    if (resolved) {
      return { headerIndex: i, ...resolved };
    }
    const score = scoreHeaderRow(lower);
    if (score > bestScore) {
      bestScore = score;
      const partial = resolveHeaderIndices(lower);
      if (partial) best = { headerIndex: i, ...partial };
    }
  }

  return bestScore >= 7 ? best : null;
}

function resolveSchwabLotAmounts(
  cols: string[],
  header: SchwabRglHeader
): { costBasis: number; proceeds: number } | null {
  let costBasis = header.costIdx >= 0 ? parseMoney(cols[header.costIdx] ?? "") : 0;
  let proceeds = header.proceedsIdx >= 0 ? parseMoney(cols[header.proceedsIdx] ?? "") : 0;
  const gainLoss = header.gainIdx >= 0 ? parseSignedMoney(cols[header.gainIdx] ?? "") : 0;

  if (proceeds > 0 && costBasis <= 0 && header.gainIdx >= 0) {
    costBasis = Math.max(0, proceeds - gainLoss);
  } else if (costBasis > 0 && proceeds <= 0 && header.gainIdx >= 0) {
    proceeds = costBasis + gainLoss;
  }

  if (proceeds <= 0 && costBasis <= 0) return null;
  if (proceeds <= 0) proceeds = Math.max(costBasis + gainLoss, costBasis);
  if (costBasis <= 0) costBasis = Math.max(0, proceeds - gainLoss);

  return { costBasis, proceeds };
}

/** Schwab Realized Gain/Loss export dates (MM/DD/YYYY, optional time suffix). */
export function parseSchwabFlexibleDate(raw: string): string | null {
  const trimmed = raw.trim().replace(/^"|"$/g, "");
  if (!trimmed || /^various$/i.test(trimmed) || trimmed === "--" || trimmed === "N/A") {
    return null;
  }
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) {
    const [, mm, dd, yyyy] = mdy;
    return `${yyyy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

export interface SchwabRealizedLotRow {
  symbol: string;
  quantity: number;
  acquiredDate: string | null;
  soldDate: string;
  costBasis: number;
  proceeds: number;
}

export function describeSchwabRglParseFailure(csvText: string): string {
  const lines = splitCsvLines(csvText);
  const preview = lines.slice(0, 4).join(" | ");
  if (/gainloss|realized/i.test(preview) && !findSchwabRglHeader(lines)) {
    return `Could not find a trade header row. Re-export from Schwab → Realized Gain/Loss → Export → Details. Preview: ${preview.slice(0, 180)}`;
  }
  return "Expected Symbol, Quantity, Closed Date, and Proceeds / Cost Basis / Gain-Loss columns.";
}

/** Closed lots from Schwab Realized Gain/Loss Details CSV. */
export function parseSchwabRealizedGainLossLots(csvText: string): SchwabRealizedLotRow[] {
  const lines = splitCsvLines(csvText);
  const header = findSchwabRglHeader(lines);
  if (!header) return [];

  const lots: SchwabRealizedLotRow[] = [];
  for (let i = header.headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^total/i.test(line) || /^notes/i.test(line) || /^disclosure/i.test(line)) break;

    const cols = parseDelimitedRow(line);
    const symbol = cols[header.symbolIdx]?.trim().toUpperCase();
    const quantity = parseMoney(cols[header.qtyIdx] ?? "");
    const soldDate = parseSchwabFlexibleDate(cols[header.soldIdx] ?? "");
    const acquiredDate =
      header.acquiredIdx >= 0
        ? parseSchwabFlexibleDate(cols[header.acquiredIdx] ?? "")
        : null;
    const amounts = resolveSchwabLotAmounts(cols, header);

    if (!symbol || quantity <= 0 || !soldDate || !amounts) continue;

    lots.push({
      symbol,
      quantity,
      acquiredDate,
      soldDate,
      costBasis: amounts.costBasis,
      proceeds: amounts.proceeds,
    });
  }
  return lots;
}

/**
 * Realized Gain/Loss export → ticker → average cost per share for orphan resolution.
 * Best-effort across Schwab header variants.
 */
export function parseSchwabRealizedGainLossAvgCost(csvText: string): Record<string, number> {
  const lines = splitCsvLines(csvText);
  const header = findSchwabRglHeader(lines);
  if (!header) return {};

  const result: Record<string, number> = {};
  for (let i = header.headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^total/i.test(line) || /^notes/i.test(line) || /^disclosure/i.test(line)) break;

    const cols = parseDelimitedRow(line);
    const symbol = cols[header.symbolIdx]?.trim().toUpperCase();
    const qty = parseMoney(cols[header.qtyIdx] ?? "");
    const amounts = resolveSchwabLotAmounts(cols, header);
    if (symbol && qty > 0 && amounts && amounts.costBasis > 0) {
      result[symbol] = amounts.costBasis / qty;
    }
  }
  return result;
}
