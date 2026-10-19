/**
 * Messaging between MarketFlow embed pages (/embed/*) and the app hosting them in an iframe (Anima Lab).
 * Only the hosts listed here may embed MarketFlow (see frame-ancestors in server/index.ts) or talk to it.
 */
export const EMBED_HOST_ORIGINS = ["http://localhost:8770", "http://127.0.0.1:8770"];

/** One mini chart as the host sees it; x/y/w/h are its place in the 12-column grid. */
export interface EmbedChart {
  symbol: string;
  interval?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export type HostMessage =
  | { type: "open-big"; symbol: string }
  | { type: "close-big" }
  | { type: "ready"; page: string }
  | { type: "charts-state"; charts: EmbedChart[] }
  | { type: "symbol"; symbol: string };

export type HostCommand =
  | { type: "set-symbol"; symbol: string }
  | { type: "set-charts"; charts: EmbedChart[]; add: boolean };

const SYMBOL_RX = /^[A-Za-z0-9.\-^/]{1,12}$/;
const MAX_CHARTS = 40;

export function hostOrigin(): string | null {
  if (window.parent === window) return null;
  const ancestor = window.location.ancestorOrigins?.[0];
  if (ancestor && EMBED_HOST_ORIGINS.includes(ancestor)) return ancestor;
  try {
    const ref = new URL(document.referrer).origin;
    if (EMBED_HOST_ORIGINS.includes(ref)) return ref;
  } catch {
    /* no referrer */
  }
  return null;
}

/** Returns false when not embedded by an allowed host. */
export function postToHost(msg: HostMessage): boolean {
  const origin = hostOrigin();
  if (!origin) return false;
  window.parent.postMessage({ source: "marketflow", ...msg }, origin);
  return true;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 10000 ? v : undefined);

function cleanCharts(raw: unknown): EmbedChart[] | null {
  if (!Array.isArray(raw)) return null;
  const out: EmbedChart[] = [];
  for (const c of raw.slice(0, MAX_CHARTS)) {
    const symbol = typeof c?.symbol === "string" ? c.symbol.trim().toUpperCase() : "";
    if (!SYMBOL_RX.test(symbol)) continue;
    out.push({
      symbol,
      interval: typeof c.interval === "string" ? c.interval : undefined,
      x: num(c.x),
      y: num(c.y),
      w: num(c.w),
      h: num(c.h),
    });
  }
  return out;
}

export function onHostCommand(handler: (cmd: HostCommand) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (!EMBED_HOST_ORIGINS.includes(e.origin)) return;
    const d = e.data as { source?: string; type?: string; symbol?: unknown; charts?: unknown; add?: unknown } | null;
    if (d?.source !== "anima") return;
    if (d.type === "set-symbol" && typeof d.symbol === "string" && SYMBOL_RX.test(d.symbol.trim())) {
      handler({ type: "set-symbol", symbol: d.symbol.trim().toUpperCase() });
    } else if (d.type === "set-charts") {
      const charts = cleanCharts(d.charts);
      if (charts) handler({ type: "set-charts", charts, add: d.add === true });
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
