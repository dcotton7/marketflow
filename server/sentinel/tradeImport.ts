import { v4 as uuidv4 } from "uuid";
import { detectFidelityCsvType, parseFidelityCashBalance } from "@shared/fidelity-csv";
import {
  detectSchwabCsvType,
  describeSchwabRglParseFailure,
  parseSchwabRealizedGainLossLots,
} from "@shared/schwab-csv";

export type AssetType = "STOCK" | "ETF" | "MUTUAL_FUND" | "OPTIONS" | "CRYPTO";
export type TradeDirection = "BUY" | "SELL";
export type TimestampSource = "BROKER_PROVIDED" | "ESTIMATED_OPEN" | "ESTIMATED_CLOSE" | "PDF_CONFIRMATION" | "UNKNOWN";
export type TradeStatus = "CONFIRMED" | "PENDING" | "CANCELLED" | "REJECTED";
export type AccountType = "CASH" | "MARGIN" | "IRA" | "ROTH_IRA" | "TAXABLE";

export interface NormalizedTrade {
  tradeId: string;
  brokerId: string;
  brokerOrderId: string | null;
  importBatchId: string;
  ticker: string;
  assetType: AssetType;
  direction: TradeDirection;
  quantity: number;
  price: number;
  totalAmount: number;
  commission: number;
  fees: number;
  netAmount: number;
  tradeDate: string;
  settlementDate: string | null;
  executionTime: string | null;
  timestampSource: TimestampSource;
  isTimeEstimated: boolean;
  accountId: string;
  accountName: string;
  accountType: AccountType;
  status: TradeStatus;
  isFill: boolean;
  fillGroupKey: string | null;
  cashBalance: number | null;
  rawSource: string;
  importedAt: string;
  importedBy: string;
}

export interface SkippedRow {
  rowIndex: number;
  rawData: string;
  reason: string;
}

export interface ImportBatch {
  batchId: string;
  brokerId: string;
  fileName: string;
  fileType: "CSV" | "PDF" | "XLSX";
  uploadedAt: string;
  uploadedBy: string;
  totalTradesFound: number;
  totalTradesImported: number;
  skippedRows: SkippedRow[];
  status: "PROCESSING" | "COMPLETE" | "FAILED";
}

export interface ParseResult {
  batch: ImportBatch;
  trades: NormalizedTrade[];
}

