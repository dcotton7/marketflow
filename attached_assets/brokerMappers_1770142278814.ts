// ============================================================
// DONALD'S TRADING SYSTEM — Broker Mapper Skeletons
// ============================================================
// Each mapper follows the EXACT same contract as fidelityMapper:
//   Input:  raw CSV string + fileName + importedBy
//   Output: { batch: ImportBatch, trades: NormalizedTrade[] }
//
// These are skeletons built from confirmed CSV headers for each
// broker. The parsing logic and edge cases will be filled in
// once you have a real export file to test against — same way
// the Fidelity mapper was built.
// ============================================================

import {
  NormalizedTrade,
  ImportBatch,
  SkippedRow,
  TradeDirection,
  TimestampSource,
} from "./tradeSchema";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// SHARED: CSV row parser (same one used in fidelityMapper)
// In production, extract this to a shared utility file.
// ============================================================
function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += char; }
  }
  result.push(current);
  return result;
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[",+$\s]/g, "");
  if (cleaned === "--" || cleaned === "" || cleaned === "N/A") return 0;
  return Math.abs(parseFloat(cleaned));
}

function parseQuantity(raw: string): number {
  const cleaned = raw.replace(/[",\s]/g, "");
  if (cleaned === "--" || cleaned === "" || cleaned === "N/A") return 0;
  return Math.abs(parseFloat(cleaned));
}


// ============================================================
// SCHWAB MAPPER
// ============================================================
// Confirmed CSV structure (from Schwab History > Export):
//
//   Transactions for account XXXX-9999 as of MM/DD/YYYY HH:MM:SS ET
//   From MM/DD/YYYY to MM/DD/YYYY
//
//   Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount
//   01/26/2026,Buy,AAPL,AAPL,100,220.50,$0.00,$22050.00
//   01/26/2026,Sell,TSLA,TSLA,50,350.75,$0.00,$17537.50
//
// Key differences from Fidelity:
//   - Action column is "Buy"/"Sell" (not "YOU BOUGHT"/"YOU SOLD")
//   - Date format is MM/DD/YYYY (not Mon-DD-YYYY)
//   - Fees & Comm is a single combined column (not split)
//   - Amount column is the total (not ambiguous like Fidelity)
//   - NO execution time (same problem as Fidelity)
//   - No settlement date column
//   - Non-trade rows: "Deposit", "ACH Transfer", "Dividend", etc.
//   - Header block has 2 metadata lines before the column row
//
// TODO: Validate all of the above against a real Schwab export.
//       The column names and Action values are confirmed but
//       edge cases (options, splits, dividends) need a real file.
// ============================================================

const SCHWAB_BROKER_ID = "SCHWAB";

// Schwab Action values that are NOT buy/sell trades
const SCHWAB_NON_TRADE_ACTIONS = new Set([
  "deposit", "withdrawal", "ach transfer", "ach deposit",
  "dividend", "long term capital gain", "short term capital gain",
  "interest", "balance transfer", "transfer in", "transfer out",
  "shares in", "shares out",           // stock splits land here
  "stock split", "reverse split",
  "fee", "tax withholding",
]);

function parseSchwabDate(raw: string): string | null {
  // "01/26/2026" → "2026-01-26"
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[1]}-${match[2]}`;
}

function parseSchwabDirection(action: string): TradeDirection | null {
  const lower = action.trim().toLowerCase();
  if (lower === "buy" || lower === "buy to open" || lower === "buy to cover") return "BUY";
  if (lower === "sell" || lower === "sell to close" || lower === "sell short")  return "SELL";
  return null;
}

export interface SchwabParseResult {
  batch: ImportBatch;
  trades: NormalizedTrade[];
}

export function parseSchwabCSV(
  csvContent: string,
  fileName: string,
  importedBy: string
): SchwabParseResult {
  const batchId    = uuidv4();
  const importedAt = new Date().toISOString();
  const skippedRows: SkippedRow[] = [];
  const trades: NormalizedTrade[]  = [];

  const lines = csvContent
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // --- Find header row: "Date,Action,Symbol,..." ---
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("Date,Action,Symbol")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return {
      batch: {
        batchId, brokerId: SCHWAB_BROKER_ID, fileName, fileType: "CSV",
        uploadedAt: importedAt, uploadedBy: importedBy,
        totalTradesFound: 0, totalTradesImported: 0,
        skippedRows: [{ rowIndex: 0, rawData: "N/A", reason: "HEADER_NOT_FOUND" }],
        status: "FAILED",
      },
      trades: [],
    };
  }

  // --- Extract account ID from metadata block ---
  // "Transactions for account XXXX-9999 as of ..."
  const metaBlock   = lines.slice(0, headerIndex).join(" ");
  const acctMatch   = metaBlock.match(/account\s+(\S+)/i);
  const accountId   = acctMatch ? acctMatch[1].replace(/[*X]/g, "") : "0000";

  const dataRows = lines.slice(headerIndex + 1);

  for (let i = 0; i < dataRows.length; i++) {
    const rawRow = dataRows[i];

    // Skip empty or footer lines
    if (!rawRow || rawRow.startsWith("Total") || rawRow.startsWith("Notes")) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "FOOTER_OR_EMPTY" });
      continue;
    }

    const cols = parseCSVRow(rawRow);
    // Expected: Date, Action, Symbol, Description, Quantity, Price, Fees & Comm, Amount
    if (cols.length < 8) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "INSUFFICIENT_COLUMNS" });
      continue;
    }

    const [dateRaw, actionRaw, symbolRaw, , quantityRaw, priceRaw, feesRaw, amountRaw] = cols;

    // --- Filter non-trade actions ---
    if (SCHWAB_NON_TRADE_ACTIONS.has(actionRaw.trim().toLowerCase())) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "NON_TRADE_ACTION" });
      continue;
    }

    const ticker    = symbolRaw.trim().toUpperCase();
    const direction = parseSchwabDirection(actionRaw);
    const tradeDate = parseSchwabDate(dateRaw);

    if (!ticker) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "MISSING_TICKER" });
      continue;
    }
    if (!direction) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "UNKNOWN_ACTION" });
      continue;
    }
    if (!tradeDate) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "INVALID_DATE" });
      continue;
    }

    const quantity   = parseQuantity(quantityRaw);
    const price      = parseAmount(priceRaw);
    const fees       = parseAmount(feesRaw);   // Schwab combines commission + fees
    const totalAmount = quantity * price;
    const netAmount  = totalAmount - fees;

    // Schwab also doesn't provide execution time — same treatment as Fidelity
    const executionTime = `${tradeDate}T09:30:00-05:00`;

    const fillGroupKey = `${tradeDate}_${ticker}_${direction}`;

    trades.push({
      tradeId:          uuidv4(),
      brokerId:         SCHWAB_BROKER_ID,
      brokerOrderId:    null,           // TODO: Schwab may include order IDs in Description
      importBatchId:    batchId,
      ticker,
      assetType:        "STOCK",        // TODO: detect options from Symbol format (e.g. "AAPL 01/17/2026 220 C")
      direction,
      quantity,
      price,
      totalAmount,
      commission:       0,              // Schwab is $0 commission; fees field covers any regulatory fees
      fees,
      netAmount,
      tradeDate,
      settlementDate:   null,           // TODO: Schwab doesn't include this in the CSV — may need T+1 calculation
      executionTime,
      timestampSource:  "ESTIMATED_OPEN" as TimestampSource,
      isTimeEstimated:  true,
      accountId,
      accountName:      "Schwab Account",
      accountType:      "TAXABLE",      // TODO: detect from metadata block or account name
      status:           "CONFIRMED",    // Schwab History only shows settled trades
      isFill:           true,           // post-process below
      fillGroupKey,
      rawSource:        rawRow,
      importedAt,
      importedBy,
    });
  }

  // --- Post-process: single-fill groups aren't partial fills ---
  const fillCounts = new Map<string, number>();
  trades.forEach(t => { if (t.fillGroupKey) fillCounts.set(t.fillGroupKey, (fillCounts.get(t.fillGroupKey) || 0) + 1); });
  trades.forEach(t => { if (t.fillGroupKey && fillCounts.get(t.fillGroupKey) === 1) t.isFill = false; });

  return {
    batch: {
      batchId, brokerId: SCHWAB_BROKER_ID, fileName, fileType: "CSV",
      uploadedAt: importedAt, uploadedBy: importedBy,
      totalTradesFound: dataRows.length, totalTradesImported: trades.length,
      skippedRows, status: "COMPLETE",
    },
    trades,
  };
}


// ============================================================
// ROBINHOOD MAPPER
// ============================================================
// Confirmed CSV structure (from Reports > Generate Report):
//
//   Date,Symbol,Type,Side,Price,Quantity,Total,Fee,Note
//   2026-01-26T14:30:00,AAPL,STOCK,BUY,220.50,100,22050.00,0.00,
//   2026-01-26T15:45:00,TSLA,STOCK,SELL,350.75,50,17537.50,0.00,
//
// Key differences from Fidelity/Schwab:
//   - Date IS a full ISO timestamp — Robinhood actually provides time!
//   - Side is "BUY"/"SELL" (clean, no parsing tricks)
//   - Type column: "STOCK", "OPTION", "CRYPTO" — use directly
//   - No metadata header block — data starts at row 2
//   - Total column is reliable
//   - Fee is per-trade (usually $0 for stocks)
//   - Options rows include strike/expiry/type in the Symbol column
//     e.g. "AAPL 01/17/2026 220 C" — needs parsing for OptionsDetails
//
// TODO: Validate against a real Robinhood report export.
//       The structure above is based on third-party tooling output;
//       the native report format may differ slightly.
// ============================================================

const ROBINHOOD_BROKER_ID = "ROBINHOOD";

function parseRobinhoodDirection(side: string): TradeDirection | null {
  const lower = side.trim().toLowerCase();
  if (lower === "buy")  return "BUY";
  if (lower === "sell") return "SELL";
  return null;
}

export interface RobinhoodParseResult {
  batch: ImportBatch;
  trades: NormalizedTrade[];
}

export function parseRobinhoodCSV(
  csvContent: string,
  fileName: string,
  importedBy: string
): RobinhoodParseResult {
  const batchId    = uuidv4();
  const importedAt = new Date().toISOString();
  const skippedRows: SkippedRow[] = [];
  const trades: NormalizedTrade[]  = [];

  const lines = csvContent
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // --- Find header: "Date,Symbol,Type,Side,..." ---
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("Date,Symbol")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return {
      batch: {
        batchId, brokerId: ROBINHOOD_BROKER_ID, fileName, fileType: "CSV",
        uploadedAt: importedAt, uploadedBy: importedBy,
        totalTradesFound: 0, totalTradesImported: 0,
        skippedRows: [{ rowIndex: 0, rawData: "N/A", reason: "HEADER_NOT_FOUND" }],
        status: "FAILED",
      },
      trades: [],
    };
  }

  const dataRows = lines.slice(headerIndex + 1);

  for (let i = 0; i < dataRows.length; i++) {
    const rawRow = dataRows[i];
    if (!rawRow) continue;

    const cols = parseCSVRow(rawRow);
    // Expected: Date, Symbol, Type, Side, Price, Quantity, Total, Fee, Note
    if (cols.length < 8) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "INSUFFICIENT_COLUMNS" });
      continue;
    }

    const [dateRaw, symbolRaw, typeRaw, sideRaw, priceRaw, quantityRaw, , feeRaw] = cols;

    const direction = parseRobinhoodDirection(sideRaw);
    if (!direction) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "UNKNOWN_SIDE" });
      continue;
    }

    // --- Parse the timestamp — Robinhood gives us the real thing ---
    // "2026-01-26T14:30:00" — may or may not have timezone
    let executionTime: string | null = null;
    let tradeDate: string | null     = null;
    let timestampSource: TimestampSource = "BROKER_PROVIDED";
    let isTimeEstimated = false;

    const dateStr = dateRaw.trim();
    if (dateStr.includes("T")) {
      // Full timestamp present
      executionTime = dateStr.includes("-05:00") || dateStr.includes("Z")
        ? dateStr
        : dateStr + "-05:00";  // assume ET if no timezone
      tradeDate = dateStr.substring(0, 10); // "2026-01-26"
    } else {
      // Fallback: date only (shouldn't happen for Robinhood, but be safe)
      tradeDate = dateStr;
      executionTime = `${dateStr}T09:30:00-05:00`;
      timestampSource = "ESTIMATED_OPEN";
      isTimeEstimated = true;
    }

    if (!tradeDate) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "INVALID_DATE" });
      continue;
    }

    // --- Parse ticker and asset type ---
    // Options look like "AAPL 01/17/2026 220 C" — extract base ticker
    const symbolParts = symbolRaw.trim().split(/\s+/);
    const ticker      = symbolParts[0].toUpperCase();
    const rawType     = typeRaw.trim().toUpperCase();

    // TODO: When rawType === "OPTION", parse symbolParts[1..3] into OptionsDetails
    //       symbolParts[1] = expiry, [2] = strike, [3] = "C"/"P"
    let assetType: NormalizedTrade["assetType"] = "STOCK";
    if (rawType === "OPTION")  assetType = "OPTIONS";
    if (rawType === "CRYPTO")  assetType = "CRYPTO";

    if (!ticker) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "MISSING_TICKER" });
      continue;
    }

    const quantity    = parseQuantity(quantityRaw);
    const price       = parseAmount(priceRaw);
    const fees        = parseAmount(feeRaw);
    const totalAmount = quantity * price;
    const netAmount   = totalAmount - fees;
    const fillGroupKey = `${tradeDate}_${ticker}_${direction}`;

    trades.push({
      tradeId:          uuidv4(),
      brokerId:         ROBINHOOD_BROKER_ID,
      brokerOrderId:    null,           // TODO: check if Robinhood includes order IDs in Note column
      importBatchId:    batchId,
      ticker,
      assetType,
      direction,
      quantity,
      price,
      totalAmount,
      commission:       0,              // Robinhood is commission-free
      fees,
      netAmount,
      tradeDate,
      settlementDate:   null,           // TODO: T+1 for stocks, T+0 for crypto
      executionTime,
      timestampSource,
      isTimeEstimated,
      accountId:        "RH",           // TODO: Robinhood doesn't expose account numbers in CSV
      accountName:      "Robinhood",
      accountType:      "TAXABLE",      // TODO: detect if Robinhood IRA is in use
      status:           "CONFIRMED",
      isFill:           true,
      fillGroupKey,
      rawSource:        rawRow,
      importedAt,
      importedBy,
    });
  }

  // --- Post-process fill groups ---
  const fillCounts = new Map<string, number>();
  trades.forEach(t => { if (t.fillGroupKey) fillCounts.set(t.fillGroupKey, (fillCounts.get(t.fillGroupKey) || 0) + 1); });
  trades.forEach(t => { if (t.fillGroupKey && fillCounts.get(t.fillGroupKey) === 1) t.isFill = false; });

  return {
    batch: {
      batchId, brokerId: ROBINHOOD_BROKER_ID, fileName, fileType: "CSV",
      uploadedAt: importedAt, uploadedBy: importedBy,
      totalTradesFound: dataRows.length, totalTradesImported: trades.length,
      skippedRows, status: "COMPLETE",
    },
    trades,
  };
}


// ============================================================
// MAPPER REGISTRY
// ============================================================
// This is the router. When a file comes in, your backend runs
// detection to pick the right mapper, then calls it through here.
// Adding a new broker = one new entry in this map.
// ============================================================

import { parseFidelityCSV, FidelityParseResult } from "./fidelityMapper";

// Unified return type — every mapper returns this shape
export type BrokerParseResult =
  | FidelityParseResult
  | SchwabParseResult
  | RobinhoodParseResult;

// The registry itself
const MAPPER_REGISTRY: Record<string, (csv: string, file: string, user: string) => BrokerParseResult> = {
  FIDELITY:   parseFidelityCSV,
  SCHWAB:     parseSchwabCSV,
  ROBINHOOD:  parseRobinhoodCSV,
  // Future brokers drop in here:
  // ETRADE:    parseETradeCSV,
  // TRADIER:   parseTradierCSV,
  // ALPACA:    parseAlpacaCSV,
};

/**
 * Auto-detect which broker a CSV file came from, then route
 * to the correct mapper. Returns null if detection fails.
 *
 * Detection heuristics (order matters — most specific first):
 */
export function detectBroker(csvContent: string): string | null {
  const head = csvContent.substring(0, 1000).toUpperCase();

  // Fidelity: metadata block contains "FIDELITY" or account pattern like "*4915"
  if (head.includes("FIDELITY") || /\*\d{4}/.test(head)) return "FIDELITY";

  // Schwab: metadata line "Transactions for account"
  if (head.includes("TRANSACTIONS FOR ACCOUNT")) return "SCHWAB";

  // Robinhood: header starts with "Date,Symbol,Type,Side"
  if (head.includes("DATE,SYMBOL,TYPE,SIDE")) return "ROBINHOOD";

  // Fallback: couldn't detect — prompt user to select manually
  return null;
}

/**
 * Main entry point. Feed it a CSV string and it figures out
 * the rest. Returns null + reason if it can't proceed.
 */
export function importTradesFromCSV(
  csvContent: string,
  fileName: string,
  importedBy: string
): { result: BrokerParseResult } | { error: string; detectedBroker: string | null } {
  const broker = detectBroker(csvContent);

  if (!broker) {
    return {
      error: "Could not auto-detect broker. Please select your broker manually.",
      detectedBroker: null,
    };
  }

  const mapper = MAPPER_REGISTRY[broker];
  if (!mapper) {
    return {
      error: `Broker "${broker}" detected but no mapper is registered yet.`,
      detectedBroker: broker,
    };
  }

  const result = mapper(csvContent, fileName, importedBy);
  return { result };
}
