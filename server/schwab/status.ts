import { connectionState, stateMessage, type ConnectionState } from "./auth";
import { isConfigured, type SchwabConfig } from "./config";
import type { SchwabConnection } from "./store";
import type { StreamState } from "./streamer";

export interface StreamView {
  state: StreamState;
  symbols: number;
  lastMessageAt: number | null;
  reconnects: number;
}

export interface SchwabHealth {
  enabled: boolean;
  configured: boolean;
  state: ConnectionState | "off" | "not_configured";
  message: string;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  refreshHoursLeft: number | null;
  stream: { state: StreamState; symbols: number; lastMessageAt: string | null; reconnects: number };
  lastQuoteAgeSec: number | null;
  realtime: boolean | null;
}

const iso = (v: number | null | undefined) => (v ? new Date(v).toISOString() : null);

/** /api/health/schwab: public, so states, times and counts only, never account data or tokens. */
export function buildHealth(input: {
  cfg: SchwabConfig;
  conn: SchwabConnection | null;
  stream: StreamView | null;
  lastQuoteAgeSec: number | null;
  realtime: boolean | null;
  now?: number;
}): SchwabHealth {
  const now = input.now ?? Date.now();
  const configured = isConfigured(input.cfg);
  const offStream = { state: "off" as StreamState, symbols: 0, lastMessageAt: null, reconnects: 0 };
  if (!input.cfg.enabled || !configured) {
    return {
      enabled: input.cfg.enabled, configured,
      state: input.cfg.enabled ? "not_configured" : "off",
      message: input.cfg.enabled ? "Schwab keys are not set on this server" : "Schwab link is off",
      accessExpiresAt: null, refreshExpiresAt: null, refreshHoursLeft: null, stream: offStream,
      lastQuoteAgeSec: null, realtime: null,
    };
  }
  const state = connectionState(input.conn, now);
  const live = state === "connected" || state === "expiring";
  const s = input.stream;
  return {
    enabled: true, configured: true, state, message: stateMessage(state, input.conn, now),
    accessExpiresAt: live ? iso(input.conn?.accessExpiresAt) : null,
    refreshExpiresAt: live ? iso(input.conn?.refreshExpiresAt) : null,
    refreshHoursLeft: live && input.conn?.refreshExpiresAt
      ? Math.max(0, Math.round(((input.conn.refreshExpiresAt - now) / 3_600_000) * 10) / 10) : null,
    stream: s && live ? { state: s.state, symbols: s.symbols, lastMessageAt: iso(s.lastMessageAt), reconnects: s.reconnects } : offStream,
    lastQuoteAgeSec: live ? input.lastQuoteAgeSec : null,
    realtime: live ? input.realtime : null,
  };
}
