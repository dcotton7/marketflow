import { detectFidelityCsvType, type FidelityCsvType } from "./fidelity-csv";
import { detectSchwabCsvType, type SchwabCsvType } from "./schwab-csv";

export type ImportBundleFileType =
  | FidelityCsvType
  | SchwabCsvType;

export const IMPORT_BUNDLE_LABELS: Record<ImportBundleFileType, string> = {
  ACTIVITY: "Activity",
  CLOSED_POSITIONS: "Closed Positions",
  ORDERS: "Orders",
  TRANSACTIONS: "Transactions",
  REALIZED_GAIN_LOSS: "Realized Gain/Loss",
  UNKNOWN: "Unknown",
};

export function detectImportBundleFileType(
  brokerId: string,
  csvContent: string
): ImportBundleFileType {
  if (brokerId === "SCHWAB") {
    return detectSchwabCsvType(csvContent);
  }
  return detectFidelityCsvType(csvContent);
}

/** Primary trade CSV required for Smart Import. */
export function primaryImportFileType(brokerId: string): ImportBundleFileType {
  return brokerId === "SCHWAB" ? "TRANSACTIONS" : "ACTIVITY";
}

/** Whether dropped files include enough to run Smart Import. */
export function bundleHasTradeFiles(
  brokerId: string,
  files: Array<{ type: ImportBundleFileType }>
): boolean {
  if (brokerId === "SCHWAB") {
    return files.some((f) => f.type === "TRANSACTIONS" || f.type === "REALIZED_GAIN_LOSS");
  }
  return files.some((f) => f.type === primaryImportFileType(brokerId));
}

/** Multi-broker drop zone: any file with a recognized trade CSV type. */
export function bundleHasAnyTradeFiles(
  files: Array<{ brokerId: string; type: ImportBundleFileType }>
): boolean {
  return files.some((f) => bundleHasTradeFiles(f.brokerId, [f]));
}

/** Optional CSV used to auto-resolve orphan sells. */
export function orphanCostBasisFileType(brokerId: string): ImportBundleFileType | null {
  if (brokerId === "SCHWAB") return "REALIZED_GAIN_LOSS";
  if (brokerId === "FIDELITY") return "CLOSED_POSITIONS";
  return null;
}

export function expectedBundleFileHint(brokerId: string): string {
  if (brokerId === "SCHWAB") {
    return "Transactions or Realized Gain/Loss CSV";
  }
  return "Activity, Closed Positions, or Orders CSV";
}

const IMPORT_BROKER_IDS = ["FIDELITY", "SCHWAB"] as const;

function schwabFileNameHint(fileName: string): ImportBundleFileType | null {
  const base = fileName.toLowerCase();
  if (/realized[_\s-]?details|realized[_\s-]?gain/i.test(base)) {
    return "REALIZED_GAIN_LOSS";
  }
  if (/history[_\s-]?transactions|transactions/i.test(base)) {
    return "TRANSACTIONS";
  }
  return null;
}

/** When the selected broker rejects a file, try other brokers / filename hints. */
export function detectCsvBrokerMismatch(
  selectedBrokerId: string,
  csvContent: string,
  fileName = ""
): { brokerId: string; fileType: ImportBundleFileType } | null {
  for (const brokerId of IMPORT_BROKER_IDS) {
    if (brokerId === selectedBrokerId) continue;
    const fileType = detectImportBundleFileType(brokerId, csvContent);
    if (fileType !== "UNKNOWN") {
      return { brokerId, fileType };
    }
  }

  const nameHint = schwabFileNameHint(fileName);
  if (nameHint && selectedBrokerId !== "SCHWAB") {
    return { brokerId: "SCHWAB", fileType: nameHint };
  }
  return null;
}

/** Auto-detect broker + file type (drop files from any supported broker). */
export function detectBrokerForCsv(
  csvContent: string,
  fileName = ""
): { brokerId: (typeof IMPORT_BROKER_IDS)[number]; fileType: ImportBundleFileType } | null {
  for (const brokerId of IMPORT_BROKER_IDS) {
    const fileType = detectImportBundleFileType(brokerId, csvContent);
    if (fileType !== "UNKNOWN") {
      return { brokerId, fileType };
    }
  }
  const nameHint = schwabFileNameHint(fileName);
  if (nameHint) {
    return { brokerId: "SCHWAB", fileType: nameHint };
  }
  return null;
}

export function formatUnrecognizedCsvMessage(
  fileName: string,
  selectedBrokerId: string,
  csvContent: string
): string {
  const mismatch = detectCsvBrokerMismatch(selectedBrokerId, csvContent, fileName);
  if (mismatch) {
    const brokerLabel = mismatch.brokerId === "SCHWAB" ? "Charles Schwab" : "Fidelity";
    const fileLabel = IMPORT_BUNDLE_LABELS[mismatch.fileType];
    if (mismatch.brokerId === "SCHWAB" && mismatch.fileType === "REALIZED_GAIN_LOSS") {
      return `${fileName} looks like a Schwab Realized Gain/Loss file. Select Charles Schwab in step 1, then drop again.`;
    }
    return `${fileName} looks like a ${brokerLabel} ${fileLabel} file. Select ${brokerLabel} in step 1, then drop again.`;
  }
  return `${fileName} — expected ${expectedBundleFileHint(selectedBrokerId)}.`;
}
