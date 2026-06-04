import type { MaSettingRow } from "@/components/MaSettingsGridPanel";

/** Non-URL query key — avoids default queryFn join("/") pitfalls on Start Here. */
export const MINI_MA_SETTINGS_QUERY_KEY = ["sentinel", "miniMaSettings"] as const;

async function readApiError(res: Response): Promise<string> {
  const text = (await res.text()) || res.statusText;
  try {
    const body = JSON.parse(text) as {
      error?: unknown;
      message?: unknown;
    };
    if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
    if (body.error && typeof body.error === "object" && "message" in body.error) {
      const msg = (body.error as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    }
    if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
  } catch {
    // non-JSON body
  }
  return text.trim() || `HTTP ${res.status}`;
}

function miniMaSettingsHttpError(res: Response, detail: string): Error {
  if (res.status === 404) {
    return new Error(
      `${res.status}: Mini chart settings API not found. Restart \`npm run dev\` after pulling latest code, or deploy the server to Live. (${detail})`
    );
  }
  return new Error(`${res.status}: ${detail}`);
}

export async function fetchMiniMaSettings(): Promise<MaSettingRow[]> {
  const res = await fetch("/api/sentinel/mini-ma-settings", { credentials: "include" });
  if (!res.ok) {
    throw miniMaSettingsHttpError(res, await readApiError(res));
  }
  return res.json();
}

export async function saveMiniMaSettings(rows: MaSettingRow[]): Promise<MaSettingRow[]> {
  const res = await fetch("/api/sentinel/mini-ma-settings", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) {
    throw miniMaSettingsHttpError(res, await readApiError(res));
  }
  return res.json();
}

export async function copyMiniMaSettingsFromMain(): Promise<MaSettingRow[]> {
  const res = await fetch("/api/sentinel/mini-ma-settings/copy-from-main", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw miniMaSettingsHttpError(res, await readApiError(res));
  }
  return res.json();
}
