export const INFOPOP_CHANNEL = "infopop-channel";
export const INFOPOP_STORAGE_KEY = "infopop-active";
export const INFOPOP_WINDOW_NAME = "InfoPop";

export type InfoPopMessage =
  | { type: "INFOPOP_OPENED" }
  | { type: "INFOPOP_CLOSED" }
  | { type: "INFOPOP_DOCK_REQUEST" }
  | { type: "INFOPOP_NAVIGATE"; path: string };
