const LOGIN_PATH = "/sentinel/login";
const DEFAULT_RETURN = "/sentinel/market-condition";

export function isSafeAppPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("://") || path.includes("\\")) return false;
  if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}?`)) return false;
  return true;
}

export function safeReturnPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_RETURN;
  return isSafeAppPath(next) ? next : DEFAULT_RETURN;
}

export function loginPathWithReturn(returnTo?: string): string {
  const raw = returnTo ?? `${window.location.pathname}${window.location.search}`;
  if (!isSafeAppPath(raw)) return LOGIN_PATH;
  return `${LOGIN_PATH}?next=${encodeURIComponent(raw)}`;
}

export async function sessionIsAlive(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}
