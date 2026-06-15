/**
 * Parser for TOS (Thinkorswim) Account Statement CSV exports.
 *
 * Extracts:
 *  - Account metadata (id, name, date range)
 *  - Daily cash balances (BAL lines from "Cash Balance" section)
 *  - Equity positions ("Equities" section)
 *  - Mutual fund / other positions ("Others" section)
 */

export interface TosAccountInfo {
  accountId: string;
  accountName: string;
  startDate: string;
  endDate: string;
}

export interface TosDailyCash {
  date: string; // YYYY-MM-DD
  cash: number;
}

export interface TosPosition {
  symbol: string;
  description: string;
  qty: number;
  tradePrice: number;
  mark: number;
  markValue: number;
}

export interface TosAccountStatement {
  account: TosAccountInfo;
  dailyCash: TosDailyCash[];
  equities: TosPosition[];
  others: TosPosition[];
  totalCash: number | null;
  netLiquidatingValue: number | null;
}

function parseTosDate(raw: string): string {
  const parts = raw.trim().split("/");
  if (parts.length !== 3) return raw;
  const [m, d, y] = parts;
  const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  return `${year}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

function parseTosAmount(raw: string): number {
  if (!raw || raw === "--") return 0;
  const cleaned = raw.replace(/["$,]/g, "").replace(/[()]/g, (c) => (c === "(" ? "-" : ""));
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : 0;
}

function parseHeaderDate(raw: string): string {
  const parts = raw.trim().split("/");
  if (parts.length !== 3) return raw;
  const [m, d, y] = parts;
  const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  return `${year}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

function smartCsvSplit(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseAccountHeader(line: string): TosAccountInfo | null {
  const match = line.match(
    /Account Statement for (\S+)\s+\(([^)]+)\)\s+since\s+(\S+)\s+through\s+(\S+)/
  );
  if (!match) return null;
  return {
    accountId: match[1]!,
    accountName: match[2]!.trim(),
    startDate: parseHeaderDate(match[3]!),
    endDate: parseHeaderDate(match[4]!),
  };
}

export function parseTosAccountStatement(csvContent: string): TosAccountStatement {
  const lines = csvContent.split(/\r?\n/);

  const account = parseAccountHeader(lines[0] ?? "") ?? {
    accountId: "UNKNOWN",
    accountName: "UNKNOWN",
    startDate: "",
    endDate: "",
  };

  const dailyCash: TosDailyCash[] = [];
  const equities: TosPosition[] = [];
  const others: TosPosition[] = [];
  let totalCash: number | null = null;
  let netLiquidatingValue: number | null = null;

  type Section = "cash" | "equities" | "others" | "profits" | "summary" | "skip";
  let section: Section = "skip";
  let sectionHeaderSeen = false;

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed) {
      section = "skip";
      sectionHeaderSeen = false;
      continue;
    }

    // Section transitions
    if (trimmed === "Cash Balance") {
      section = "cash";
      sectionHeaderSeen = false;
      continue;
    }
    if (trimmed === "Equities" || trimmed.startsWith("Equities")) {
      section = "equities";
      sectionHeaderSeen = false;
      continue;
    }
    if (trimmed === "Others") {
      section = "others";
      sectionHeaderSeen = false;
      continue;
    }
    if (trimmed === "Profits and Losses") {
      section = "profits";
      sectionHeaderSeen = false;
      continue;
    }
    if (trimmed === "Account Summary") {
      section = "summary";
      sectionHeaderSeen = false;
      continue;
    }
    if (
      trimmed.startsWith("Forex") ||
      trimmed.startsWith("Futures") ||
      trimmed.startsWith("Crypto") ||
      trimmed.startsWith("Account Order") ||
      trimmed.startsWith("Account Trade")
    ) {
      section = "skip";
      sectionHeaderSeen = false;
      continue;
    }

    // Total Cash line (standalone)
    const totalCashMatch = trimmed.match(/^"?Total Cash\s+\$?([\d,.]+)"?$/i);
    if (totalCashMatch) {
      totalCash = parseTosAmount(totalCashMatch[1]!);
      continue;
    }

    // Skip column headers
    if (trimmed.startsWith("DATE,TIME,TYPE") || trimmed.startsWith("Symbol,Description,")) {
      sectionHeaderSeen = true;
      continue;
    }
    // Skip OVERALL TOTALS rows
    if (trimmed.startsWith(",OVERALL TOTALS")) continue;

    // Parse per section
    if (section === "cash") {
      const fields = smartCsvSplit(raw);
      if (fields.length < 9) continue;
      const type = fields[2]?.trim();
      if (type !== "BAL") continue;
      // Skip futures BAL lines (have doubled date columns)
      if (fields[0] === fields[1]) continue;
      const date = parseTosDate(fields[0]!);
      const balance = parseTosAmount(fields[8]!);
      dailyCash.push({ date, cash: balance });
    }

    if (section === "equities" && sectionHeaderSeen) {
      const fields = smartCsvSplit(raw);
      if (fields.length < 6 || !fields[0]?.trim()) continue;
      equities.push({
        symbol: fields[0]!.trim(),
        description: fields[1]?.trim() ?? "",
        qty: Math.abs(parseTosAmount(fields[2]!)),
        tradePrice: parseTosAmount(fields[3]!),
        mark: parseTosAmount(fields[4]!),
        markValue: parseTosAmount(fields[5]!),
      });
    }

    if (section === "others" && sectionHeaderSeen) {
      const fields = smartCsvSplit(raw);
      if (fields.length < 6 || !fields[0]?.trim()) continue;
      others.push({
        symbol: fields[0]!.trim(),
        description: fields[1]?.trim() ?? "",
        qty: Math.abs(parseTosAmount(fields[2]!)),
        tradePrice: parseTosAmount(fields[3]!),
        mark: parseTosAmount(fields[4]!),
        markValue: parseTosAmount(fields[5]!),
      });
    }

    if (section === "summary") {
      if (trimmed.startsWith("Net Liquidating Value")) {
        const fields = smartCsvSplit(raw);
        if (fields.length >= 2) netLiquidatingValue = parseTosAmount(fields[1]!);
      }
    }
  }

  return { account, dailyCash, equities, others, totalCash, netLiquidatingValue };
}

/**
 * Map TOS account name to the account_name used in sentinel_trades.
 */
export function tosSchwabAccountName(tosAccountName: string): string {
  const lower = tosAccountName.toLowerCase();
  if (lower.includes("rollover")) return "Schwab Rollover IRA";
  if (lower.includes("designated") || lower.includes("benefi")) return "Schwab Designated Bene Individual";
  return `Schwab ${tosAccountName}`;
}
