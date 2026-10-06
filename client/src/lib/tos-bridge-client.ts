/**
 * ToS calibrate/navigate: prefer a helper on this Windows PC (Live or LOCAL),
 * then same-origin /api/tos (LOCAL Node). Render cannot click Thinkorswim.
 */

export const TOS_AGENT_ORIGINS = ["http://127.0.0.1:7737", "http://localhost:7737"] as const;
export const TOSLINK_PROTOCOL_START = "marketflow-toslink:start";
export const TOSLINK_DOWNLOAD_HREF = "/tos-helper/ToSLink.cmd";

/** Ask Windows to open the installed ToSLink helper. No-op if it was never installed. */
export function startTosLinkHelper(): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = TOSLINK_PROTOCOL_START;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface TosStatus {
  available: boolean;
  calibrated: boolean;
  position: { x: number; y: number } | null;
  calibratedAt: string | null;
  process?: string | null;
  title?: string | null;
  helper?: boolean;
  fidelitySymbol?: string | null;
  fidelityAt?: string | null;
  source?: "agent" | "origin" | "none";
}

const EMPTY_STATUS: TosStatus = {
  available: false,
  calibrated: false,
  position: null,
  calibratedAt: null,
  source: "none",
};

let lastSource: TosStatus["source"] = "none";

export function getTosBridgeSource(): TosStatus["source"] {
  return lastSource;
}

export const MF_LEAD_SYMBOL_EVENT = "mf-lead-symbol";

/** Unpacked add-on id on this PC. Wake it so it can attach to an already-open Fidelity tab. */
const FIDELITY_LEAD_EXT_ID = "nickjnnbalkecfkbhmninnilodkcgfng";

export function pokeFidelityLead(): void {
  try {
    const runtime = (window as unknown as { chrome?: { runtime?: { sendMessage?: Function; lastError?: unknown } } }).chrome?.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") return;
    runtime.sendMessage(FIDELITY_LEAD_EXT_ID, { poke: true }, () => {
      void runtime.lastError;
    });
  } catch {
    /* add-on missing or this page is not allowed to talk to it */
  }
}

export function emitLeadSymbol(symbol: string): void {
  const clean = symbol.trim().toUpperCase();
  if (!clean || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MF_LEAD_SYMBOL_EVENT, { detail: clean }));
}

export function isWindowsClient(): boolean {
  if (typeof navigator === "undefined") return false;
  return /windows/i.test(navigator.userAgent);
}

function parseJsonSafe(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      // Chrome Local Network Access: HTTPS page talking to this PC's helper
      ...({ targetAddressSpace: "loopback" } as RequestInit),
    });
  } finally {
    window.clearTimeout(t);
  }
}

async function agentFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  // Try one origin at a time. Hitting 127.0.0.1 and localhost in parallel
  // made ToSLink type the same ticker twice (both hit the same helper).
  for (const origin of TOS_AGENT_ORIGINS) {
    try {
      return await fetchWithTimeout(`${origin}${path}`, {
        ...init,
        mode: "cors",
        credentials: "omit",
      }, timeoutMs);
    } catch {
      /* try next origin */
    }
  }
  return null;
}

async function originStatus(): Promise<TosStatus | null> {
  try {
    const res = await fetchWithTimeout("/api/tos/status", { credentials: "include" }, 2500);
    if (!res.ok) return null;
    const json = await parseJsonSafe(res);
    return { ...json, source: "origin" as const };
  } catch {
    return null;
  }
}

export async function fetchTosStatus(): Promise<TosStatus> {
  const [agentRes, origin] = await Promise.all([
    agentFetch("/status", { method: "GET" }, 3000),
    originStatus(),
  ]);

  let agent: TosStatus | null = null;
  if (agentRes?.ok) {
    const json = await parseJsonSafe(agentRes);
    if (json?.available) {
      agent = { ...json, source: "agent" };
    }
  }

  if (agent?.available) {
    lastSource = "agent";
    return agent;
  }
  if (origin?.available) {
    lastSource = "origin";
    return origin;
  }
  lastSource = "none";
  return origin ?? EMPTY_STATUS;
}

export function tosErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      /* use raw */
    }
  }
  return raw.replace(/^\d+:\s*/, "");
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const json = await parseJsonSafe(res);
  throw new Error(json?.error || `${res.status}: ${res.statusText}`);
}

export async function tosCalibrate(): Promise<void> {
  const agentRes = await agentFetch("/calibrate", { method: "POST" }, 25000);
  if (agentRes) {
    await throwIfNotOk(agentRes);
    lastSource = "agent";
    return;
  }
  const origin = await fetch("/api/tos/calibrate", { method: "POST", credentials: "include" });
  await throwIfNotOk(origin);
  lastSource = "origin";
}

export async function tosNavigate(symbol: string): Promise<void> {
  const clean = symbol.trim().toUpperCase();
  if (!clean) return;
  const path = `/navigate?symbol=${encodeURIComponent(clean)}`;

  // GET avoids a CORS preflight so Live (HTTPS) can reach the loopback helper.
  const agentRes = await agentFetch(path, { method: "GET" }, 15000);
  if (agentRes) {
    await throwIfNotOk(agentRes);
    lastSource = "agent";
    return;
  }

  const origin = await fetch("/api/tos/navigate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: clean }),
  });
  await throwIfNotOk(origin);
  lastSource = "origin";
}
