/**
 * An /embed page in Anima's Lab signs in once, from the ticket, and gets a cookie good for 12 h
 * (server/middleware/animaEmbed.ts COOKIE_SECONDS). A panel left open longer then gets 401 "Login required"
 * on every call; on 10 Nov the scanner stored that answer as its status and crashed on it.
 *
 * Once the page has signed in, the first 401 from our own /api shows a plain "session expired" note over the
 * page and tells the host (auth-failed, reason "expired"), which mints a fresh ticket and reloads the frame.
 */
import { postToHost } from "@/lib/embed-host";

export const EXPIRED_TEXT = "MarketFlow session expired — reopen the panel";

let signedIn = false;
let expired = false;

export const isEmbedPath = (path: string) => path.startsWith("/embed/");

/** True for a 401 from MarketFlow's own /api (not the sign-in check itself, not another site). */
export function isSessionLoss(url: string, status: number, origin: string): boolean {
  if (status !== 401) return false;
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  return u.origin === origin && u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/auth/");
}

/** Called when an embed page rendered signed in; 401s before that are the sign-in route's business. */
export function markEmbedSignedIn() {
  signedIn = true;
}

export function embedSessionExpired(): boolean {
  return expired;
}

/** Shows the note and tells the host once. Returns true the first time. */
export function reportEmbedExpired(): boolean {
  if (!signedIn || expired) return false;
  expired = true;
  postToHost({ type: "auth-failed", page: window.location.pathname, reason: "expired" });
  if (typeof document !== "undefined" && !document.getElementById("mf-embed-expired")) {
    const note = document.createElement("div");
    note.id = "mf-embed-expired";
    note.setAttribute("role", "alert");
    note.textContent = EXPIRED_TEXT;
    note.style.cssText =
      "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
      "padding:16px;text-align:center;background:rgba(2,6,23,0.92);color:#cbd5e1;font:14px system-ui,sans-serif";
    document.body.appendChild(note);
  }
  return true;
}

/** Wraps window.fetch on /embed pages so any 401 from our /api, after sign-in, reports the lost session. */
export function installEmbedSessionWatch(win: Window & typeof globalThis = window) {
  if (!isEmbedPath(win.location.pathname)) return;
  const orig = win.fetch.bind(win);
  win.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await orig(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (isSessionLoss(url, res.status, win.location.origin)) reportEmbedExpired();
    return res;
  };
}

/** For tests only. */
export function _resetEmbedSession() {
  signedIn = false;
  expired = false;
}
