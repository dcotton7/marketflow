// ============================================================
// DONALD'S TRADING SYSTEM — Fidelity Activity Report Mapper
// ============================================================
// This is your TEMPLATE. Every future broker mapper follows
// this same pattern:
//   1. Parse raw CSV into rows
//   2. Filter out non-trade rows (journals, totals, headers)
//   3. Map each row → NormalizedTrade
//   4. Return trades + a batch summary with any skipped rows
// ============================================================

import {
  NormalizedTrade,
  ImportBatch,
  SkippedRow,
  AssetType,
  TradeDirection,
  TimestampSource,
  AccountType,
  TradeStatus,
} from "./tradeSchema";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// CONFIG: Fidelity-specific constants
// ============================================================
const BROKER_ID = "FIDELITY";

// Descriptions that are NOT trades — filter these out immediately
const NON_TRADE_PATTERNS = [
  /^JOURNALED/i,              // "JOURNALED JNL VS A/C TYPES"
  /^TOTALS/i,                 // footer row
  /^DISCLOSURE/i,             // legal footer
  /^The data and information/i,
  /^Brokerage services/i,
  /^Both are Fidelity/i,
];

// Mutual fund tickers we know about — expand this list over time
// These get AssetType = "MUTUAL_FUND" instead of "STOCK"
const KNOWN_MUTUAL_FUNDS = new Set(["DUSLX", "DSCGX"]);

// ============================================================
// HELPERS
// ============================================================

/**
 * Fidelity dates look like "Jan-26-2026". Parse → "2026-01-26".
 */
