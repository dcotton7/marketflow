import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Schwab read-only link (docs/schwab-readonly.md). Only env var names live here; Don sets the values in Render and
 * his local .env. SCHWAB_ENABLED is the feature flag: unset, nothing Schwab starts or answers.
 */
export const AUTH_BASE = "https://api.schwabapi.com/v1/oauth";
export const TRADER_BASE = "https://api.schwabapi.com/trader/v1";
export const MARKET_BASE = "https://api.schwabapi.com/marketdata/v1";

export interface SchwabConfig {
  enabled: boolean;
  appKey: string;
  appSecret: string;
  callbackUrl: string;
  tokenKey: Buffer | null;
  maxStreamSymbols: number;
}

export function loadSchwabConfig(env: NodeJS.ProcessEnv = process.env): SchwabConfig {
  const flag = String(env.SCHWAB_ENABLED ?? "").trim().toLowerCase();
  const appKey = env.SCHWAB_APP_KEY?.trim() ?? "";
  const appSecret = env.SCHWAB_APP_SECRET?.trim() ?? "";
  const keySource = env.SCHWAB_TOKEN_KEY?.trim() || appSecret;
  const cap = Number(env.SCHWAB_STREAM_MAX_SYMBOLS);
  return {
    enabled: flag === "1" || flag === "true" || flag === "on",
    appKey,
    appSecret,
    callbackUrl: env.SCHWAB_CALLBACK_URL?.trim() ?? "",
    tokenKey: keySource ? Buffer.from(hkdfSync("sha256", keySource, "marketflow-schwab", "token-store", 32)) : null,
    maxStreamSymbols: Number.isInteger(cap) && cap > 0 ? cap : 200,
  };
}

/** The keys and callback are all there (values are never shown, only whether they are set). */
export const isConfigured = (c: SchwabConfig) => !!(c.appKey && c.appSecret && c.callbackUrl && c.tokenKey);

/** AES-256-GCM: iv.tag.ciphertext, base64url. */
export function encryptText(key: Buffer, text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function decryptText(key: Buffer, packed: string): string {
  const [iv, tag, body] = packed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

const STATE_MS = 10 * 60_000;

/** OAuth state: user id, time and an HMAC, so any instance can check the callback without a stored session. */
export function makeState(key: Buffer, userId: number, now = Date.now()): string {
  const body = `${userId}.${now}`;
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

export function checkState(key: Buffer, state: unknown, now = Date.now()): number | null {
  if (typeof state !== "string") return null;
  const [user, at, sig] = state.split(".");
  if (!user || !at || !sig) return null;
  const want = createHmac("sha256", key).update(`${user}.${at}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const age = now - Number(at);
  const id = Number(user);
  return age >= 0 && age <= STATE_MS && Number.isInteger(id) && id > 0 ? id : null;
}
