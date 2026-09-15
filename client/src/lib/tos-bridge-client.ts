/**
 * ToS calibrate/navigate: prefer a helper on this Windows PC (Live or LOCAL),
 * then same-origin /api/tos (LOCAL Node). Render cannot click Thinkorswim.
 */

export const TOS_AGENT_ORIGINS = ["http://127.0.0.1:7737", "http://localhost:7737"] as const;

export interface TosStatus {
  available: boolean;
  calibrated: boolean;
  position: { x: number; y: number } | null;
  calibratedAt: string | null;
  process?: string | null;
  title?: string | null;
  helper?: boolean;
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
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    window.clearTimeout(t);
  }
}

async function agentFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  for (const origin of TOS_AGENT_ORIGINS) {
    try {
      const res = await fetchWithTimeout(`${origin}${path}`, {
        ...init,
        mode: "cors",
        credentials: "omit",
      }, timeoutMs);
      return res;
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
    agentFetch("/status", { method: "GET" }, 800),
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
  const body = JSON.stringify({ symbol: clean });
  const headers = { "Content-Type": "application/json" };

  if (lastSource === "origin") {
    const origin = await fetch("/api/tos/navigate", {
      method: "POST",
      credentials: "include",
      headers,
      body,
    });
    await throwIfNotOk(origin);
    return;
  }

  const agentRes = await agentFetch("/navigate", { method: "POST", headers, body }, 15000);
  if (agentRes) {
    await throwIfNotOk(agentRes);
    lastSource = "agent";
    return;
  }

  const origin = await fetch("/api/tos/navigate", {
    method: "POST",
    credentials: "include",
    headers,
    body,
  });
  await throwIfNotOk(origin);
  lastSource = "origin";
}