function parseFidelityDate(raw: string): string | null {
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04",
    May: "05", Jun: "06", Jul: "07", Aug: "08",
    Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const match = raw.trim().match(/^(\w{3})-(\d{1,2})-(\d{4})$/);
  if (!match) return null;
  const [, mon, day, year] = match;
  const mm = months[mon];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, "0")}`;
}

/**
 * Fidelity amounts have commas and sometimes leading +/- or quotes.
 * "−33,420.00"  →  33420.00
 * "+323,150.11" →  323150.11
 * "--"          →  0
 */
function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[",+\s]/g, "");
  if (cleaned === "--" || cleaned === "") return 0;
  return Math.abs(parseFloat(cleaned));
}

/**
 * Quantity can be negative (sells) or have commas: "-2,400" → 2400
 * We always store quantity as positive; direction is separate.
 */
function parseQuantity(raw: string): number {
  const cleaned = raw.replace(/[",\s]/g, "");
  if (cleaned === "--" || cleaned === "") return 0;
  return Math.abs(parseFloat(cleaned));
}

/**
 * Some Fidelity descriptions embed an order ID:
 *   "YOU SOLD 26006JFL76" → orderId = "26006JFL76"
 *   "YOU BOUGHT"          → orderId = null
 */
function extractOrderId(description: string): string | null {
  // Pattern: "YOU BOUGHT/SOLD" followed by an alphanumeric order ID
  const match = description.match(/^YOU (?:BOUGHT|SOLD)\s+([A-Z0-9]{8,})/i);
  return match ? match[1] : null;
}

/**
 * Parse direction from description.
 * "YOU BOUGHT" → BUY,  "YOU SOLD" → SELL
 */
function parseDirection(description: string): TradeDirection | null {
  if (/YOU BOUGHT/i.test(description)) return "BUY";
  if (/YOU SOLD/i.test(description))   return "SELL";
  return null;
}

/**
 * Map Fidelity's Type column to our AccountType.
 * We also factor in the account name for IRA detection.
 */
function parseAccountType(typeCol: string, accountName: string): AccountType {
  const isIRA = /IRA/i.test(accountName);
  const isRoth = /ROTH/i.test(accountName);

  if (isRoth) return "ROTH_IRA";
  if (isIRA)  return "IRA";
  if (/margin/i.test(typeCol)) return "MARGIN";
  return "CASH";
}

/**
 * Determine asset type. We start simple and expand over time.
 * Options will be detected later by ticker patterns (e.g. expiration codes).
 */
function detectAssetType(ticker: string): AssetType {
  if (KNOWN_MUTUAL_FUNDS.has(ticker.toUpperCase())) return "MUTUAL_FUND";
  // Future: detect ETFs from a known list, options from ticker format
  return "STOCK";
}

/**
 * Build the fill group key. This is how you'll reconstruct
 * partial fills into a single logical order later.
 * Key = "{date}_{ticker}_{direction}"
 *
 * Example: "2026-01-23_BABA_BUY" groups all your BABA buys on Jan 23.
 */
function buildFillGroupKey(tradeDate: string, ticker: string, direction: TradeDirection): string {
  return `${tradeDate}_${ticker}_${direction}`;
}

/**
 * Fidelity doesn't provide execution time. We estimate market open
 * (9:30 AM ET) and flag it clearly so nothing downstream trusts it
 * as real. Settlement date "--" becomes null.
 */
function buildTimestampFields(tradeDate: string): {
  executionTime: string;
  timestampSource: TimestampSource;
  isTimeEstimated: boolean;
} {
  // 9:30 AM Eastern, using -05:00 (EST). For EDT months, adjust to -04:00.
  // A production version would use a timezone library here.
  const executionTime = `${tradeDate}T09:30:00-05:00`;
  return {
    executionTime,
    timestampSource: "ESTIMATED_OPEN",
    isTimeEstimated: true,
  };
}

// ============================================================
// MAIN: Parse a Fidelity CSV string → NormalizedTrades
// ============================================================

export interface FidelityParseResult {
  batch: ImportBatch;
  trades: NormalizedTrade[];
}

export function parseFidelityCSV(
  csvContent: string,
  fileName: string,
  importedBy: string
): FidelityParseResult {
  const batchId   = uuidv4();
  const importedAt = new Date().toISOString();
  const skippedRows: SkippedRow[] = [];
  const trades: NormalizedTrade[]  = [];

  // --- Step 1: Split into lines, strip BOM and whitespace ---
  const lines = csvContent
    .replace(/^\uFEFF/, "")           // strip BOM (Fidelity CSVs have this)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // --- Step 2: Find the actual header row ---
  // Fidelity has a metadata header block before the CSV columns.
  // We find the row that starts with "Date,Description,..."
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("Date,Description,Symbol")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    // Can't find the header — fail the whole batch
    return {
      batch: {
        batchId,
        brokerId: BROKER_ID,
        fileName,
        fileType: "CSV",
        uploadedAt: importedAt,
        uploadedBy: importedBy,
        totalTradesFound: 0,
        totalTradesImported: 0,
        skippedRows: [{ rowIndex: 0, rawData: "N/A", reason: "HEADER_NOT_FOUND" }],
        status: "FAILED",
      },
      trades: [],
    };
  }

  // --- Step 3: Parse data rows (everything after the header) ---
  // Extract account info from the metadata block at the top
  const metaBlock = lines.slice(0, headerIndex).join(" ");
  const accountMatch = metaBlock.match(/(\S+\s+\S+.*?)\s*\*(\d+)/);
  const accountName  = accountMatch ? accountMatch[1].replace(/"/g, "").trim() : "Unknown";
  const accountId    = accountMatch ? accountMatch[2] : "0000";

  const dataRows = lines.slice(headerIndex + 1);

  for (let i = 0; i < dataRows.length; i++) {
    const rawRow = dataRows[i];

    // --- Filter: skip non-trade rows ---
    const isNonTrade = NON_TRADE_PATTERNS.some(p => p.test(rawRow));
    if (isNonTrade) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "NON_TRADE_ROW" });
      continue;
    }

    // --- Filter: skip the Totals footer and empty/disclosure lines ---
    if (rawRow.startsWith(",Totals") || rawRow.startsWith(",")) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "FOOTER_OR_EMPTY" });
      continue;
    }

    // --- Parse the CSV columns ---
    // Fidelity wraps fields with commas in quotes, so we need a proper split
    const cols = parseCSVRow(rawRow);
    if (cols.length < 12) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "INSUFFICIENT_COLUMNS" });
      continue;
    }

    const [
      dateRaw,
      description,
      symbolRaw,
      quantityRaw,
      priceRaw,
      amountRaw,
      // cashBalance — we don't store this
      , 
      commissionRaw,
      feesRaw,
      accountCol,
      settlementRaw,
      typeCol,
    ] = cols;

    // --- Validate: must have a ticker and a valid direction ---
    const ticker = symbolRaw.trim();
    if (!ticker) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "MISSING_TICKER" });
      continue;
    }

    const direction = parseDirection(description);
    if (!direction) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "NOT_A_BUY_OR_SELL" });
      continue;
    }

    // --- Parse dates ---
    const tradeDate = parseFidelityDate(dateRaw);
    if (!tradeDate) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "INVALID_TRADE_DATE" });
      continue;
    }

    const settlementDate = settlementRaw.trim() === "--" ? null : parseFidelityDate(settlementRaw);

    // --- Parse numbers ---
    const quantity   = parseQuantity(quantityRaw);
    const price      = parseAmount(priceRaw);
    const commission = parseAmount(commissionRaw);
    const fees       = parseAmount(feesRaw);
    const totalAmount = quantity * price;   // calculate from qty*price, don't trust the Amount column
                                            // (Fidelity's Amount column can be net of fees)
    const netAmount  = totalAmount - commission - fees;

    // --- Build timestamp fields (estimated, since Fidelity doesn't provide time) ---
    const { executionTime, timestampSource, isTimeEstimated } = buildTimestampFields(tradeDate);

    // --- Detect asset type and account type ---
    const assetType   = detectAssetType(ticker);
    const accountType = parseAccountType(typeCol, accountName);

    // --- Status: "Processing" in Fidelity means pending settlement ---
    const status: TradeStatus = /processing/i.test(cols[6]) ? "PENDING" : "CONFIRMED";

    // --- Assemble the normalized trade ---
    const trade: NormalizedTrade = {
      tradeId:          uuidv4(),
      brokerId:         BROKER_ID,
      brokerOrderId:    extractOrderId(description),
      importBatchId:    batchId,

      ticker:           ticker.toUpperCase(),
      assetType,
      direction,

      quantity,
      price,
      totalAmount,
      commission,
      fees,
      netAmount,

      tradeDate,
      settlementDate,
      executionTime,
      timestampSource,
      isTimeEstimated,

      accountId,
      accountName,
      accountType,

      status,

      isFill:           true,   // we flag everything as a fill by default;
                                // a post-processing step can group them and
                                // set isFill=false if there's only one fill per group
      fillGroupKey:     buildFillGroupKey(tradeDate, ticker.toUpperCase(), direction),

      rawSource:        rawRow,
      importedAt,
      importedBy,
    };

    trades.push(trade);
  }

  // --- Step 4: Post-process fill groups ---
  // If a fillGroupKey only has one trade, it's not actually a partial fill
  const fillCounts = new Map<string, number>();
  trades.forEach(t => {
    if (t.fillGroupKey) {
      fillCounts.set(t.fillGroupKey, (fillCounts.get(t.fillGroupKey) || 0) + 1);
    }
  });
  trades.forEach(t => {
    if (t.fillGroupKey && fillCounts.get(t.fillGroupKey) === 1) {
      t.isFill = false;
    }
  });

  // --- Step 5: Build the batch summary ---
  const batch: ImportBatch = {
    batchId,
    brokerId:             BROKER_ID,
    fileName,
    fileType:             "CSV",
    uploadedAt:           importedAt,
    uploadedBy:           importedBy,
    totalTradesFound:     dataRows.length,
    totalTradesImported:  trades.length,
    skippedRows,
    status:               "COMPLETE",
  };

  return { batch, trades };
}

// ============================================================
// UTILITY: Proper CSV row parser (handles quoted fields)
// ============================================================
// Fidelity wraps fields containing commas in double quotes:
//   Jan-22-2026,YOU BOUGHT,F,"2,400",13.80,"-33,131.04",...
// A naive split(",") would break on those. This handles it.
// ============================================================
function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];

    if (char === '"') {
      // Toggle quote mode; don't include the quote in the output
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      // Field boundary
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  // Push the last field
  result.push(current);

  return result;
}
