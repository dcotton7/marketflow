// ============================================================
// DONALD'S TRADING SYSTEM — Normalized Trade Schema
// ============================================================
// This is the single source of truth for what a "trade" looks
// like inside your system, regardless of which broker it came
// from. Every mapper (Fidelity, Schwab, Robinhood, etc.) must
// output this shape.
// ============================================================

// --- Asset types your system needs to handle ---
export type AssetType =
  | "STOCK"
  | "ETF"
  | "MUTUAL_FUND"   // e.g. DUSLX, DSCGX in your data
  | "OPTIONS"        // future: strike, expiration, call/put
  | "CRYPTO";        // future

// --- Why the trade exists ---
export type TradeDirection = "BUY" | "SELL";

// --- How confident we are in the execution timestamp ---
export type TimestampSource =
  | "BROKER_PROVIDED"     // broker gave us an actual time
  | "ESTIMATED_OPEN"      // we defaulted to 9:30 AM ET
  | "ESTIMATED_CLOSE"     // we defaulted to 4:00 PM ET
  | "PDF_CONFIRMATION"    // filled in later from a PDF
  | "UNKNOWN";

// --- Status of the trade record ---
export type TradeStatus =
  | "CONFIRMED"
  | "PENDING"          // e.g. "Processing" in Fidelity
  | "CANCELLED"
  | "REJECTED";

// --- What type of account the trade came from ---
export type AccountType = "CASH" | "MARGIN" | "IRA" | "ROTH_IRA" | "TAXABLE";

// ============================================================
// CORE: The normalized trade object.
// Every single trade in your system lives here.
// ============================================================
export interface NormalizedTrade {
  // --- Identity ---
  tradeId: string;              // your internal unique ID (UUID)
  brokerId: string;             // e.g. "FIDELITY", "SCHWAB", "ROBINHOOD"
  brokerOrderId: string | null; // extracted from description if present (e.g. "26006JFL76")
  importBatchId: string;        // ties this trade to the specific file upload

  // --- What was traded ---
  ticker: string;               // e.g. "BABA", "TSM"
  assetType: AssetType;
  direction: TradeDirection;

  // --- Execution details ---
  quantity: number;             // always positive — direction tells you buy vs sell
  price: number;                // per-share execution price
  totalAmount: number;          // gross value (quantity * price). Always positive.
  commission: number;           // 0 if "--" in source
  fees: number;                 // 0 if "--" in source
  netAmount: number;            // totalAmount - commission - fees

  // --- Timestamps ---
  tradeDate: string;            // ISO date of the trade: "2026-01-26"
  settlementDate: string | null; // ISO date: "2026-01-27" (null if "--")
  executionTime: string | null; // Full ISO timestamp if available: "2026-01-26T09:30:00-05:00"
  timestampSource: TimestampSource;
  isTimeEstimated: boolean;     // quick boolean flag — true if we guessed the time

  // --- Account info ---
  accountId: string;            // e.g. "4915" (last 4 digits)
  accountName: string;          // e.g. "2_DC Rollover IRA"
  accountType: AccountType;

  // --- Status ---
  status: TradeStatus;

  // --- Fill tracking (critical for partial fills like your BABA/RKLB trades) ---
  isFill: boolean;              // true if this is one fill of a multi-fill order
  fillGroupKey: string | null;  // groups fills: "{tradeDate}_{ticker}_{direction}"
                                // lets you reconstruct the full order later

  // --- Audit trail ---
  rawSource: string;            // the original CSV row, stringified — always keep this
  importedAt: string;           // ISO timestamp of when the file was imported
  importedBy: string;           // user identifier
}

// ============================================================
// OPTIONAL: Options-specific fields (for future expansion)
// When you add options support, attach this to NormalizedTrade.
// ============================================================
export interface OptionsDetails {
  strikePrice: number;
  expirationDate: string;       // ISO date
  optionType: "CALL" | "PUT";
  contractMultiplier: number;   // typically 100
  underlyingTicker: string;
}

// ============================================================
// IMPORT BATCH: tracks each file upload as a unit
// ============================================================
export interface ImportBatch {
  batchId: string;              // UUID
  brokerId: string;             // "FIDELITY"
  fileName: string;             // original file name
  fileType: "CSV" | "PDF" | "XLSX";
  uploadedAt: string;           // ISO timestamp
  uploadedBy: string;           // user identifier
  totalTradesFound: number;     // how many trade rows were in the file
  totalTradesImported: number;  // how many passed validation
  skippedRows: SkippedRow[];    // anything we couldn't parse
  status: "PROCESSING" | "COMPLETE" | "FAILED";
}

export interface SkippedRow {
  rowIndex: number;
  rawData: string;
  reason: string;               // e.g. "JOURNAL_ENTRY", "MISSING_TICKER", "PARSE_ERROR"
}
