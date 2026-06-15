/**
 * TOS Account Statement → True Realized P/L Engine
 *
 * Parses TOS Account Statement CSVs and computes per-symbol realized P/L,
 * adjusting for the RAD (Received as Deposit) cost-basis issue where TOS
 * treats deposited positions as $0 cost.
 *
 * Formula per symbol:
 *   For non-RAD:  true_realized = tos_pnl_ytd - tos_pnl_open
 *   For RAD:      true_realized = tos_pnl_ytd - rad_original_cost - tos_pnl_open
 */

import { readFileSync } from "fs";

// ── CSV helpers ──────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseDollar(s: string): number {
  if (!s) return 0;
  const neg = s.includes("(");
  const cleaned = s.replace(/[\$,()]/g, "");
  const val = Number(cleaned);
  return isNaN(val) ? 0 : neg ? -val : val;
}

// ── Types ────────────────────────────────────────────────────────────

export interface TosSymbolPnl {
  symbol: string;
  pnlYtd: number;
  pnlOpen: number;
  trueRealized: number;
  radCostAdjustment: number;
}

export interface TosRadEntry {
  symbol: string;
  qty: number;
  date: string;
}

export interface TosAccountPnl {
  accountId: string;
  accountName: string;
  bySymbol: Map<string, TosSymbolPnl>;
  radEntries: TosRadEntry[];
  overallPnlYtd: number;
  netLiquidatingValue: number;
}

// ── RAD cost basis lookup ────────────────────────────────────────────
// Original cost basis for positions deposited via RAD into the Rollover IRA.
// These come from the RGL import (sentinel_trades entry_price) or the TOS
// Positions section Trade Price column.

const RAD_COST_BASIS: Record<string, number> = {
  DFIVX: 17.6674,
  LIT: 73.82991111111112,
  RGTZ: 26.32,
  GLW: 113.89408,
  VLO: 195.86533333333333,
  DSCGX: 22.9632,
  DFFVX: 25.0494,
  DFLVX: 39.8212,
};

const RAD_SHARES: Record<string, number> = {
  DFIVX: 955.359,
  LIT: 450,
  RGTZ: 600,
  GLW: 250,
  VLO: 250,
  DSCGX: 400,
  DFFVX: 403.511,
  DFLVX: 351.23,
};

// ── Parser ───────────────────────────────────────────────────────────

export function parseTosAccountStatement(filePath: string): TosAccountPnl {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");

  let accountId = "";
  let accountName = "";
  const header = lines[0] ?? "";
  const acctMatch = header.match(/Account Statement for (\S+)\s+\(([^)]+)\)/);
  if (acctMatch) {
    accountId = acctMatch[1]!;
    accountName = acctMatch[2]!;
  }

  const radEntries: TosRadEntry[] = [];
  const pnlBySymbol = new Map<string, { pnlYtd: number; pnlOpen: number }>();
  let overallPnlYtd = 0;
  let netLiquidatingValue = 0;

  // Pass 1: find RAD entries
  for (const line of lines) {
    const parts = parseCSVLine(line);
    if (parts[2] === "RAD") {
      const desc = parts[4] ?? "";
      const radMatch = desc.match(/(.+?)\s+([\d.]+)\s+(\S+)$/);
      if (radMatch) {
        radEntries.push({
          symbol: radMatch[3]!,
          qty: Number(radMatch[2]),
          date: parts[0]!,
        });
      }
    }
  }

  // Pass 2: parse Profits and Losses section
  let inPnl = false;
  let pnlHeaderSeen = false;
  for (const line of lines) {
    if (line.startsWith("Profits and Losses")) {
      inPnl = true;
      pnlHeaderSeen = false;
      continue;
    }
    if (inPnl && line.startsWith("Symbol,Description,P/L Open")) {
      pnlHeaderSeen = true;
      continue;
    }
    if (inPnl && pnlHeaderSeen) {
      if (line.trim() === "") break;
      const parts = parseCSVLine(line);
      if (parts[0] === "" && line.includes("OVERALL TOTALS")) {
        overallPnlYtd = parseDollar(parts[5] ?? "");
        break;
      }
      const sym = parts[0]?.trim();
      if (!sym) continue;
      pnlBySymbol.set(sym, {
        pnlYtd: parseDollar(parts[5] ?? ""),
        pnlOpen: parseDollar(parts[2] ?? ""),
      });
    }

    // Also grab Net Liquidating Value
    if (line.startsWith("Net Liquidating Value")) {
      const parts = parseCSVLine(line);
      netLiquidatingValue = parseDollar(parts[1] ?? "");
    }
  }

  // Compute true realized per symbol
  const isIRA = accountName.toLowerCase().includes("rollover") || accountName.toLowerCase().includes("ira");
  const radSymbols = new Set(radEntries.map((r) => r.symbol));

  const bySymbol = new Map<string, TosSymbolPnl>();
  for (const [sym, data] of pnlBySymbol) {
    let radCostAdjustment = 0;
    if (isIRA && radSymbols.has(sym)) {
      const costPerShare = RAD_COST_BASIS[sym];
      const shares = RAD_SHARES[sym];
      if (costPerShare != null && shares != null) {
        radCostAdjustment = costPerShare * shares;
      }
    }
    const trueRealized = data.pnlYtd - radCostAdjustment - data.pnlOpen;
    bySymbol.set(sym, {
      symbol: sym,
      pnlYtd: data.pnlYtd,
      pnlOpen: data.pnlOpen,
      trueRealized,
      radCostAdjustment,
    });
  }

  return {
    accountId,
    accountName,
    bySymbol,
    radEntries,
    overallPnlYtd,
    netLiquidatingValue,
  };
}

// ── Combine two accounts ─────────────────────────────────────────────

export interface CombinedSchwabPnl {
  bySymbol: Map<string, TosSymbolPnl>;
  totalTrueRealized: number;
  totalPnlOpen: number;
  totalTruePnlYtd: number;
}

export function combineSchwabAccounts(accounts: TosAccountPnl[]): CombinedSchwabPnl {
  const combined = new Map<string, TosSymbolPnl>();

  for (const acct of accounts) {
    for (const [sym, data] of acct.bySymbol) {
      const existing = combined.get(sym);
      if (existing) {
        combined.set(sym, {
          symbol: sym,
          pnlYtd: existing.pnlYtd + data.pnlYtd,
          pnlOpen: existing.pnlOpen + data.pnlOpen,
          trueRealized: existing.trueRealized + data.trueRealized,
          radCostAdjustment: existing.radCostAdjustment + data.radCostAdjustment,
        });
      } else {
        combined.set(sym, { ...data });
      }
    }
  }

  let totalTrueRealized = 0;
  let totalPnlOpen = 0;
  let totalTruePnlYtd = 0;
  for (const data of combined.values()) {
    totalTrueRealized += data.trueRealized;
    totalPnlOpen += data.pnlOpen;
    totalTruePnlYtd += data.pnlYtd - data.radCostAdjustment;
  }

  return { bySymbol: combined, totalTrueRealized, totalPnlOpen, totalTruePnlYtd };
}
