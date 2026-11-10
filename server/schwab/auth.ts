import { AUTH_BASE, type SchwabConfig } from "./config";
import type { SchwabConnection, SchwabStore } from "./store";

export const REFRESH_LIFETIME_MS = 7 * 24 * 3_600_000;
/** Refresh the 30-minute access token when less than this is left. */
export const REFRESH_AHEAD_MS = 5 * 60_000;
/** Warn when the 7-day sign-in has less than this left. */
export const WARN_AHEAD_MS = 24 * 3_600_000;

export const EXPIRED_MESSAGE = "Schwab disconnected — sign in again";

export type ConnectionState = "disconnected" | "connected" | "expiring" | "expired";

/** Raised when there is no usable sign-in: the caller falls back to the old price source. */
export class SchwabSignedOut extends Error {
  constructor(public state: "disconnected" | "expired") {
    super(state === "expired" ? EXPIRED_MESSAGE : "Schwab not connected");
  }
}

export function connectionState(c: SchwabConnection | null, now = Date.now()): ConnectionState {
  if (!c || !c.refreshToken) return c?.lastError ? "expired" : "disconnected";
  if (c.refreshExpiresAt !== null && c.refreshExpiresAt <= now) return "expired";
  if (c.refreshExpiresAt !== null && c.refreshExpiresAt - now < WARN_AHEAD_MS) return "expiring";
  return "connected";
}

export function stateMessage(state: ConnectionState, c: SchwabConnection | null, now = Date.now()): string {
  if (state === "expired") return EXPIRED_MESSAGE;
  if (state === "disconnected") return "Schwab not connected";
  if (state === "expiring") {
    const h = Math.max(0, Math.floor(((c?.refreshExpiresAt ?? now) - now) / 3_600_000));
    return `Schwab sign-in expires in ${h} hour${h === 1 ? "" : "s"} — sign in again to keep it`;
  }
  return "Schwab connected";
}

type Fetch = typeof fetch;

interface TokenReply {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export class TokenManager {
  private inflight = new Map<number, Promise<string>>();

  constructor(
    private cfg: SchwabConfig,
    private store: SchwabStore,
    private fetchImpl: Fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  authorizeUrl(state: string): string {
    const q = new URLSearchParams({ client_id: this.cfg.appKey, redirect_uri: this.cfg.callbackUrl, state });
    return `${AUTH_BASE}/authorize?${q}`;
  }

  /** The only POST in the Schwab code: the OAuth token endpoint (sign-in and refresh). */
  private async tokenRequest(form: Record<string, string>): Promise<{ status: number; body: TokenReply | null }> {
    const basic = Buffer.from(`${this.cfg.appKey}:${this.cfg.appSecret}`).toString("base64");
    const res = await this.fetchImpl(`${AUTH_BASE}/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const body = res.ok ? ((await res.json()) as TokenReply) : null;
    return { status: res.status, body };
  }

  async exchangeCode(userId: number, code: string): Promise<void> {
    const r = await this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.cfg.callbackUrl });
    if (!r.body?.access_token || !r.body.refresh_token) throw new Error(`Schwab sign-in failed (${r.status})`);
    const now = this.now();
    await this.store.saveTokens({
      userId,
      accessToken: r.body.access_token,
      refreshToken: r.body.refresh_token,
      accessExpiresAt: now + (r.body.expires_in ?? 1800) * 1000,
      refreshExpiresAt: now + REFRESH_LIFETIME_MS,
    });
  }

  async disconnect(userId: number): Promise<void> {
    await this.store.clearTokens(userId, null);
  }

  /** A valid access token, refreshed first when it has under 5 minutes left. */
  async accessToken(userId: number, opts: { force?: boolean } = {}): Promise<string> {
    const pending = this.inflight.get(userId);
    if (pending) return pending;
    const run = this.resolve(userId, !!opts.force).finally(() => this.inflight.delete(userId));
    this.inflight.set(userId, run);
    return run;
  }

  private async resolve(userId: number, force: boolean): Promise<string> {
    // Read the row each time: the other instance (LOCAL or Live, one database) may have refreshed already.
    const c = await this.store.load(userId);
    const now = this.now();
    const state = connectionState(c, now);
    if (state === "disconnected") throw new SchwabSignedOut("disconnected");
    if (state === "expired") {
      if (c?.refreshToken) await this.store.clearTokens(userId, "The 7-day Schwab sign-in ran out");
      throw new SchwabSignedOut("expired");
    }
    if (!force && c!.accessToken && c!.accessExpiresAt !== null && c!.accessExpiresAt - now > REFRESH_AHEAD_MS) {
      return c!.accessToken;
    }
    const r = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: c!.refreshToken! });
    if (r.status === 400 || r.status === 401) {
      await this.store.clearTokens(userId, "Schwab refused the sign-in refresh");
      throw new SchwabSignedOut("expired");
    }
    if (!r.body?.access_token) throw new Error(`Schwab token refresh failed (${r.status})`);
    await this.store.saveTokens({
      userId,
      accessToken: r.body.access_token,
      refreshToken: r.body.refresh_token || c!.refreshToken,
      accessExpiresAt: now + (r.body.expires_in ?? 1800) * 1000,
      refreshExpiresAt: c!.refreshExpiresAt, // refreshing never extends the 7 days
    });
    return r.body.access_token;
  }
}
