// ---------------------------------------------------------------------------
// Scanner pop-out BroadcastChannel — shared types for main ↔ popout comms
// ---------------------------------------------------------------------------

export const SCANNER_POPOUT_CHANNEL = "scanner-popout-channel";
export const SCANNER_POPOUT_STORAGE_KEY = "scanner-popout-active";

export type ScannerPopoutMessage =
  | { type: "SCANNER_POPOUT_CLOSED" }
  | { type: "SCANNER_POPOUT_OPENED" }
  | { type: "SCANNER_DOCK_REQUEST" }
  | { type: "SCANNER_NAVIGATE"; path: string };