function parseCSVRow(row: string): string[] {
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

const NON_TRADE_PATTERNS = [
  /^JOURNALED/i,
  /^TOTALS/i,
  /^DISCLOSURE/i,
  /^The data and information/i,
  /^Brokerage services/i,
  /^Both are Fidelity/i,
];

const KNOWN_MUTUAL_FUNDS = new Set(["DUSLX", "DSCGX"]);

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

function extractOrderId(description: string): string | null {
  const match = description.match(/^YOU (?:BOUGHT|SOLD)\s+([A-Z0-9]{8,})/i);
  return match ? match[1] : null;
}

function parseDirection(description: string): TradeDirection | null {
  if (/YOU BOUGHT/i.test(description)) return "BUY";
  if (/YOU SOLD/i.test(description))   return "SELL";
  return null;
}

function parseAccountType(typeCol: string, accountName: string): AccountType {
  const isIRA = /IRA/i.test(accountName);
  const isRoth = /ROTH/i.test(accountName);
  if (isRoth) return "ROTH_IRA";
  if (isIRA)  return "IRA";
  if (/margin/i.test(typeCol)) return "MARGIN";
  return "CASH";
}

function detectAssetType(ticker: string): AssetType {
  if (KNOWN_MUTUAL_FUNDS.has(ticker.toUpperCase())) return "MUTUAL_FUND";
  return "STOCK";
}

function buildFillGroupKey(tradeDate: string, ticker: string, direction: TradeDirection): string {
  return `${tradeDate}_${ticker}_${direction}`;
}

function buildTimestampFields(tradeDate: string): {
  executionTime: string;
  timestampSource: TimestampSource;
  isTimeEstimated: boolean;
} {
  const executionTime = `${tradeDate}T09:30:00-05:00`;
  return {
    executionTime,
    timestampSource: "ESTIMATED_OPEN",
    isTimeEstimated: true,
  };
}

export function parseFidelityCSV(
  csvContent: string,
  fileName: string,
  importedBy: string
): ParseResult {
  const batchId = uuidv4();
  const importedAt = new Date().toISOString();
  const skippedRows: SkippedRow[] = [];
  const trades: NormalizedTrade[] = [];

  const lines = csvContent
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("Date,Description,Symbol")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    const wrongType = detectFidelityCsvType(csvContent);
    const wrongTypeReason =
      wrongType === "CLOSED_POSITIONS"
        ? "WRONG_FILE_TYPE: Closed Positions — use Upload bundle with Activity + Closed Positions together"
        : wrongType === "ORDERS"
          ? "WRONG_FILE_TYPE: Orders — attach after Activity import via bundle or Orders tab"
          : "HEADER_NOT_FOUND";
    return {
      batch: {
        batchId,
        brokerId: "FIDELITY",
        fileName,
        fileType: "CSV",
        uploadedAt: importedAt,
        uploadedBy: importedBy,
        totalTradesFound: 0,
        totalTradesImported: 0,
        skippedRows: [{ rowIndex: 0, rawData: "N/A", reason: wrongTypeReason }],
        status: "FAILED",
      },
      trades: [],
    };
  }

  const metaBlock = lines.slice(0, headerIndex).join(" ");
  const accountMatch = metaBlock.match(/(\S+\s+\S+.*?)\s*\*(\d+)/);
  const accountName = accountMatch ? accountMatch[1].replace(/"/g, "").trim() : "Unknown";
  const accountId = accountMatch ? accountMatch[2] : "0000";

  const dataRows = lines.slice(headerIndex + 1);

  for (let i = 0; i < dataRows.length; i++) {
    const rawRow = dataRows[i];

    const isNonTrade = NON_TRADE_PATTERNS.some(p => p.test(rawRow));
    if (isNonTrade) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "NON_TRADE_ROW" });
      continue;
    }

    if (rawRow.startsWith(",Totals") || rawRow.startsWith(",")) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "FOOTER_OR_EMPTY" });
      continue;
    }

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
      cashBalanceRaw,
      commissionRaw,
      feesRaw,
      accountCol,
      settlementRaw,
      typeCol,
    ] = cols;

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

    const tradeDate = parseFidelityDate(dateRaw);
    if (!tradeDate) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "INVALID_TRADE_DATE" });
      continue;
    }

    const settlementDate = settlementRaw.trim() === "--" ? null : parseFidelityDate(settlementRaw);

    const quantity = parseQuantity(quantityRaw);
    const price = parseAmount(priceRaw);
    const commission = parseAmount(commissionRaw);
    const fees = parseAmount(feesRaw);
    const totalAmount = quantity * price;
    const netAmount = parseAmount(amountRaw) || totalAmount - commission - fees;
    const cashBalance = parseFidelityCashBalance(cashBalanceRaw);

    const { executionTime, timestampSource, isTimeEstimated } = buildTimestampFields(tradeDate);

    const assetType = detectAssetType(ticker);
    const accountType = parseAccountType(typeCol, accountName);

    const status: TradeStatus = /processing/i.test(cashBalanceRaw) ? "PENDING" : "CONFIRMED";

    const trade: NormalizedTrade = {
      tradeId: uuidv4(),
      brokerId: "FIDELITY",
      brokerOrderId: extractOrderId(description),
      importBatchId: batchId,
      ticker: ticker.toUpperCase(),
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
      isFill: true,
      fillGroupKey: buildFillGroupKey(tradeDate, ticker.toUpperCase(), direction),
      cashBalance,
      rawSource: rawRow,
      importedAt,
      importedBy,
    };

    trades.push(trade);
  }

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

  const batch: ImportBatch = {
    batchId,
    brokerId: "FIDELITY",
    fileName,
    fileType: "CSV",
    uploadedAt: importedAt,
    uploadedBy: importedBy,
    totalTradesFound: dataRows.length,
    totalTradesImported: trades.length,
    skippedRows,
    status: "COMPLETE",
  };

  return { batch, trades };
}

const SCHWAB_NON_TRADE_ACTIONS = new Set([
  "deposit",
  "withdrawal",
  "ach transfer",
  "ach deposit",
  "dividend",
  "long term capital gain",
  "short term capital gain",
  "interest",
  "balance transfer",
  "transfer in",
  "transfer out",
  "shares in",
  "shares out",
  "stock split",
  "reverse split",
  "fee",
  "tax withholding",
  "journal",
  "wire funds",
  "wire received",
  "moneylink transfer",
  "reinvest shares",
  "reinvest dividend",
]);

function parseSchwabDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[1]}-${match[2]}`;
}

function parseSchwabDirection(action: string): TradeDirection | null {
  const lower = action.trim().toLowerCase();
  if (lower === "buy" || lower === "buy to open" || lower === "buy to cover") return "BUY";
  if (lower === "sell" || lower === "sell to close" || lower === "sell short") return "SELL";
  return null;
}

function isSchwabOptionSymbol(symbol: string): boolean {
  return /\d{1,2}\/\d{1,2}\/\d{4}/.test(symbol) || /\s[CP]$/i.test(symbol.trim());
}

function parseSchwabAccountType(metaBlock: string): AccountType {
  const lower = metaBlock.toLowerCase();
  if (/roth\s*ira/i.test(lower)) return "ROTH_IRA";
  if (/\bira\b/i.test(lower)) return "IRA";
  return "TAXABLE";
}

function parseSchwabAccountLabel(label: string): {
  accountId: string;
  accountName: string;
  accountType: AccountType;
} {
  const normalized = label.replace(/_/g, " ").trim();
  let accountType: AccountType = "TAXABLE";
  if (/roth\s*ira/i.test(normalized)) accountType = "ROTH_IRA";
  else if (/\bira\b/i.test(normalized)) accountType = "IRA";
  return {
    accountId: label.replace(/[^A-Za-z0-9]/g, "") || "0000",
    accountName: `Schwab ${normalized}`,
    accountType,
  };
}

function parseSchwabAccountFromCsv(csvContent: string, fileName: string): {
  accountId: string;
  accountName: string;
  accountType: AccountType;
} {
  const preview = csvContent.replace(/^\uFEFF/, "").split(/\r?\n/).slice(0, 3).join(" ");
  const metaMatch = preview.match(/for\s+([A-Za-z0-9_]+)\s+as of/i);
  if (metaMatch?.[1]) {
    return parseSchwabAccountLabel(metaMatch[1]);
  }

  const lower = fileName.toLowerCase();
  if (/rollover_ira|roth_ira|_ira_/i.test(lower)) {
    const label = /roth/i.test(lower) ? "Roth IRA" : "Rollover IRA";
    return parseSchwabAccountLabel(label.replace(/\s/g, "_"));
  }

  const acctMatch = fileName.match(/_(\d{4})(?:\.csv)?$/i);
  const accountSuffix = acctMatch?.[1] || "0000";
  return {
    accountId: accountSuffix,
    accountName: `Schwab *${accountSuffix}`,
    accountType: /\bira\b/i.test(lower) ? "IRA" : "TAXABLE",
  };
}

function buildSchwabTrade(
  batchId: string,
  importedAt: string,
  importedBy: string,
  accountId: string,
  accountName: string,
  accountType: AccountType,
  rawRow: string,
  ticker: string,
  direction: TradeDirection,
  quantity: number,
  price: number,
  totalAmount: number,
  tradeDate: string
): NormalizedTrade {
  const { executionTime, timestampSource, isTimeEstimated } = buildTimestampFields(tradeDate);
  return {
    tradeId: uuidv4(),
    brokerId: "SCHWAB",
    brokerOrderId: null,
    importBatchId: batchId,
    ticker,
    assetType: detectAssetType(ticker),
    direction,
    quantity,
    price,
    totalAmount,
    commission: 0,
    fees: 0,
    netAmount: totalAmount,
    tradeDate,
    settlementDate: null,
    executionTime,
    timestampSource,
    isTimeEstimated,
    accountId,
    accountName,
    accountType,
    status: "CONFIRMED",
    isFill: true,
    fillGroupKey: buildFillGroupKey(tradeDate, ticker, direction),
    cashBalance: null,
    rawSource: rawRow,
    importedAt,
    importedBy,
  };
}

export function parseSchwabRealizedGainLossCSV(
  csvContent: string,
  fileName: string,
  importedBy: string
): ParseResult {
  const batchId = uuidv4();
  const importedAt = new Date().toISOString();
  const skippedRows: SkippedRow[] = [];
  const trades: NormalizedTrade[] = [];
  const lots = parseSchwabRealizedGainLossLots(csvContent);
  const { accountId, accountName, accountType } = parseSchwabAccountFromCsv(csvContent, fileName);

  if (lots.length === 0) {
    return {
      batch: {
        batchId,
        brokerId: "SCHWAB",
        fileName,
        fileType: "CSV",
        uploadedAt: importedAt,
        uploadedBy: importedBy,
        totalTradesFound: 0,
        totalTradesImported: 0,
        skippedRows: [{
          rowIndex: 0,
          rawData: "N/A",
          reason: `HEADER_NOT_FOUND: ${describeSchwabRglParseFailure(csvContent)}`,
        }],
        status: "FAILED",
      },
      trades: [],
    };
  }

  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i]!;
    const rawRow = `${lot.symbol},${lot.quantity},${lot.acquiredDate ?? ""},${lot.soldDate},${lot.costBasis},${lot.proceeds}`;

    if (isSchwabOptionSymbol(lot.symbol)) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "OPTIONS_NOT_SUPPORTED" });
      continue;
    }

    if (lot.acquiredDate && lot.costBasis > 0) {
      const buyPrice = lot.costBasis / lot.quantity;
      trades.push(
        buildSchwabTrade(
          batchId,
          importedAt,
          importedBy,
          accountId,
          accountName,
          accountType,
          rawRow,
          lot.symbol,
          "BUY",
          lot.quantity,
          buyPrice,
          lot.costBasis,
          lot.acquiredDate
        )
      );
    }

    const sellTotal = lot.proceeds > 0 ? lot.proceeds : lot.costBasis;
    const sellPrice = sellTotal / lot.quantity;
    trades.push(
      buildSchwabTrade(
        batchId,
        importedAt,
        importedBy,
        accountId,
        accountName,
        accountType,
        rawRow,
        lot.symbol,
        "SELL",
        lot.quantity,
        sellPrice,
        sellTotal,
        lot.soldDate
      )
    );
  }

  const fillCounts = new Map<string, number>();
  trades.forEach((t) => {
    if (t.fillGroupKey) {
      fillCounts.set(t.fillGroupKey, (fillCounts.get(t.fillGroupKey) || 0) + 1);
    }
  });
  trades.forEach((t) => {
    if (t.fillGroupKey && fillCounts.get(t.fillGroupKey) === 1) {
      t.isFill = false;
    }
  });

  return {
    batch: {
      batchId,
      brokerId: "SCHWAB",
      fileName,
      fileType: "CSV",
      uploadedAt: importedAt,
      uploadedBy: importedBy,
      totalTradesFound: lots.length,
      totalTradesImported: trades.length,
      skippedRows,
      status: trades.length > 0 ? "COMPLETE" : "FAILED",
    },
    trades,
  };
}

export function parseSchwabCSV(
  csvContent: string,
  fileName: string,
  importedBy: string
): ParseResult {
  const batchId = uuidv4();
  const importedAt = new Date().toISOString();
  const skippedRows: SkippedRow[] = [];
  const trades: NormalizedTrade[] = [];

  const lines = csvContent
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith("Date,Action,Symbol")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    const wrongType = detectSchwabCsvType(csvContent);
    const wrongTypeReason =
      wrongType === "REALIZED_GAIN_LOSS"
        ? "WRONG_FILE_TYPE: Realized Gain/Loss — drop with Transactions on Upload, not alone"
        : "HEADER_NOT_FOUND";
    return {
      batch: {
        batchId,
        brokerId: "SCHWAB",
        fileName,
        fileType: "CSV",
        uploadedAt: importedAt,
        uploadedBy: importedBy,
        totalTradesFound: 0,
        totalTradesImported: 0,
        skippedRows: [{ rowIndex: 0, rawData: "N/A", reason: wrongTypeReason }],
        status: "FAILED",
      },
      trades: [],
    };
  }

  const metaBlock = lines.slice(0, headerIndex).join(" ");
  const acctMatch = metaBlock.match(/account\s+([A-Z0-9*X-]+)/i);
  const accountIdRaw = acctMatch ? acctMatch[1]!.replace(/\*/g, "X") : "0000";
  const accountId = accountIdRaw.replace(/[^A-Z0-9-]/gi, "") || "0000";
  const accountSuffix = accountId.replace(/[^0-9]/g, "").slice(-4) || accountId;
  const accountName = `Schwab *${accountSuffix}`;
  const accountType = parseSchwabAccountType(metaBlock);

  const dataRows = lines.slice(headerIndex + 1);

  for (let i = 0; i < dataRows.length; i++) {
    const rawRow = dataRows[i]!;

    if (!rawRow || rawRow.startsWith("Total") || rawRow.startsWith("Notes")) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "FOOTER_OR_EMPTY" });
      continue;
    }

    const cols = parseCSVRow(rawRow);
    if (cols.length < 8) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "INSUFFICIENT_COLUMNS" });
      continue;
    }

    const [dateRaw, actionRaw, symbolRaw, , quantityRaw, priceRaw, feesRaw, amountRaw] = cols;
    const actionLower = actionRaw.trim().toLowerCase();

    if (SCHWAB_NON_TRADE_ACTIONS.has(actionLower)) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "NON_TRADE_ACTION" });
      continue;
    }

    const ticker = symbolRaw.trim().toUpperCase();
    if (!ticker) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "MISSING_TICKER" });
      continue;
    }

    if (isSchwabOptionSymbol(ticker)) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "OPTIONS_NOT_SUPPORTED" });
      continue;
    }

    const direction = parseSchwabDirection(actionRaw);
    if (!direction) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "UNKNOWN_ACTION" });
      continue;
    }

    const tradeDate = parseSchwabDate(dateRaw);
    if (!tradeDate) {
      skippedRows.push({ rowIndex: i, rawData: rawRow, reason: "INVALID_TRADE_DATE" });
      continue;
    }

    const quantity = parseQuantity(quantityRaw);
    const price = parseAmount(priceRaw);
    const fees = parseAmount(feesRaw);
    const totalAmount = quantity * price;
    const netAmount = parseAmount(amountRaw) || totalAmount - fees;

    const { executionTime, timestampSource, isTimeEstimated } = buildTimestampFields(tradeDate);
    const assetType = detectAssetType(ticker);

    const trade: NormalizedTrade = {
      tradeId: uuidv4(),
      brokerId: "SCHWAB",
      brokerOrderId: null,
      importBatchId: batchId,
      ticker,
      assetType,
      direction,
      quantity,
      price,
      totalAmount,
      commission: 0,
      fees,
      netAmount,
      tradeDate,
      settlementDate: null,
      executionTime,
      timestampSource,
      isTimeEstimated,
      accountId,
      accountName,
      accountType,
      status: "CONFIRMED",
      isFill: true,
      fillGroupKey: buildFillGroupKey(tradeDate, ticker, direction),
      cashBalance: null,
      rawSource: rawRow,
      importedAt,
      importedBy,
    };

    trades.push(trade);
  }

  const fillCounts = new Map<string, number>();
  trades.forEach((t) => {
    if (t.fillGroupKey) {
      fillCounts.set(t.fillGroupKey, (fillCounts.get(t.fillGroupKey) || 0) + 1);
    }
  });
  trades.forEach((t) => {
    if (t.fillGroupKey && fillCounts.get(t.fillGroupKey) === 1) {
      t.isFill = false;
    }
  });

  const batch: ImportBatch = {
    batchId,
    brokerId: "SCHWAB",
    fileName,
    fileType: "CSV",
    uploadedAt: importedAt,
    uploadedBy: importedBy,
    totalTradesFound: dataRows.length,
    totalTradesImported: trades.length,
    skippedRows,
    status: "COMPLETE",
  };

  return { batch, trades };
}

export type BrokerId = "FIDELITY" | "SCHWAB" | "ROBINHOOD" | "UNKNOWN";

function normalizeBrokerId(brokerId?: string): BrokerId | undefined {
  if (!brokerId) return undefined;
  const upper = brokerId.toUpperCase();
  if (upper === "FIDELITY" || upper === "SCHWAB" || upper === "ROBINHOOD") return upper;
  return undefined;
}

export function detectBroker(csvContent: string): BrokerId {
  if (csvContent.includes("Date,Description,Symbol,Quantity,Price,Amount,Cash Balance")) {
    return "FIDELITY";
  }
  if (/Date,Action,Symbol,Description,Quantity,Price,Fees/i.test(csvContent)) {
    return "SCHWAB";
  }
  if (csvContent.includes("TRANSACTIONS FOR ACCOUNT")) {
    return "SCHWAB";
  }
  if (csvContent.includes("Date,Symbol,Type,Side,Price,Quantity")) {
    return "ROBINHOOD";
  }
  return "UNKNOWN";
}

export function parseCSV(
  csvContent: string,
  fileName: string,
  importedBy: string,
  brokerId?: BrokerId | string
): ParseResult {
  const detectedBroker = normalizeBrokerId(brokerId) || detectBroker(csvContent);
  
  switch (detectedBroker) {
    case "FIDELITY":
      return parseFidelityCSV(csvContent, fileName, importedBy);
    case "SCHWAB": {
      const schwabType = detectSchwabCsvType(csvContent);
      if (schwabType === "REALIZED_GAIN_LOSS") {
        return parseSchwabRealizedGainLossCSV(csvContent, fileName, importedBy);
      }
      return parseSchwabCSV(csvContent, fileName, importedBy);
    }
    default:
      return {
        batch: {
          batchId: uuidv4(),
          brokerId: detectedBroker,
          fileName,
          fileType: "CSV",
          uploadedAt: new Date().toISOString(),
          uploadedBy: importedBy,
          totalTradesFound: 0,
          totalTradesImported: 0,
          skippedRows: [{ rowIndex: 0, rawData: "N/A", reason: `UNSUPPORTED_BROKER: ${detectedBroker}` }],
          status: "FAILED",
        },
        trades: [],
      };
  }
}
