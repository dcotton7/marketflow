export interface ImportWorkflowStep {
  order: number;
  /** Exact name as shown in Fidelity's download/export list */
  fidelityExport: string | null;
  downloadedAs: string | null;
  firstLine: string | null;
  headerRow: string | null;
  tab: string;
  action: string;
  required: boolean;
  skipWhen?: string;
  neverDo?: string;
  problems: string[];
}

export interface BrokerImportGuide {
  brokerId: string;
  label: string;
  supported: boolean;
  summary: string;
  steps: ImportWorkflowStep[];
}

const FIDELITY_WORKFLOW: ImportWorkflowStep[] = [
  {
    order: 1,
    fidelityExport: "Activity",
    downloadedAs: "Activity_{account}.csv  (e.g. Activity_2_DC_Rollover_IRA__4915.csv)",
    firstLine: '"Activity',
    headerRow: "Date,Description,Symbol,Quantity,Price,Amount,Cash Balance,Commission,Fees,Account,Settlement Date,Type",
    tab: "Upload (drop with other CSVs)",
    action: "Required. Drop on Upload → Run Smart Import. Re-export with overlapping dates anytime — only new transactions are added.",
    required: true,
    neverDo: "Do not upload Closed Positions or Orders on this tab.",
    problems: [
      "0 trades / FAILED — wrong file. You uploaded Closed Positions or Orders. Only Activity works here.",
      "0 new trades — entire file overlapped prior imports; that is normal for incremental updates.",
      "Orphan sells later — your Activity date range starts after the buy. Re-export Activity with an earlier start date.",
      "Skipped rows — JOURNALED / transfer lines are ignored. YOU BOUGHT and YOU SOLD rows are what import.",
    ],
  },
  {
    order: 2,
    fidelityExport: null,
    downloadedAs: null,
    firstLine: null,
    headerRow: null,
    tab: "History",
    action: "Resolve Duplicates (if batch shows a duplicate count), then Promote to Trading Cards.",
    required: true,
    skipWhen: "Duplicates step: skip if duplicate count is 0.",
    problems: [
      "Promote button disabled — clear pending duplicates (step 2) and orphans (step 3) first.",
    ],
  },
  {
    order: 3,
    fidelityExport: "Closed Positions",
    downloadedAs: "Closed_Positions_{account}.csv  or  Closed_Positions_All_Accounts_{MMDDYYYY}.csv",
    firstLine: '"Closed Positions',
    headerRow: "Symbol,Description,Quantity,$ Cost,$ Proceeds,$ Short-term G/L,$ Long-term G/L,$ Total G/L,Avg Cost,Avg Proceeds,Last,Account",
    tab: "Upload (drop with Activity)",
    action: "Drop with Activity → Smart Import auto-applies Avg Cost to orphan sells. Manual fix remains in Orphans tab if any unmatched.",
    required: false,
    neverDo: "Never upload Closed Positions on the Upload tab — it will show 0 trades.",
    skipWhen: "Skip entirely if History shows 0 orphan sells after Activity import.",
    problems: [
      "Orphan = a YOU SOLD in Activity with no YOU BOUGHT before it in your imported files.",
      "Fix without this file: re-import Activity with a wider date range so the buy is included.",
      "Avg Cost matched but wrong open date — edit open date per row before saving.",
    ],
  },
  {
    order: 4,
    fidelityExport: "Orders",
    downloadedAs: "Orders_All_Accounts_{n}.csv  (e.g. Orders_All_Accounts_1.csv)",
    firstLine: '"Orders',
    headerRow: "Symbol,Action,Amount,Order Type,Status,Filled,Last,$ Chg,% Chg,Bid,Mid,Ask,TIF,Conditions,Destination,Order Time,Account,…",
    tab: "Orders (after Promote in History)",
    action: "Upload Orders CSV on the Orders tab after trading cards exist. Attaches open stop-loss and limit targets.",
    required: false,
    neverDo: "Orders alone on Upload will not import trades — always include Activity.",
    skipWhen: "Skip if you do not want stops/targets synced, or you have no open positions.",
    problems: [
      "No matches — card must already exist from Promote and symbol + account must match.",
      "Row skipped — Status is Filled, Cancelled, Expired, or Rejected (only Open orders import).",
      "Only Stop loss at $… and Limit at $… order types are parsed.",
    ],
  },
];

export const BROKER_IMPORT_GUIDES: Record<string, BrokerImportGuide> = {
  FIDELITY: {
    brokerId: "FIDELITY",
    label: "Fidelity",
    supported: true,
    summary:
      "Drop Activity + Closed Positions (+ Orders for later). Run Smart Import, then History → Promote to Trading Cards, then Orders tab.",
    steps: FIDELITY_WORKFLOW,
  },
  SCHWAB: {
    brokerId: "SCHWAB",
    label: "Charles Schwab",
    supported: true,
    summary:
      "Drop Transactions or Realized Gain/Loss CSV. Run Smart Import, then History → Promote to Trading Cards.",
    steps: [
      {
        order: 1,
        fidelityExport: "Transactions",
        downloadedAs: "History_Transactions_{account}.csv",
        firstLine: "Transactions for account",
        headerRow: "Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount",
        tab: "Upload (drop with other CSVs)",
        action:
          "Best for full history. Schwab.com → Accounts → History → Export → Transactions. Drop on Upload → Run Smart Import. Re-export overlapping dates anytime — only new rows are added.",
        required: false,
        problems: [
          "0 trades / FAILED — wrong file or not a Transactions export.",
          "0 new trades — entire file overlapped prior imports; normal for incremental updates.",
          "Orphan sells — your export starts after the buy. Re-export with an earlier start date.",
          "Skipped rows — deposits, dividends, splits, and options rows are ignored.",
        ],
      },
      {
        order: 2,
        fidelityExport: null,
        downloadedAs: null,
        firstLine: null,
        headerRow: null,
        tab: "History",
        action: "Resolve Duplicates (if any), then Promote to Trading Cards.",
        required: true,
        skipWhen: "Duplicates step: skip if duplicate count is 0.",
        problems: [
          "Promote button disabled — clear pending duplicates and orphans first.",
        ],
      },
      {
        order: 3,
        fidelityExport: "Realized Gain/Loss",
        downloadedAs: "Schwab_IRA_Realized_Gain_and_Loss_Details_{account}.csv",
        firstLine: "Realized Gain",
        headerRow: "Symbol,Quantity,Closed Date,Proceeds,Cost Basis (CB),Gain/Loss ($)",
        tab: "Upload",
        action:
          "Works alone for closed trades. Accounts → History → Realized Gain/Loss → Export. Smart Import creates buy + sell pairs per closed lot. Add Transactions CSV for open positions, buys still held, and cash.",
        required: false,
        skipWhen: "Use Transactions instead when you need open positions or full activity.",
        problems: [
          "0 trades — widen date range or confirm Symbol / Date Sold columns are present.",
          "Missing buys — Date Acquired shows Various; sell still imports, resolve in Orphans if needed.",
          "With Transactions — drop both; Transactions imports activity, Realized Gain/Loss resolves orphan cost basis.",
        ],
      },
    ],
  },
  ROBINHOOD: {
    brokerId: "ROBINHOOD",
    label: "Robinhood",
    supported: false,
    summary: "Robinhood import not enabled. Use Fidelity for now.",
    steps: [],
  },
};

export function getBrokerImportGuide(brokerId: string): BrokerImportGuide | null {
  return BROKER_IMPORT_GUIDES[brokerId] ?? null;
}
