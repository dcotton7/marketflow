export type FidelityCsvType = "ACTIVITY" | "CLOSED_POSITIONS" | "ORDERS" | "UNKNOWN";

export const FIDELITY_CSV_LABELS: Record<FidelityCsvType, string> = {
  ACTIVITY: "Activity",
  CLOSED_POSITIONS: "Closed Positions",
  ORDERS: "Orders",
  UNKNOWN: "Unknown",
};

export function detectFidelityCsvType(csvContent: string): FidelityCsvType {
  const text = csvContent.replace(/^\uFEFF/, "");
  if (text.includes("Date,Description,Symbol,Quantity,Price,Amount,Cash Balance")) {
    return "ACTIVITY";
  }
  if (text.includes("Symbol,Description,Quantity,$ Cost,$ Proceeds")) {
    return "CLOSED_POSITIONS";
  }
  if (text.includes("Symbol,Action,Amount,Order Type,Status")) {
    return "ORDERS";
  }
  return "UNKNOWN";
}

export function parseFidelityClosedPositionsAvgCost(csvText: string): Record<string, number> {
  const cleaned = csvText.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/);
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("Symbol,Description,")) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) return {};

  const result: Record<string, number> = {};
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("Totals") || line.startsWith("Disclosure") || line.startsWith('"')) break;

    const parts: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '"') {
        inQuotes = !inQuotes;
      } else if (line[c] === "," && !inQuotes) {
        parts.push(current);
        current = "";
      } else {
        current += line[c];
      }
    }
    parts.push(current);

    const symbol = parts[0]?.trim();
    const avgCostStr = parts[8]?.trim().replace(/,/g, "");
    if (symbol && avgCostStr) {
      const avgCost = parseFloat(avgCostStr);
      if (!isNaN(avgCost) && avgCost > 0) {
        result[symbol.toUpperCase()] = avgCost;
      }
    }
  }
  return result;
}

/** Estimate open date for orphan cost basis when only sell date is known. */
export function calculateSyntheticOpenDate(sellDateStr: string): string {
  const dateOnly = sellDateStr.substring(0, 10);
  const sellDate = new Date(dateOnly + "T12:00:00");
  const year = sellDate.getFullYear();
  const janFirst = new Date(year, 0, 1, 12, 0, 0);

  let current = new Date(sellDate);
  let tradingDaysBack = 0;

  while (tradingDaysBack < 10) {
    current.setDate(current.getDate() - 1);
    if (current <= janFirst) {
      const jan1 = new Date(year, 0, 1, 12, 0, 0);
      const dow = jan1.getDay();
      if (dow === 0) jan1.setDate(2);
      else if (dow === 6) jan1.setDate(3);
      const mm = String(jan1.getMonth() + 1).padStart(2, "0");
      const dd = String(jan1.getDate()).padStart(2, "0");
      return `${year}-${mm}-${dd}`;
    }
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      tradingDaysBack++;
    }
  }

  const mm = String(current.getMonth() + 1).padStart(2, "0");
  const dd = String(current.getDate()).padStart(2, "0");
  return `${current.getFullYear()}-${mm}-${dd}`;
}

/** Parse Fidelity Activity "Cash Balance" cell; returns null for Processing / empty. */
export function parseFidelityCashBalance(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || /--/i.test(trimmed) || /processing/i.test(trimmed)) return null;
  const cleaned = trimmed.replace(/[",\s]/g, "").replace(/^\$/, "");
  if (!cleaned) return null;
  const negative = cleaned.startsWith("-") || cleaned.startsWith("(");
  const num = parseFloat(cleaned.replace(/^[+]/, "").replace(/[()]/g, ""));
  if (Number.isNaN(num)) return null;
  return negative ? -Math.abs(num) : num;
}

function parseActivityCsvRow(row: string): string[] {
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

/** Read cash balance from a stored Activity CSV row (column 7). */
export function cashBalanceFromActivityRawRow(rawSource: string | null | undefined): number | null {
  if (!rawSource?.trim()) return null;
  const cols = parseActivityCsvRow(rawSource);
  if (cols.length < 7) return null;
  return parseFidelityCashBalance(cols[6] ?? "");
}
