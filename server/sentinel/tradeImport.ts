import { v4 as uuidv4 } from "uuid";

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
        skippedRows: [{ rowIndex: 0, rawData: "N/A", reason: "HEADER_NOT_FOUND" }],
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
      ,
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
    const netAmount = totalAmount - commission - fees;

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

export type BrokerId = "FIDELITY" | "SCHWAB" | "ROBINHOOD" | "UNKNOWN";

export function detectBroker(csvContent: string): BrokerId {
  if (csvContent.includes("Date,Description,Symbol,Quantity,Price,Amount,Cash Balance")) {
    return "FIDELITY";
  }
  if (csvContent.includes("Date,Action,Symbol,Description,Quantity,Price,Fees")) {
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
  brokerId?: BrokerId
): ParseResult {
  const detectedBroker = brokerId || detectBroker(csvContent);
  
  switch (detectedBroker) {
    case "FIDELITY":
      return parseFidelityCSV(csvContent, fileName, importedBy);
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
